<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { message } from '@tauri-apps/plugin-dialog'
    import { invoke } from '@tauri-apps/api/core'
    import type { TopicNature } from 'schema'

    interface Props {
        complete: () => void
    }

    let { complete }: Props = $props()

    // UI View controller concerns
    let claim = $state('')
    let description = $state('')
    let provesRight = $state('')
    let provesWrong = $state('')
    let targetDate = $state('')
    let codename = $state('')

    let submitting = $state(false)
    let currentStep = $state(1)
    let topicNature = $state<TopicNature | null>(null)
    let flavouringTopic = $state(false)

    // TODO: Do we need this as static UI or could we do an FTS5 index pointer?
    // Topic nature explainers from evidence gatherer's POV
    const topicNatureExplainer = {
        'high-high': {
            label: 'Fast-moving, measurable',
            explanation: `Expect fresh evidence everywhere. Reddit threads from this week, GitHub issues still open, Discord channels actively debating. Numbers change monthly - star counts, download stats, poll results. Your evidence will have recent timestamps and you'll need to keep collecting as things shift.`,
        },
        'high-low': {
            label: 'Fast-moving, subjective',
            explanation: `Evidence keeps flowing but it contradicts itself. You'll find blog posts from last month arguing opposite sides. Twitter threads where people keep changing their minds. No consensus forming despite lots of chatter. Track the mood swings, not hard data.`,
        },
        'low-high': {
            label: 'Slow-burn, measurable',
            explanation: `Evidence appears in big chunks with long gaps. A spec document from 6 months ago, then silence until a release announcement. Reddit threads from a year back that nobody's challenged. When new evidence drops, it's definitive - version bumps, RFCs merged, browser support tables updated.`,
        },
        'low-low': {
            label: 'Slow-burn, subjective',
            explanation: `You'll dig through old conference talks and 2-year-old blog posts. Reddit threads with no recent activity because the question isn't settled enough to fight about. Evidence is scattered, contradictory, and stale. Nobody's tracking this with metrics - just vague industry vibes shifting over years.`,
        },
    }

    let topicExplainer = $derived.by(() => {
        if (!topicNature) return null
        const key =
            `${topicNature.frequency}-${topicNature.confidence}` as keyof typeof topicNatureExplainer
        return topicNatureExplainer[key]
    })

    // Validation feedback
    let claimFeedback = $state('')
    let provesRightFeedback = $state('')
    let provesWrongFeedback = $state('')

    // Live validation
    $effect(() => {
        if (claim.trim()) {
            const wordCount = claim.trim().split(/\s+/).length
            if (wordCount < 5) {
                claimFeedback = 'Keep going - what pattern are you seeing?'
            } else if (wordCount > 30) {
                claimFeedback = 'Try to capture this in one sharp sentence'
            } else if (
                !claim.includes('will') &&
                !claim.includes('becomes') &&
                !claim.includes('emerges')
            ) {
                claimFeedback = 'What do you think will happen?'
            } else {
                claimFeedback = ''
            }
        }
        if (provesRight.trim()) {
            const hasBullets = provesRight.includes('-') || provesRight.includes('•')
            const hasNumbers = /\d/.test(provesRight)
            if (provesRight.length < 30) {
                provesRightFeedback = 'What specific signals would validate this?'
            } else if (!hasBullets && !hasNumbers) {
                provesRightFeedback =
                    'Try listing concrete signals (like "1000+ stars" or "becomes default answer")'
            } else {
                provesRightFeedback = ''
            }
        }

        if (provesWrong.trim()) {
            const hasBullets = provesWrong.includes('-') || provesWrong.includes('•')
            if (provesWrong.length < 30) {
                provesWrongFeedback = 'What would make you admit you were wrong?'
            } else if (!hasBullets && provesWrong.toLowerCase() === provesRight.toLowerCase()) {
                provesWrongFeedback =
                    'This looks similar to "proves right" - what\'s the opposite outcome?'
            } else {
                provesWrongFeedback = ''
            }
        }
    })

    function nextStep() {
        if (currentStep === 1 && !claim.trim()) {
            message('Please enter a claim first.', {
                title: "Claim can't be empty",
                kind: 'warning',
            })
            return
        }
        if (currentStep === 2 && !provesRight.trim()) {
            message('Please enter some stipulations.', {
                title: 'Bet needs proof of win',
                kind: 'warning',
            })
            return
        }
        if (currentStep === 3 && !provesWrong.trim()) {
            message('Please enter some stipulations.', {
                title: 'Bet needs to proof of loss',
                kind: 'warning',
            })
            return
        }
        if (currentStep === 4 && !targetDate) {
            message('Please enter a maturity date.', {
                title: 'Bet needs a timeline',
                kind: 'warning',
            })
            return
        }

        // When moving to step 5 (final step), flavour the topic
        if (currentStep === 4) {
            flavourTopic()
        }

        currentStep++
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
            // Default to low/low if it fails
            topicNature = { frequency: 'low', confidence: 'low' }
        } finally {
            flavouringTopic = false
        }
    }

    function prevStep() {
        if (currentStep > 1) {
            currentStep--
        }
    }

    async function placeBet(e: Event) {
        e.preventDefault()

        if (!codename.trim()) {
            message('Please give your bet a memorable name.', {
                title: 'Bet needs a mission name',
                kind: 'warning',
            })
            return
        }

        submitting = true

        try {
            await drydock.placeBet({
                codename: codename.trim(),
                claim: claim.trim(),
                description: '', // Keep empty for now, structured fields are primary
                provesRight: provesRight.trim(),
                provesWrong: provesWrong.trim(),
                targetDate: new Date(targetDate),
                initialConfidence: 50,
                madeAt: new Date(),
                currentConfidence: 50,
                missionStatus: 'dormant',
                topic: topicNature, // Pass the already-calculated topic
            })
            complete()
        } catch (err) {
            message('Failed to place bet. Please contact us if this error continues', {
                title: 'There was a problem placing your bet.',
                kind: 'error',
            })
            submitting = false
        }
    }
</script>

<form class="quick-bet-form" onsubmit={placeBet}>
    <div class="steps-indicator">
        {#each [1, 2, 3, 4, 5] as step}
            <div
                class="step-dot"
                class:active={step === currentStep}
                class:completed={step < currentStep}
            ></div>
        {/each}
    </div>
    {#if currentStep === 1}
        <div class="form-group">
            <label for="claim">What's your claim?</label>
            <input
                class="form-input"
                id="claim"
                type="text"
                bind:value={claim}
                placeholder="A Svelte-native dataview champion will emerge by end of 2026"
            />
            {#if claimFeedback}
                <p class="feedback">{claimFeedback}</p>
            {/if}
            <p class="hint">One sentence - what you're predicting will happen</p>
            <div class="step-actions">
                <button type="button" class="btn-primary" onclick={nextStep}>Next</button>
            </div>
        </div>
    {/if}
    {#if currentStep === 2}
        <div class="form-group">
            <label for="description">Add context notes (optional)</label>
            <textarea
                id="description"
                class="form-textarea"
                bind:value={description}
                placeholder="What pattern are you seeing? Why do you think this will happen?"
                rows="4"
            ></textarea>
            <p class="hint">Help your future self remember what you were thinking</p>
        </div>
        <div class="form-group">
            <label for="proves-right">What would prove you right?</label>
            <textarea
                id="proves-right"
                class="form-textarea"
                bind:value={provesRight}
                placeholder="Library reaches 1000+ GitHub stars
"
                rows="6"
            ></textarea>
            {#if provesRightFeedback}
                <p class="feedback">{provesRightFeedback}</p>
            {/if}
            <p class="hint">Concrete signals that would validate your bet</p>
            <div class="step-actions">
                <button type="button" class="btn-primary" onclick={prevStep}>Back</button>
                <button type="button" class="btn-secondary" onclick={nextStep}>Next</button>
            </div>
        </div>
    {/if}
    {#if currentStep === 3}
        <div class="form-group">
            <label for="proves-wrong">What would prove you wrong?</label>
            <textarea
                id="proves-wrong"
                class="form-textarea"
                bind:value={provesWrong}
                placeholder="Community accepts 'roll your own' as standard"
                rows="6"
            ></textarea>
            {#if provesWrongFeedback}
                <p class="feedback">{provesWrongFeedback}</p>
            {/if}
            <p class="hint">Concrete signals that prove you bet wrong</p>
            <div class="step-actions">
                <button type="button" class="btn-primary" onclick={prevStep}>Back</button>
                <button type="button" class="btn-secondary" onclick={nextStep}>Next</button>
            </div>
        </div>
    {/if}
    {#if currentStep === 4}
        <div class="form-group">
            <label for="target-date">When will you know?</label>
            <input id="target-date" class="form-input" type="date" bind:value={targetDate} />
            <p class="hint">
                When will enough signals have emerged to validate or invalidate your claim?
            </p>
            <div class="step-actions">
                <button type="button" class="btn-primary" onclick={prevStep}>Back</button>
                <button type="button" class="btn-secondary" onclick={nextStep}>Next</button>
            </div>
        </div>
    {/if}
    {#if currentStep === 5}
        <div class="form-step">
            <label for="codename">Give it a codename</label>
            <input
                id="codename"
                class="form-input"
                type="text"
                bind:value={codename}
                placeholder="Phoenix Rising"
            />
            <p class="hint">A memorable name to track this bet</p>
            {#if flavouringTopic}
                <div class="topic-loading">
                    <span>Analyzing topic nature</span>
                    <span class="dots">
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                        <span class="dot">.</span>
                    </span>
                </div>
            {:else}
                <div class="bet-confirmation">
                    <div class="preview-header">
                        <span class="preview-icon">🎯</span>
                        <h3>Ready to Track This Bet</h3>
                    </div>
                    <div class="bet-title">
                        <h4>{codename || 'Unnamed Bet'}</h4>
                        <p class="claim-text">{claim}</p>
                    </div>
                    {#if description.trim()}
                        <p class="description">{description}</p>
                    {/if}
                    {#if topicNature && topicExplainer}
                        <div class="topic-section">
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
                    <div class="bet-details">
                        <div class="detail-item">
                            <span>✓ Proves RIGHT:</span>
                            <p>{provesRight}</p>
                        </div>
                        <div class="detail-item">
                            <span>✗ Proves WRONG:</span>
                            <p>{provesWrong}</p>
                        </div>
                    </div>
                    <div class="bet-meta">
                        <div class="meta-item">
                            <span>Starting confidence:</span>
                            <span class="meta-value">50%</span>
                        </div>
                        <div class="meta-item">
                            <span>Target:</span>
                            <span class="meta-value"
                                >{new Date(targetDate).toLocaleDateString()}</span
                            >
                        </div>
                    </div>
                    <div class="next-steps">
                        <p>What happens next:</p>
                        <p class="next-text">
                            Start gathering evidence from GitHub, Discord, blogs, Reddit threads,
                            and conversations. Track signals as they emerge over time.
                        </p>
                    </div>
                </div>
            {/if}
            <div class="step-actions">
                <button type="button" class="btn-secondary" onclick={prevStep}>Back</button>
                <button type="submit" class="btn-primary" disabled={submitting || flavouringTopic}>
                    {submitting ? 'Placing Bet...' : 'Place This Bet →'}
                </button>
            </div>
        </div>
    {/if}
</form>

<style>
    .quick-bet-form {
        padding: 24px;
    }

    .steps-indicator {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-bottom: 48px;
    }

    .step-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--bg-tertiary);
        border: 2px solid var(--border);
        transition: all 0.3s ease;
    }

    .step-dot.active {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        transform: scale(1.3);
    }

    .step-dot.completed {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .hint {
        font-size: 14px;
        color: var(--text-tertiary);
        margin: 0 0 32px 0;
        font-style: italic;
    }

    .feedback {
        font-size: 14px;
        color: var(--accent-primary);
        margin: 8px 0 0 0;
        font-weight: 500;
        animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .bet-preview {
        margin: 32px 0;
        padding: 24px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }

    .preview-claim {
        font-size: 16px;
        color: var(--text-primary);
        margin: 0 0 16px 0;
        line-height: 1.5;
    }

    .preview-details {
        display: flex;
        gap: 16px;
        font-size: 13px;
        color: var(--text-tertiary);
    }

    .step-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 24px;
    }

    .topic-loading {
        padding: 16px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        text-align: center;
        margin: 24px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }

    .topic-loading span:first-child {
        font-size: 14px;
        color: var(--text-secondary);
        font-style: italic;
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

    .bet-confirmation {
        padding: 24px;
        background: var(--bg-elevated);
        border: 2px solid var(--accent-primary);
        border-radius: var(--radius-md);
        margin: 24px 0;
    }

    .preview-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
    }

    .preview-icon {
        font-size: 28px;
    }

    .bet-confirmation h3 {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-secondary);
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .bet-title {
        margin-bottom: 16px;
    }

    .bet-title h4 {
        font-size: 20px;
        font-weight: 700;
        color: var(--accent-primary);
        margin: 0 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .bet-confirmation .description {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0 0 16px 0;
        line-height: 1.6;
        font-style: italic;
        padding: 12px;
        background: var(--bg-tertiary);
        border-left: 3px solid var(--border);
        border-radius: 4px;
    }

    .topic-section {
        margin-bottom: 20px;
    }

    .topic-badges {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }


    .topic-explainer {
        padding: 14px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        border-left: 3px solid var(--accent-primary);
    }

    .topic-explainer strong {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: var(--accent-primary);
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .topic-explainer p {
        font-size: 12px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 0;
    }

    .bet-details {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
    }

    .detail-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .detail-item p {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary);
        margin: 0;
    }

    .bet-meta {
        padding: 12px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .meta-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .meta-value {
        font-size: 16px;
        font-weight: 700;
        color: var(--accent-primary);
    }

    .next-steps {
        padding: 14px;
        background: rgba(59, 130, 246, 0.05);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius-sm);
    }

    .next-text {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin: 0;
    }

    .form-input::placeholder,
    .form-textarea::placeholder {
        color: var(--text-tertiary);
        opacity: 0.6;
    }
</style>
