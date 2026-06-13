<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import { invoke } from '@tauri-apps/api/core'
    import type { TopicNature } from 'schema'
    import { TOPIC_LABELS } from 'schema'

    interface Props {
        complete: () => void
        backToQuickForm: () => void
    }

    let { complete, backToQuickForm }: Props = $props()

    type ConversationStep =
        | 'initial'
        | 'confirming_claim'
        | 'refining_claim'
        | 'asking_description'
        | 'asking_proves_right'
        | 'asking_proves_wrong'
        | 'asking_codename'
        | 'complete'

    let userInput = $state('')
    let conversation = $state<Array<{ role: 'user' | 'assistant'; content: string }>>([])
    let isThinking = $state(false)
    let currentStep = $state<ConversationStep>('initial')

    // Bet being built
    let claim = $state('')
    let description = $state('')
    let provesRight = $state('')
    let provesWrong = $state('')
    let codename = $state('')

    let topicNature = $state<TopicNature | null>(null)
    let submitting = $state(false)
    let flavouringTopic = $state(false)
    let showFinalPreview = $state(false)

    let topicExplainer = $derived.by(() => {
        if (!topicNature) return null
        return TOPIC_LABELS[`${topicNature.frequency}-${topicNature.confidence}`]
    })

    // Input context label
    let inputPrompt = $derived.by(() => {
        if (currentStep === 'initial') return 'Share your hunch or pattern...'
        if (currentStep === 'refining_claim') return 'Type your refined claim...'
        if (currentStep === 'asking_description') return 'Add context notes or type "skip"...'
        if (currentStep === 'asking_proves_right') return 'What would prove you right?'
        if (currentStep === 'asking_proves_wrong') return 'What would prove you wrong?'
        if (currentStep === 'asking_codename') return 'Give your bet a codename...'
        return 'Type your response...'
    })

    // Show input only for these steps
    let showInput = $derived(
        currentStep === 'initial' ||
            currentStep === 'refining_claim' ||
            currentStep === 'asking_description' ||
            currentStep === 'asking_proves_right' ||
            currentStep === 'asking_proves_wrong' ||
            currentStep === 'asking_codename'
    )

    // Trigger progressive reveal when final preview shows
    $effect(() => {
        if (showFinalPreview && !flavouringTopic) {
            setTimeout(() => animator.fadeIn('.bet-codename'), 0)
            setTimeout(() => animator.fadeIn('.bet-claim'), 200)
            if (description.trim()) {
                setTimeout(() => animator.fadeIn('.bet-description'), 400)
            }
            if (topicNature) {
                setTimeout(() => animator.fadeIn('.bet-nature'), 600)
            }
            setTimeout(() => animator.fadeIn('.bet-details'), 800)
            setTimeout(() => animator.fadeIn('.shaped-actions'), 1000)
        }
    })

    async function confirmClaim() {
        conversation = [
            ...conversation,
            { role: 'user', content: 'Yes, that looks good.' },
            {
                role: 'assistant',
                content:
                    'Perfect. Want to add any context notes for your future self? (This helps you remember why you made this bet months from now)\n\nOr just say "skip" to continue.',
            },
        ]
        currentStep = 'asking_description'
    }

    function startRefineClaim() {
        currentStep = 'refining_claim'
        conversation = [...conversation, { role: 'user', content: 'Let me refine that.' }]
    }

    async function sendMessage() {
        if (!userInput.trim() || isThinking) return

        const message = userInput.trim()
        userInput = ''

        conversation = [...conversation, { role: 'user', content: message }]
        isThinking = true

        const startTime = Date.now()

        try {
            let assistantMessage = ''
            let nextStep: ConversationStep = currentStep

            // State machine for conversation flow
            if (currentStep === 'initial') {
                const response = await invoke<string>('claim_guide', {
                    userMessage: message,
                })
                claim = response.trim()
                userInput = claim // Pre-fill input with shaped claim for editing
                assistantMessage = `Got it. So your claim is: "${claim}"\n\nDoes this capture what you're betting on in a nutshell?`
                nextStep = 'confirming_claim'
            } else if (currentStep === 'refining_claim') {
                claim = message
                assistantMessage = `Updated to: "${claim}"\n\nDoes this work better?`
                nextStep = 'confirming_claim'
            } else if (currentStep === 'asking_description') {
                if (message.toLowerCase() === 'skip') {
                    description = ''
                } else {
                    description = message
                }
                assistantMessage = `What specific signals would prove you RIGHT? (Think: GitHub stars, official docs, community adoption)`
                nextStep = 'asking_proves_right'
            } else if (currentStep === 'asking_proves_right') {
                provesRight = message
                assistantMessage = `And what would prove you WRONG?`
                nextStep = 'asking_proves_wrong'
            } else if (currentStep === 'asking_proves_wrong') {
                provesWrong = message
                assistantMessage = `What do you want to call this bet? Give it a memorable codename.`
                nextStep = 'asking_codename'
            } else if (currentStep === 'asking_codename') {
                codename = message
                assistantMessage = `Great! Having another look over your bet...`
                nextStep = 'complete'
                await flavourTopic()
                showFinalPreview = true
            }

            // Ensure minimum thinking time of 1200ms
            const elapsed = Date.now() - startTime
            if (elapsed < 1200) {
                await new Promise((resolve) => setTimeout(resolve, 1200 - elapsed))
            }

            conversation = [...conversation, { role: 'assistant', content: assistantMessage }]
            currentStep = nextStep
        } catch (err) {
            const errorMessage = String(err).includes('Ollama request failed')
                ? 'Could not reach Ollama. Make sure it is running locally on port 11434.'
                : `Error: ${err}`

            conversation = [...conversation, { role: 'assistant', content: errorMessage }]
        } finally {
            isThinking = false
        }
    }

    async function flavourTopic() {
        flavouringTopic = true
        try {
            topicNature = await invoke<TopicNature>('flavour_topic_local', {
                claim: claim,
                description: description.trim(),
            })
        } catch (err) {
            console.error('Failed to flavour topic:', err)
            topicNature = { frequency: 'low', confidence: 'low' }
        } finally {
            flavouringTopic = false
        }
    }

    async function placeBet() {
        submitting = true

        try {
            const betId = await drydock.placeBet({
                codename: codename,
                claim: claim,
                description: description.trim(),
                provesRight: provesRight,
                provesWrong: provesWrong,
                initialConfidence: 50,
                madeAt: new Date(),
                currentConfidence: 50,
                missionStatus: 'dormant',
                topic: topicNature,
            })
            if (betId && topicNature?.reasoning) {
                await drydock.logOllamaTask(
                    'flavour_topic_local',
                    betId,
                    `${claim} ${description.trim()}`,
                    topicNature.reasoning,
                    JSON.stringify({
                        frequency: topicNature.frequency,
                        confidence: topicNature.confidence,
                    })
                )
            }
            complete()
        } catch (err) {
            console.error('Failed to place bet:', err)
            submitting = false
        }
    }
</script>

<div class="card card-lg">
    <div class="conversation-body">
        {#if conversation.length === 0}
            <div class="starter-prompt">
                <p>What pattern or hunch do you want to bet on?</p>
                <p class="hint">Share your thinking - I'll help you sharpen it into a real bet</p>
            </div>
        {:else}
            <div class="message-list">
                {#each conversation as message}
                    <div class="message message-{message.role}">
                        <div class="message-content">{message.content}</div>
                    </div>
                {/each}
                {#if isThinking}
                    <div class="message message-assistant">
                        <div class="message-content typing">
                            <span>Thinking</span>
                            <span class="dots">
                                <span class="dot">.</span>
                                <span class="dot">.</span>
                                <span class="dot">.</span>
                            </span>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        {#if currentStep === 'confirming_claim'}
            <div class="claim-confirmation">
                <div class="confirmation-buttons">
                    <button class="btn-primary" onclick={confirmClaim}>Looks Good</button>
                    <button class="btn-secondary" onclick={startRefineClaim}
                        >Let Me Refine It</button
                    >
                </div>
            </div>
        {/if}

        {#if showFinalPreview}
            {#if flavouringTopic}
                <div class="topic-nature-loading">
                    <span>Deciding on topic nature</span>
                    <span class="dots">
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                    </span>
                </div>
            {/if}

            <div class="shaped-bet-preview">
                <div class="preview-header">
                    <span class="preview-icon">🎯</span>
                    <h3 class="bet-codename" style="opacity: 0;">Ready to Track This Bet</h3>
                </div>

                <div class="bet-title">
                    <h4 class="bet-claim" style="opacity: 0;">{codename}</h4>
                    <p class="claim-text" style="opacity: 0;">{claim}</p>
                </div>

                {#if description.trim()}
                    <p class="description bet-description" style="opacity: 0;">{description}</p>
                {/if}

                {#if topicNature && topicExplainer}
                    <div class="topic-section bet-nature" style="opacity: 0;">
                        <div class="topic-badges">
                            <span class="nature-badge nature-{topicNature.frequency}">
                                {topicNature.frequency} frequency
                            </span>
                            <span class="nature-badge nature-{topicNature.confidence}">
                                {topicNature.confidence} confidence
                            </span>
                        </div>
                        <div class="topic-explainer">
                            <strong>{topicExplainer.label}</strong>
                            <p>{topicExplainer.explanation}</p>
                        </div>
                    </div>
                {/if}

                <div class="bet-details" style="opacity: 0;">
                    <div class="form-group">
                        <span class="label uppercase">✓ Proves RIGHT:</span>
                        <p>{provesRight}</p>
                    </div>
                    <div class="form-group">
                        <span class="label uppercase">✗ Proves WRONG:</span>
                        <p>{provesWrong}</p>
                    </div>
                </div>

                <div class="bet-meta" style="opacity: 0;">
                    <div class="meta-item">
                        <span class="label large">📊 Starting confidence:</span>
                        <span class="meta-value">50%</span>
                    </div>
                </div>

                <div class="next-steps" style="opacity: 0;">
                    <p class="label uppercase">What happens next:</p>
                    <p class="next-text">
                        Start gathering evidence from GitHub, Discord, blogs, Reddit threads, and
                        conversations. Track signals as they emerge over time.
                    </p>
                </div>

                <div class="shaped-actions" style="opacity: 0;">
                    <button
                        class="btn-secondary"
                        onclick={() => {
                            complete()
                        }}>Start Over</button
                    >
                    <button
                        class="btn-primary"
                        onclick={placeBet}
                        disabled={submitting || flavouringTopic}
                    >
                        {submitting ? 'Placing Bet...' : 'Place This Bet →'}
                    </button>
                </div>
            </div>
        {:else if showInput}
            <div class="input-area">
                <label class="label italic">{inputPrompt}</label>
                <textarea
                    bind:value={userInput}
                    rows="3"
                    disabled={isThinking}
                    onkeydown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            sendMessage()
                        }
                    }}
                ></textarea>
                <div class="input-actions">
                    <button class="btn-secondary" onclick={backToQuickForm}
                        >Use Quick Form Instead</button
                    >
                    <button
                        class="btn-primary"
                        onclick={sendMessage}
                        disabled={isThinking || !userInput.trim()}
                    >
                        Send
                    </button>
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .card {
        padding: 48px;
    }

    .conversation-body {
        display: flex;
        flex-direction: column;
        gap: 24px;
        min-height: 400px;
    }

    .starter-prompt {
        text-align: center;
        padding: 80px 24px;
    }

    .starter-prompt p:first-child {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 12px 0;
    }

    .starter-prompt .hint {
        font-size: 15px;
        color: var(--text-secondary);
        margin: 0;
    }

    .message-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-height: 500px;
        overflow-y: auto;
        padding: 16px 0;
    }

    .message {
        display: flex;
        padding: 16px;
        border-radius: var(--radius-sm);
        animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .message-user {
        background: var(--accent-primary);
        color: white;
        margin-left: 20%;
    }

    .message-assistant {
        background: var(--bg-elevated);
        color: var(--text-primary);
        margin-right: 20%;
    }

    .message-content {
        font-size: 15px;
        line-height: 1.6;
        white-space: pre-wrap;
    }

    .typing {
        font-style: italic;
        color: var(--text-tertiary);
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .dots {
        display: inline-flex;
        gap: 2px;
    }

    .dot {
        animation: pulse 1.4s ease-in-out infinite;
    }

    .dot:nth-child(1) {
        animation-delay: 0s;
    }

    .dot:nth-child(2) {
        animation-delay: 0.2s;
    }

    .dot:nth-child(3) {
        animation-delay: 0.4s;
    }

    @keyframes pulse {
        0%,
        60%,
        100% {
            opacity: 0.3;
        }
        30% {
            opacity: 1;
        }
    }

    .claim-confirmation {
        display: flex;
        justify-content: center;
        padding: 24px;
    }

    .confirmation-buttons {
        display: flex;
        gap: 12px;
    }

    .topic-nature-loading {
        padding: 16px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        text-align: center;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    }

    .topic-nature-loading span:first-child {
        font-size: 14px;
        color: var(--text-secondary);
        font-style: italic;
    }

    .shaped-bet-preview {
        padding: 32px;
        background: var(--bg-elevated);
        border: 2px solid var(--accent-primary);
        border-radius: var(--radius-md);
    }

    .preview-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 24px;
    }

    .preview-icon {
        font-size: 28px;
    }

    .shaped-bet-preview h3 {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-secondary);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .bet-title {
        margin-bottom: 20px;
    }

    .bet-title h4 {
        font-size: 24px;
        font-weight: 700;
        color: var(--accent-primary);
        margin: 0 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .shaped-bet-preview .claim-text {
        font-size: 16px;
        font-weight: 500;
        color: var(--text-primary);
        margin: 0;
        line-height: 1.5;
    }

    .shaped-bet-preview .description {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 20px 0;
        line-height: 1.6;
        font-style: italic;
        padding: 12px;
        background: var(--bg-tertiary);
        border-left: 3px solid var(--border);
        border-radius: 4px;
    }

    .topic-section {
        margin-bottom: 24px;
    }

    .topic-badges {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }

    .topic-explainer {
        padding: 16px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        border-left: 3px solid var(--accent-primary);
    }

    .topic-explainer strong {
        display: block;
        font-size: 13px;
        font-weight: 700;
        color: var(--accent-primary);
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .topic-explainer p {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 0;
    }

    .bet-details {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-bottom: 24px;
    }

    .label {
        font-weight: 500;
        color: var(--text-secondary);
    }

    .label.uppercase {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-tertiary);
    }

    .label.italic {
        font-size: 13px;
        font-style: italic;
    }

    .label.large {
        font-size: 14px;
    }

    .bet-meta {
        padding: 16px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        margin-bottom: 20px;
    }

    .meta-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .meta-value {
        font-size: 18px;
        font-weight: 700;
        color: var(--accent-primary);
    }

    .next-steps {
        padding: 16px;
        background: rgba(59, 130, 246, 0.05);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius-sm);
        margin-bottom: 24px;
    }

    .next-text {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 0;
    }

    .shaped-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
    }

    .input-area {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: auto;
    }

    .input-area textarea {
        width: 100%;
        padding: 12px;
        background: var(--bg-secondary);
        border: 2px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 15px;
        font-family: inherit;
        resize: vertical;
        transition: var(--transition);
    }

    .input-area textarea:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .input-area textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .input-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
    }
</style>
