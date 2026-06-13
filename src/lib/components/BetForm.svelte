<!-- src/lib/components/BetForm.svelte -->
<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { message } from '@tauri-apps/plugin-dialog'
    import { invoke } from '@tauri-apps/api/core'
    import { TiptapEditor } from 'components'

    let {
        closeEvent,
        betId,
    }: {
        closeEvent: () => void
        betId: string
    } = $props()

    // UI View controller concerns
    let editing = $derived(drydock.bets.find((b) => b.id === betId)!)
    let submitting = $state(false)
    let searchGuidance = $derived<string | null>(null)
    let loadingGuidance = $derived(false)

    // Ground truth bet object
    let formData = $derived({
        id: editing.id,
        codename: editing.codename,
        claim: editing.claim,
        description: editing.description,
        provesRight: editing.provesRight || '',
        provesWrong: editing.provesWrong || '',
        targetDate: editing.targetDate,
        initialConfidence: editing.initialConfidence,
    })

    // Nature of the surrounding topic we're betting within so we know how to search for evidence on it's changing flavour
    let topicFrequency = $derived<'high' | 'low'>(editing.topic?.frequency || 'low')
    let topicConfidence = $derived<'high' | 'low'>(editing.topic?.confidence || 'low')

    // Bluesky strategy for radar sweeping
    let weWantFirehose = $derived(editing.firehoseFilters?.enabled || false)
    let searchStrategy = $derived(editing.firehoseFilters?.keywords.join(', ') || '')

    // TODO: Do we really need to worry about re-setting status here?
    let missionStatus = $derived<'active' | 'published'>(
        editing.missionStatus === 'published' ? 'published' : 'active'
    )

    $effect(() => {
        if (weWantFirehose) {
            const freq = topicFrequency
            getSearchGuidance(freq)
        }
    })

    // Get search strategy suggestion from ML
    async function getSearchGuidance(freq = topicFrequency) {
        if (!formData.claim) return
        loadingGuidance = true
        searchGuidance = null
        try {
            searchGuidance = await invoke<string>('suggest_search_strategy', {
                claim: formData.claim,
                description: formData.description || '',
                frequency: freq,
            })
        } catch (err) {
            console.error('Search strategy assistant problem:', err)
        } finally {
            loadingGuidance = false
        }
    }

    // Biggest call to action
    async function placeBet(e: Event) {
        e.preventDefault()
        submitting = true
        try {
            const firehoseFilters = weWantFirehose
                ? {
                      enabled: true,
                      keywords: searchStrategy
                          .split(',')
                          .map((k) => k.trim())
                          .filter(Boolean),
                      lastPollTime: editing.firehoseFilters?.lastPollTime,
                  }
                : undefined

            const topic = { frequency: topicFrequency, confidence: topicConfidence }

            await drydock.reviseBet(editing.id, {
                ...formData,
                currentConfidence: editing.currentConfidence,
                topic,
                firehoseFilters,
            })

            // Update mission status separately if changed
            if (missionStatus !== editing.missionStatus) {
                await drydock.changeStatus(editing.id, missionStatus)
            }

            closeEvent()
        } catch (err) {
            message('Failed to save your bet. Please get in touch if this continues.', {
                title: 'Error saving your bet',
                kind: 'error',
            })
            submitting = false
        }
    }

    // Local helpers
    function formatDate(date?: Date): string {
        if (!date) return ''
        const d = new Date(date)
        return d.toISOString().split('T')[0]
    }

    function parseDate(value: string): Date | undefined {
        if (!value) return undefined
        return new Date(value)
    }
</script>

<div
    class="modal-backdrop"
    role="presentation"
    onclick={closeEvent}
    onkeydown={(e) => {
        if (e.key === 'Escape') closeEvent()
    }}
>
    <div
        class="modal-container modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="0"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
    >
        <form class="bet-form" onsubmit={placeBet}>
            <div class="form-group">
                <label for="codename">Codename</label>
                <p class="form-hint" id="claim-hint">A dramatic yet memorable name</p>
                <input
                    class="form-input"
                    id="codename"
                    type="text"
                    value={formData.codename}
                    oninput={(e) => (formData.codename = e.currentTarget.value)}
                    placeholder="Hunt for Red Svelte"
                    aria-describedby="codename-hint"
                    tabindex="0"
                    required
                />
            </div>
            <div class="form-group">
                <label for="mission-status">Status</label>
                <select
                    class="form-select"
                    id="mission-status"
                    bind:value={missionStatus}
                    tabindex="0"
                >
                    <option value="active">Active</option>
                    <option value="published">Published</option>
                </select>
            </div>
            <div class="form-group">
                <label for="claim">Claim</label>
                <p class="form-hint" id="claim-hint">
                    One sentence - what you're betting will happen
                </p>
                <input
                    class="form-input"
                    id="claim"
                    type="text"
                    value={formData.claim}
                    oninput={(e) => (formData.claim = e.currentTarget.value)}
                    placeholder="Frameworks hide complexity rather than eliminate it"
                    aria-describedby="claim-hint"
                    tabindex="0"
                    required
                />
            </div>
            <div class="form-group">
                <label for="description">Context (Optional)</label>
                <TiptapEditor
                    value={formData.description}
                    onchange={(text) => (formData.description = text)}
                    placeholder="Additional context about why this matters..."
                />
            </div>
            <div class="form-group">
                <label for="proves-right">What proves you RIGHT?</label>
                <p class="form-hint" id="proves-right-hint">
                    Specific, observable signals that validate your claim
                </p>
                <TiptapEditor
                    value={formData.provesRight}
                    onchange={(text) => (formData.provesRight = text)}
                    placeholder="Concrete signals that would validate this bet..."
                />
            </div>
            <div class="form-group">
                <label for="proves-wrong">What proves you WRONG?</label>
                <p class="form-hint" id="proves-wrong-hint">
                    Specific, observable signals that refute your claim
                </p>
                <TiptapEditor
                    value={formData.provesWrong}
                    onchange={(text) => (formData.provesWrong = text)}
                    placeholder="Concrete signals that would invalidate this bet..."
                />
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="initial-confidence">Initial Confidence (%)</label>
                    <p class="form-hint">How sure are you right now?</p>
                    <input
                        class="form-input"
                        id="initial-confidence"
                        type="number"
                        value={formData.initialConfidence}
                        oninput={(e) =>
                            (formData.initialConfidence = Number(e.currentTarget.value))}
                        min="0"
                        max="100"
                        tabindex="0"
                        required
                    />
                </div>
                <div class="form-group">
                    <label for="target-date">Target Date (Optional)</label>
                    <p class="form-hint" id="target-date-hint">When to bet will mature or die</p>
                    <input
                        class="form-input"
                        id="target-date"
                        type="date"
                        value={formatDate(formData.targetDate)}
                        aria-describedby="target-date-hint"
                        tabindex="0"
                        onchange={(e) => {
                            formData.targetDate = parseDate(e.currentTarget.value)
                        }}
                    />
                </div>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" bind:checked={weWantFirehose} />
                    Auto-capture signals from Bluesky
                </label>
                <p class="form-hint">Comma-separated search strings — swept every 12 hours</p>
                {#if weWantFirehose}
                    <div class="form-group">
                        <label>Topical Nature</label>
                        <div class="form-row">
                            <select class="form-select" bind:value={topicFrequency}>
                                <option value="high">Hot topic</option>
                                <option value="low">Under-the-radar or emerging topic</option>
                            </select>
                            <select class="form-select" bind:value={topicConfidence}>
                                <option value="high">Established best practices</option>
                                <option value="low">Hotly contested</option>
                            </select>
                        </div>
                    </div>
                    <div class="keyword-guidance">
                        {#if loadingGuidance}
                            <p class="guidance-text guidance-loading">
                                Thinking about your search strategy...
                            </p>
                        {:else if searchGuidance}
                            <p class="guidance-text guidance-intro">
                                Here's what I'd recommend searching for:
                            </p>
                            <div class="guidance-chips">
                                {#each searchGuidance
                                    .split('\n')
                                    .map((s) => s.trim())
                                    .filter(Boolean) as suggestion}
                                    <span class="guidance-chip">{suggestion}</span>
                                {/each}
                            </div>
                        {:else}
                            <p class="guidance-text guidance-fallback">
                                {#if topicFrequency === 'high'}
                                    High-frequency topic — use specific phrase combinations to cut
                                    through noise.
                                {:else}
                                    Niche topic — cast a wider net with related terms and adjacent
                                    concepts.
                                {/if}
                            </p>
                        {/if}
                    </div>
                    <input
                        class="form-input"
                        type="text"
                        bind:value={searchStrategy}
                        placeholder="svelte, runes, complexity"
                    />
                {/if}
            </div>
            <div class="form-actions">
                <button
                    type="button"
                    class="btn-secondary"
                    onclick={closeEvent}
                    disabled={submitting}
                    tabindex="0"
                >
                    Cancel
                </button>
                <button type="submit" class="btn-primary" disabled={submitting} tabindex="0">
                    {submitting ? 'Updating...' : 'Update'}
                </button>
            </div>
        </form>
    </div>
</div>

<style>
    .bet-form {
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 24px;
    }

    .keyword-guidance {
        padding: 12px 16px;
        background: var(--bg-tertiary);
        border-left: 3px solid var(--accent-primary);
        border-radius: var(--radius-sm);
        margin-bottom: 12px;
    }
    .guidance-text {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary);
        margin: 0;
    }
    .guidance-intro {
        margin-bottom: 8px;
    }
    .guidance-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .guidance-chip {
        padding: 4px 10px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 20px;
        font-size: 12px;
        font-family: monospace;
        color: var(--text-primary);
    }
    .guidance-loading {
        opacity: 0.5;
        font-style: italic;
    }
    .guidance-fallback {
        opacity: 0.7;
    }
</style>
