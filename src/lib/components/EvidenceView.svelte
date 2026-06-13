<!-- src/lib/components/EvidenceView.svelte -->
<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import type { Bet, Evidence, TopicNature } from 'schema'
    import { TOPIC_LABELS } from 'schema'
    import { EvidenceForm, BetForm } from 'components'
    import { openUrl } from '@tauri-apps/plugin-opener'
    import { invoke } from '@tauri-apps/api/core'

    let {
        bet,
        closing,
        onEdit,
        onAddEvidence,
        onToggleStats,
    }: {
        bet: Bet
        closing: () => void
        onEdit?: (bet: Bet) => void
        onAddEvidence?: (betId: string, editing: Evidence | null) => void
        onToggleStats?: () => void
    } = $props()

    const evidence = $derived(drydock.evidenceFor(bet.id))

    let currentEvidenceIndex = $state(0)
    let currentEvidence = $derived(evidence[currentEvidenceIndex])

    let betOpenedId = $derived<string | null>(null)
    let evidenceFormOpenedWith = $state<{ betId: string; editing: Evidence | null } | null>(null)
    let retriggering = $state(false)
    let topicOverrideOpen = $state(false)

    async function retriggerTopic() {
        retriggering = true
        try {
            const result = await invoke<TopicNature>('flavour_topic_local', {
                claim: bet.claim,
                description: bet.description,
            })
            await drydock.updateTopic(bet.id, { frequency: result.frequency, confidence: result.confidence })
            if (result.reasoning) {
                await drydock.logOllamaTask(
                    'flavour_topic_local',
                    bet.id,
                    `${bet.claim} ${bet.description}`,
                    result.reasoning,
                    JSON.stringify({ frequency: result.frequency, confidence: result.confidence })
                )
            }
        } finally {
            retriggering = false
        }
    }


    function skipForward() {
        const target = Math.min(currentEvidenceIndex + 10, evidence.length - 1)
        if (target !== currentEvidenceIndex) {
            currentEvidenceIndex = target
        }
    }

    function skipBack() {
        const target = Math.max(currentEvidenceIndex - 10, 0)
        if (target !== currentEvidenceIndex) {
            currentEvidenceIndex = target
        }
    }

    function nextEvidence() {
        if (currentEvidenceIndex < evidence.length - 1) {
            animator.animate('.evidence-card', {
                opacity: [1, 0],
                translateX: [0, -100],
                duration: 200,
                ease: 'in(2)',
                autoplay: true,
                complete: () => {
                    currentEvidenceIndex++
                    requestAnimationFrame(() => {
                        animator.animate('.evidence-card', {
                            opacity: [0, 1],
                            translateX: [100, 0],
                            duration: 300,
                            ease: 'out(2)',
                            autoplay: true,
                        })
                    })
                },
            })
        }
    }

    function prevEvidence() {
        if (currentEvidenceIndex > 0) {
            animator.animate('.evidence-card', {
                opacity: [1, 0],
                translateX: [0, 100],
                duration: 200,
                ease: 'in(2)',
                autoplay: true,
                complete: () => {
                    currentEvidenceIndex--
                    requestAnimationFrame(() => {
                        animator.animate('.evidence-card', {
                            opacity: [0, 1],
                            translateX: [-100, 0],
                            duration: 300,
                            ease: 'out(2)',
                            autoplay: true,
                        })
                    })
                },
            })
        }
    }
</script>

<section class="evidence-view">
    <div class="section-header">
        <div class="view-header-content">
            <h2>{bet.claim}</h2>
            <p class="description">{bet.description}</p>
        </div>

        <div class="header-actions">
            {#if onToggleStats}
                <button class="btn-secondary" onclick={onToggleStats} title="Toggle stats panel">
                    Stats
                </button>
            {/if}
            <button
                class="btn-secondary"
                onclick={() => {
                    if (onEdit) {
                        onEdit(bet)
                    } else {
                        betOpenedId = bet.id
                    }
                }}
                title="Change Your Bet">Change Your Bet</button
            >
            <button
                class="btn-primary"
                onclick={() => {
                    if (onAddEvidence) {
                        onAddEvidence(bet.id, null)
                    } else {
                        evidenceFormOpenedWith = { betId: bet.id, editing: null }
                    }
                }}>+ Add Evidence</button
            >
            <button
                class="btn-danger"
                onclick={async () => {
                    await drydock.killBet(bet.id)
                    closing()
                }}
                title="Delete this bet">Delete This Bet</button
            >
        </div>
    </div>

    <div class="content-grid">
        <!-- Main content area - Evidence -->
        <div class="evidence-main">
            <div class="evidence-list">
                {#if evidence.length > 0}
                    <div class="evidence-nav">
                        <button
                            class="nav-btn"
                            onclick={skipBack}
                            disabled={currentEvidenceIndex === 0}
                            aria-label="Skip back 10"
                        >
                            ←←
                        </button>
                        <button
                            class="nav-btn"
                            onclick={prevEvidence}
                            disabled={currentEvidenceIndex === 0}
                            aria-label="Previous evidence"
                        >
                            ←
                        </button>
                        <span class="evidence-counter">
                            {currentEvidenceIndex + 1} / {evidence.length}
                        </span>
                        <button
                            class="nav-btn"
                            onclick={nextEvidence}
                            disabled={currentEvidenceIndex === evidence.length - 1}
                            aria-label="Next evidence"
                        >
                            →
                        </button>
                        <button
                            class="nav-btn"
                            onclick={skipForward}
                            disabled={currentEvidenceIndex === evidence.length - 1}
                            aria-label="Skip forward 10"
                        >
                            →→
                        </button>
                    </div>

                    {#if currentEvidence}
                        <div
                            class="evidence-card"
                            class:supports={currentEvidence.sentiment === 'supports'}
                            class:refutes={currentEvidence.sentiment === 'refutes'}
                            class:neutral={!currentEvidence.sentiment ||
                                currentEvidence.sentiment === 'neutral'}
                        >
                            <div class="evidence-header">
                                <div class="evidence-meta">
                                    <span class="evidence-source">{currentEvidence.source}</span>
                                    <span class="evidence-date">
                                        {new Intl.DateTimeFormat('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        }).format(currentEvidence.sourceCreatedAt)}
                                    </span>
                                </div>

                                {#if currentEvidence.sentiment}
                                    <span
                                        class="badge"
                                        class:badge-supports={currentEvidence.sentiment ===
                                            'supports'}
                                        class:badge-refutes={currentEvidence.sentiment ===
                                            'refutes'}
                                    >
                                        {currentEvidence.sentiment === 'supports'
                                            ? '✓'
                                            : currentEvidence.sentiment === 'refutes'
                                              ? '✗'
                                              : '○'}
                                        {currentEvidence.sentiment}
                                    </span>
                                {/if}
                            </div>

                            <h3 class="evidence-title">{currentEvidence.title}</h3>
                            <div class="evidence-snippet-container">
                                <p class="evidence-snippet">{currentEvidence.snippet}</p>
                            </div>

                            <div class="evidence-actions">
                                {#if currentEvidence.url && currentEvidence.url !== 'N/A'}
                                    <button
                                        class="evidence-link"
                                        onclick={() => openUrl(currentEvidence.url)}
                                    >
                                        See Original Post
                                    </button>
                                {:else}
                                    <span class="no-url">No URL</span>
                                {/if}
                                <div class="action-buttons">
                                    <button
                                        class="btn-primary"
                                        onclick={() =>
                                            (evidenceFormOpenedWith = {
                                                betId: currentEvidence.betId,
                                                editing: currentEvidence,
                                            })}
                                        title="Edit evidence">✏️</button
                                    >
                                    <button
                                        class="btn-primary"
                                        onclick={() => drydock.burnEvidence(currentEvidence.id)}
                                        title="Delete evidence">🗑️</button
                                    >
                                </div>
                            </div>
                        </div>
                    {/if}
                {:else}
                    <div class="empty-state">
                        <p>No evidence yet. Add evidence to start tracking signals.</p>
                        <button
                            class="btn-primary"
                            onclick={() =>
                                (evidenceFormOpenedWith = {
                                    betId: bet.id,
                                    editing: null,
                                })}
                        >
                            Add First Evidence
                        </button>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Sidebar - Validation Criteria -->
        <div class="sidebar">
            {#if bet.provesRight || bet.provesWrong}
                <div class="sidebar-section card">
                    <h3 class="sidebar-title">Remember</h3>
                    {#if bet.provesRight}
                        <div class="validation-item wins">
                            <span class="validation-label">This Bet Wins</span>
                            <span class="validation-text">{bet.provesRight}</span>
                        </div>
                    {/if}
                    {#if bet.provesWrong}
                        <div class="validation-item loses">
                            <span class="validation-label">This Bet Loses</span>
                            <span class="validation-text">{bet.provesWrong}</span>
                        </div>
                    {/if}
                </div>
            {/if}

            <div class="sidebar-section card topic-card">
                <div class="topic-label topic-{bet.topic.frequency}-{bet.topic.confidence}">
                    {TOPIC_LABELS[`${bet.topic.frequency}-${bet.topic.confidence}` as keyof typeof TOPIC_LABELS].label}
                </div>
                <button
                    class="btn-secondary topic-action-btn"
                    onclick={() => (topicOverrideOpen = !topicOverrideOpen)}
                >Change This</button>
                <button
                    class="btn-secondary topic-action-btn"
                    onclick={retriggerTopic}
                    disabled={retriggering}
                >{retriggering ? 'Asking...' : 'Ask Drydock'}</button>
                {#if topicOverrideOpen}
                    <div class="topic-options">
                        {#each Object.entries(TOPIC_LABELS) as [key, { label }]}
                            {@const [freq, conf] = key.split('-')}
                            <button
                                class="topic-option"
                                class:active={bet.topic.frequency === freq && bet.topic.confidence === conf}
                                onclick={() => {
                                    drydock.updateTopic(bet.id, { frequency: freq as any, confidence: conf as any })
                                    topicOverrideOpen = false
                                }}
                            >{label}</button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</section>

{#if betOpenedId}
    <BetForm betId={betOpenedId} closeEvent={() => (betOpenedId = null)} />
{/if}

{#if evidenceFormOpenedWith}
    <EvidenceForm
        closeEvent={() => (evidenceFormOpenedWith = null)}
        betId={evidenceFormOpenedWith.betId}
        editing={evidenceFormOpenedWith.editing}
    />
{/if}

<style>
    .evidence-view {
        padding: 16px;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .view-header-content {
        flex: 1;
        min-width: 0;
        width: 100%;
    }

    .view-header-content h2 {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 10px;
        color: var(--text-primary);
        line-height: 1.3;
    }

    .view-header-content .description {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
        margin-bottom: 0;
    }

    .content-grid {
        display: grid;
        grid-template-columns: 1fr 240px;
        gap: 16px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .evidence-main {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
    }

    .evidence-list {
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    .evidence-nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 12px;
        background: var(--bg-secondary);
        border-radius: var(--radius-md);
        flex-shrink: 0;
    }

    .evidence-counter {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        min-width: 60px;
        text-align: center;
    }

    .sidebar {
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow-y: auto;
        padding-right: 4px;
    }

    .sidebar-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-tertiary);
        margin-bottom: 12px;
    }

    .validation-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
    }

    .validation-item:not(:last-child) {
        margin-bottom: 8px;
    }

    .validation-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-tertiary);
    }

    .validation-item.wins .validation-label {
        color: var(--success);
    }

    .validation-item.loses .validation-label {
        color: var(--error);
    }

    .validation-text {
        font-size: 12px;
        line-height: 1.4;
        color: var(--text-secondary);
    }

    .evidence-card {
        padding: 14px;
        border-left: 3px solid var(--border);
    }

    .evidence-card.supports {
        border-left-color: var(--success);
    }

    .evidence-card.refutes {
        border-left-color: var(--error);
    }

    .evidence-card.neutral {
        border-left-color: var(--text-tertiary);
    }

    .evidence-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        flex-shrink: 0;
    }

    .evidence-meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--text-tertiary);
        align-items: center;
    }

    .evidence-source {
        text-transform: capitalize;
        font-weight: 600;
    }

    .evidence-title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 10px;
        letter-spacing: -0.01em;
        flex-shrink: 0;
    }

    .evidence-snippet-container {
        flex: 1;
        overflow-y: auto;
        margin-bottom: 12px;
        min-height: 0;
    }

    .evidence-snippet {
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-secondary);
    }

    .evidence-link {
        display: inline-block;
        font-size: 13px;
        text-decoration: none;
        font-weight: 500;
        border: none;
        border-radius: 4px;
        padding: 8px;
    }

    .evidence-link:hover {
        color: var(--accent-secondary);
    }

    .no-url {
        font-size: 13px;
        color: var(--text-tertiary);
        font-style: italic;
    }

    .evidence-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
    }

    .action-buttons {
        display: flex;
        gap: 8px;
    }

    .topic-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .topic-label {
        font-size: 15px;
        font-weight: 700;
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        text-align: center;
        letter-spacing: 0.3px;
    }

    .topic-high-high {
        background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
        color: var(--accent-secondary);
        border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }

    .topic-high-low {
        background: color-mix(in srgb, var(--warning) 12%, transparent);
        color: var(--warning);
        border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
    }

    .topic-low-high {
        background: color-mix(in srgb, var(--success) 12%, transparent);
        color: var(--success);
        border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
    }

    .topic-low-low {
        background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
        color: var(--text-tertiary);
        border: 1px solid color-mix(in srgb, var(--text-tertiary) 30%, transparent);
    }

    .topic-action-btn {
        width: 100%;
        font-size: 12px;
    }

    .topic-options {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-top: 8px;
        border-top: 1px solid var(--border);
    }

    .topic-option {
        text-align: left;
        padding: 6px 10px;
        font-size: 12px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
    }

    .topic-option.active {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
        background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    }
</style>
