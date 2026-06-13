<script lang="ts">
    import type { Sentiment, Source, Evidence } from 'schema'
    import { boostCredibility } from 'utils'
    import { drydock } from 'services/drydock.svelte'
    import { TiptapEditor } from 'components'

    let {
        closeEvent,
        editing,
        betId,
    }: {
        closeEvent: () => void
        editing: Evidence | null
        betId: string
    } = $props()

    let source = $derived<Source>(editing?.source || 'github')
    let url = $derived(editing?.url === 'N/A' ? '' : editing?.url || '')
    let title = $derived(editing?.title || '')
    let snippet = $derived(editing?.snippet || '')
    let sentiment = $derived<Sentiment | undefined>(editing?.sentiment)
    let weight = $derived.by(() => {
        const baseWeight = 3 // TODO: changed to default when we removed tool weighting
        const boost = boostCredibility(source, credibility)
        return Math.max(1, Math.min(5, baseWeight + boost))
    })

    const weightLabels: Record<number, string> = {
        1: 'Anecdotal',
        2: 'Suggestive',
        3: 'Moderate',
        4: 'Strong',
        5: 'Conclusive',
    }
    let weightLabel = $derived(weightLabels[weight])

    let showAdvanced = $state(false)
    let credibility = $state<'high' | 'medium' | 'low'>('medium')

    async function handleSubmit(e: Event) {
        e.preventDefault()

        const finalUrl = url.trim() || 'N/A'

        if (editing) {
            await drydock.updateEvidence(editing.id, {
                source,
                url: finalUrl,
                title,
                snippet,
                sentiment,
                weight,
            })
        } else {
            await drydock.rubberStampEvidence({
                betId,
                source,
                url: finalUrl,
                title,
                snippet,
                capturedAt: new Date(),
                sentiment,
                weight,
            })
        }

        closeEvent()
    }
</script>

<!-- src/lib/components/forms/EvidenceFNumberorm.svelte -->
ocean

<div
    class="modal-backdrop"
    role="presentation"
    onclick={closeEvent}
    onkeydown={(e) => e.key === 'Escape' && closeEvent()}
    tabindex="-1"
>
    <div
        class="modal-container modal-lg"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit evidence entry' : 'Log new evidence entry'}
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
    >
        <form class="modal-body" onsubmit={handleSubmit}>
            <div class="form-row">
                <div class="form-group">
                    <label for="source">Source</label>
                    <select
                        id="source"
                        class="form-select"
                        bind:value={source}
                        tabindex="0"
                        aria-label="Evidence source"
                    >
                        <option value="github">GitHub</option>
                        <option value="bluesky">Bluesky</option>
                        <option value="docs">Documentation</option>
                        <option value="blog">Blog Post</option>
                        <option value="conversation">Conversation</option>
                        <option value="client-work">Client Work</option>
                        <option value="discord">Discord</option>
                        <option value="reddit">Reddit</option>
                        <option value="twitter">Twitter</option>
                        <option value="other">Other</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="url">URL (optional)</label>
                    <input
                        id="url"
                        class="form-input"
                        type="url"
                        bind:value={url}
                        placeholder="Optional link"
                        tabindex="0"
                        aria-label="Evidence URL"
                    />
                </div>
            </div>

            {#if source === 'conversation' || source === 'client-work'}
                <div class="form-group">
                    <label for="credibility">From</label>
                    <select
                        id="credibility"
                        class="form-select"
                        bind:value={credibility}
                        tabindex="0"
                        aria-label="Source credibility"
                    >
                        <option value="high">Framework creator / Core maintainer</option>
                        <option value="medium">Experienced developer / Team lead</option>
                        <option value="low">Random person / Unverified</option>
                    </select>
                </div>
            {/if}

            <div class="form-group">
                <label for="title">Title</label>
                <input
                    id="title"
                    class="form-input"
                    type="text"
                    bind:value={title}
                    placeholder="Headline this evidence"
                    required
                    tabindex="0"
                    aria-required="true"
                    aria-label="Evidence title"
                />
            </div>

            <div class="form-group">
                <label for="snippet">What you found</label>
                <TiptapEditor
                    value={snippet}
                    onchange={(text) => (snippet = text)}
                    placeholder="..."
                />
            </div>

            <!-- Dropdown -->
            <button
                type="button"
                class="toggle-advanced"
                onclick={() => (showAdvanced = !showAdvanced)}
                aria-expanded={showAdvanced}
                aria-controls="advanced-section"
                aria-label="Toggle advanced options"
                tabindex="0"
            >
                {showAdvanced ? '▼' : '▶'} Advanced options
            </button>

            <div
                class="advanced-section"
                id="advanced-section"
                role="region"
                aria-label="Advanced options"
                class:open={showAdvanced}
            >
                <div class="advanced-inner">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="sentiment">Does this support the bet or otherwise?</label>
                            <select
                                id="sentiment"
                                class="form-select"
                                bind:value={sentiment}
                                tabindex="0"
                                aria-label="Evidence sentiment"
                            >
                                <option value={undefined}>Not specified</option>
                                <option value="supports">Supports</option>
                                <option value="refutes">Refutes</option>
                                <option value="neutral">Neutral</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="weight">Weight — {weightLabel}</label>
                            <input
                                id="weight"
                                type="range"
                                bind:value={weight}
                                min="1"
                                max="5"
                                step="1"
                                aria-valuemin="1"
                                aria-valuemax="5"
                                aria-valuenow={weight}
                                aria-label="Evidence weight"
                                tabindex="0"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div class="form-actions" role="group" aria-label="Form actions">
                <button
                    type="button"
                    class="btn-secondary"
                    onclick={closeEvent}
                    tabindex="0"
                    aria-label="Cancel and close dialog"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    class="btn-primary"
                    tabindex="0"
                    aria-label={editing ? 'Update evidence entry' : 'Log new evidence entry'}
                >
                    {editing ? 'Update' : 'Book It'}
                </button>
            </div>
        </form>
    </div>
</div>

<style>
    .toggle-advanced {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        padding: 8px 0;
        text-align: left;
        transition: var(--transition);
    }

    .toggle-advanced:hover {
        color: var(--text-primary);
    }

    .advanced-section {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 300ms ease-out;
    }

    .advanced-section.open {
        grid-template-rows: 1fr;
    }

    .advanced-inner {
        overflow: hidden;
    }

    .advanced-inner > * {
        padding: 16px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }

    input[type='range'] {
        width: 100%;
        height: 6px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 3px;
        outline: none;
        padding: 0;
    }

    input[type='range']::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--accent-primary);
        cursor: pointer;
        border: 2px solid var(--bg-primary);
    }

    input[type='range']::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--accent-primary);
        cursor: pointer;
        border: 2px solid var(--bg-primary);
    }
</style>
