<script lang="ts">
    import { goto } from '$app/navigation'
    import { drydock } from 'services/drydock.svelte'
    import { Navbar } from 'components'
    import { confirm, message } from '@tauri-apps/plugin-dialog'

    let repo = $state('')
    let parsingGH = $state(false)
    let error = $state<string | null>(null)
    let fromRepo = $state<string | null>(null)

    type CutoffModal = {
        open: boolean
        coastlineId: string
        releases: { tag: string; name: string; publishedAt: Date }[]
        selected: string
    } | null

    let cutoffModal = $state<CutoffModal>(null)
    let loadingReleases = $state(false)
    let visibleCount = $state(10)

    async function openCutoffModal(e: Event, id: string) {
        e.stopPropagation()
        fromRepo = id
        loadingReleases = true
        try {
            const releases = await drydock.getCoastlineReleases(id)
            cutoffModal = {
                open: true,
                coastlineId: id,
                releases,
                selected: 'none',
            }
        } finally {
            loadingReleases = false
        }
    }

    function formatDate(d: Date): string {
        const day = d.getDate()
        const suffixes = ['th', 'st', 'nd', 'rd']
        const v = day % 100
        const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[day % 10] || 'th'
        const month = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
        return `${day}${suffix} ${month}`
    }

    async function confirmFetch() {
        if (!cutoffModal) return
        const { coastlineId, selected, releases } = cutoffModal
        const cutoffDate =
            selected === 'none' ? undefined : releases.find((r) => r.tag === selected)?.publishedAt
        cutoffModal = null
        try {
            await drydock.fetchCoastlineMeta(coastlineId, cutoffDate)
        } catch (e) {
            console.error('fetch error:', e)
            message('Please check your Drydock settings. We could not connect to Github.')
        } finally {
            fromRepo = null
        }
    }

    function cancelCutoff() {
        cutoffModal = null
        fromRepo = null
    }

    async function deleteCoastline(e: Event, id: string) {
        e.stopPropagation()
        const c = drydock.coastlines.find((x) => x.id === id)
        if (!c) return
        const absolutelySure = await confirm(`Delete "${c.name}" and all its data?`, {
            title: 'Are you sure?',
            kind: 'warning',
        })
        if (absolutelySure) {
            document.startViewTransition(() => drydock.deleteCoastline(id))
        }
    }

    async function addNewRepo() {
        const url = repo.trim()
        if (!url) return
        parsingGH = true
        try {
            await drydock.registerCoastline(url)
            repo = 'https://github.com'
        } catch (e: any) {
            error = e?.message || 'Something went wrong. Try again?'
        } finally {
            parsingGH = false
        }
    }

    function metaStreaming(coastlineId: string) {
        const sources = drydock.concernSources.filter((s) => s.coastlineId === coastlineId)
        return {
            debate: sources.filter((source) => source.concern === 'debate').length,
            attempt: sources.filter((source) => source.concern === 'attempt').length,
            ship: sources.filter((source) => source.concern === 'ship').length,
        }
    }

    function concernSummary(counts: {
        debate: number
        attempt: number
        ship: number
    }): { label: string; colorClass: string } | null {
        const { debate, attempt, ship } = counts
        const total = debate + attempt + ship
        if (total === 0) return null

        const avg = total / 3
        const maxDev = Math.max(
            Math.abs(debate - avg),
            Math.abs(attempt - avg),
            Math.abs(ship - avg)
        )
        if (maxDev / avg < 0.3) {
            return { label: 'balanced', colorClass: 'concern-balanced' }
        }

        const ranked = [
            { name: 'debate', count: debate },
            { name: 'attempt', count: attempt },
            { name: 'ship', count: ship },
        ].sort((a, b) => b.count - a.count)

        const [first, second, third] = ranked
        const key = `${first.name}-${second.name}-${third.name}`

        const labels: Record<string, { label: string; colorClass: string }> = {
            'debate-attempt-ship': { label: 'deliberating', colorClass: 'concern-debate' },
            'debate-ship-attempt': {
                label: 'discussing but maintaining',
                colorClass: 'concern-debate',
            },
            'attempt-debate-ship': { label: 'building', colorClass: 'concern-attempt' },
            'attempt-ship-debate': { label: 'backlogged', colorClass: 'concern-attempt' },
            'ship-attempt-debate': { label: 'shipping', colorClass: 'concern-ship' },
            'ship-debate-attempt': { label: 'maintaining', colorClass: 'concern-ship' },
        }

        return labels[key] ?? { label: 'active', colorClass: 'concern-balanced' }
    }
</script>

<Navbar compact />

<main class="coastlines-route">
    <div class="register-row">
        <input
            class="form-input"
            bind:value={repo}
            placeholder="https://github.com/owner/repo"
            onkeydown={(e) => e.key === 'Enter' && addNewRepo()}
            disabled={parsingGH} />
        <button class="btn-primary" onclick={addNewRepo} disabled={parsingGH}>
            {parsingGH ? 'Registering…' : 'Add repo'}
        </button>
    </div>
    {#if error}
        <p class="error">{error}</p>
    {/if}

    {#if drydock.coastlinesLoading}
        <div class="loading">
            <div class="spinner"></div>
        </div>
    {:else if drydock.coastlines.length === 0}
        <p class="empty">No coastlines yet. Add a GitHub repo URL above.</p>
    {:else}
        <div class="concern-legend">
            <div class="info-circle">i</div>
            <div class="legend-popup">
                <div class="legend-entries">
                    <div class="legend-row">
                        <span class="legend-label concern-debate">deliberating</span>
                        <span class="legend-desc">debate dominates, slow to commit to changes</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-debate">discussing but maintaining</span>
                        <span class="legend-desc">debate-heavy but still ships</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-attempt">building</span>
                        <span class="legend-desc">PRs flowing, community engaged</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-attempt">backlogged</span>
                        <span class="legend-desc"
                            >lots of PRs, not all landing, review bottleneck</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-ship">shipping</span>
                        <span class="legend-desc">delivery-focused, PRs landing</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-ship">maintaining</span>
                        <span class="legend-desc">steady releases and minimal churn</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-label concern-balanced">balanced</span>
                        <span class="legend-desc">healthy flow</span>
                    </div>
                </div>
            </div>
        </div>

        <ul class="coastline-list">
            {#each drydock.coastlines.slice(0, visibleCount) as c (c.id)}
                {@const counts = metaStreaming(c.id)}
                {@const summary = concernSummary(counts)}
                <li
                    class="coastline-card"
                    style="view-transition-name: card-{c.id}"
                    onclick={() => goto(`/coastline/${c.id}`)}>
                    <div class="card-actions">
                        <button
                            class="action-btn action-fetch"
                            onclick={(e) => openCutoffModal(e, c.id)}
                            disabled={fromRepo !== null}
                            title={c.lastFetchedAt ? 'Re-fetch' : 'Fetch signals'}>
                            {fromRepo === c.id ? '…' : '↻'}
                        </button>
                        <button
                            class="action-btn action-delete"
                            onclick={(e) => deleteCoastline(e, c.id)}
                            title="Delete coastline">
                            ×
                        </button>
                    </div>
                    <div class="card-content">
                        <div class="coastline-name">{c.name}</div>
                        <div class="coastline-meta">
                            {#if fromRepo === c.id && drydock.fetchProgress}
                                {@const p = drydock.fetchProgress}
                                <span class="fetch-phase">{p.phase} {p.current}/{p.total}</span>
                                <div class="fetch-bar">
                                    <div
                                        class="fetch-bar-fill"
                                        style="width:{p.total > 0
                                            ? (p.current / p.total) * 100
                                            : 0}%">
                                    </div>
                                </div>
                            {:else}
                                {#if c.lastFetchedAt}
                                    <span class="fetched"
                                        >fetched {c.lastFetchedAt.toLocaleDateString()}</span>
                                {:else}
                                    <span class="unfetched">not yet fetched</span>
                                {/if}
                                {#if summary}
                                    <span class="concern-label {summary.colorClass}"
                                        >{summary.label}</span>
                                {/if}
                            {/if}
                        </div>
                    </div>
                </li>
            {/each}
        </ul>
        {#if drydock.coastlines.length > visibleCount}
            <button class="btn-secondary" onclick={() => (visibleCount += 10)}>Load more</button>
        {/if}
    {/if}
</main>

{#if cutoffModal}
    <div class="modal-backdrop" onclick={cancelCutoff}>
        <div class="modal-container modal-sm" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
                <h3>Anchor to release</h3>
                <button class="close-btn" onclick={cancelCutoff}>×</button>
            </div>
            <div class="modal-body">
                <p class="modal-hint">
                    Fetch only concern sources that equal or post-date the selected release.
                </p>
                <div class="release-list">
                    {#each cutoffModal.releases as r (r.tag)}
                        <label class="release-option" class:active={cutoffModal.selected === r.tag}>
                            <input
                                type="radio"
                                name="release-cutoff"
                                value={r.tag}
                                bind:group={cutoffModal.selected} />
                            <span class="release-tag">{r.name}</span>
                            <span class="release-date">{formatDate(r.publishedAt)}</span>
                        </label>
                    {/each}
                    <label class="release-option" class:active={cutoffModal.selected === 'none'}>
                        <input
                            type="radio"
                            name="release-cutoff"
                            value="none"
                            bind:group={cutoffModal.selected} />
                        <span class="release-tag">No cutoff</span>
                        <span class="release-date">Fetch everything</span>
                    </label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick={cancelCutoff}>Cancel</button>
                <button class="btn-primary" onclick={confirmFetch}>Fetch</button>
            </div>
        </div>
    </div>
{/if}

<style>
    main {
        min-height: 100vh;
    }

    .coastlines-route {
        flex: 1;
        overflow-y: auto;
        padding: 92px 24px 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 800px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
    }

    .register-row {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
    }

    .error {
        color: var(--color-refutes, #e55);
        font-size: 13px;
        margin: 0;
    }

    .empty {
        opacity: 0.5;
        font-size: 14px;
    }

    .concern-legend {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: flex-end;
        z-index: 10;
    }

    .info-circle {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            background 0.2s,
            color 0.2s;
    }

    .concern-legend:hover .info-circle {
        background: var(--bg-elevated);
        color: var(--accent-primary);
    }

    .legend-popup {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 8px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 14px 16px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 10;
        min-width: 320px;
    }

    .concern-legend:hover .legend-popup {
        opacity: 1;
    }

    .legend-hint {
        font-size: 11px;
        color: var(--text-tertiary);
        margin: 0 0 10px;
        line-height: 1.4;
    }

    .legend-entries {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .legend-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-size: 11px;
    }

    .legend-label {
        font-weight: 600;
        flex-shrink: 0;
        font-size: 11px;
    }

    .legend-desc {
        color: var(--text-secondary);
        font-size: 11px;
    }

    .coastline-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .coastline-card {
        position: relative;
        cursor: pointer;
    }

    .card-actions {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        display: flex;
        align-items: stretch;
        z-index: 0;
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .card-content {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        transition: transform 0.2s ease;
        z-index: 1;
    }

    .coastline-card:hover .card-content {
        transform: translateX(-104px);
        transition-delay: 1s;
    }

    .action-btn {
        border: none;
        padding: 0 16px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        transition:
            background 0.15s,
            color 0.15s;
    }

    .action-fetch {
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        border-left: 1px solid var(--border);
    }

    .action-fetch:hover {
        background: var(--bg-elevated);
        color: var(--text-primary);
    }

    .action-delete {
        background: var(--error);
        color: var(--flexoki-paper);
    }

    .action-delete:hover {
        background: #d63939;
    }

    .coastline-name {
        font-weight: 600;
        font-size: 15px;
    }

    .coastline-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }

    .fetched {
        opacity: 0.5;
    }

    .unfetched {
        opacity: 0.35;
        font-style: italic;
    }

    .concern-label {
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
    }

    .concern-debate {
        background: var(--pill-debate-bg, #e8f0fe);
        color: var(--pill-debate-fg, #1a56db);
    }

    .concern-attempt {
        background: var(--pill-attempt-bg, #fef3c7);
        color: var(--pill-attempt-fg, #b45309);
    }

    .concern-ship {
        background: var(--pill-ship-bg, #d1fae5);
        color: var(--pill-ship-fg, #065f46);
    }

    .concern-balanced {
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }

    .fetch-phase {
        font-size: 11px;
        font-weight: 600;
        opacity: 0.6;
    }

    .fetch-bar {
        width: 60px;
        height: 4px;
        border-radius: 2px;
        background: var(--border, #ccc);
        overflow: hidden;
    }

    .fetch-bar-fill {
        height: 100%;
        background: var(--accent-primary, #3b82f6);
        border-radius: 2px;
        transition: width 0.2s ease;
    }

    .modal-hint {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0 0 16px;
    }

    .release-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 50vh;
        overflow-y: auto;
    }

    .release-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        border: 1px solid transparent;
        transition:
            background 0.1s,
            border-color 0.1s;
    }

    .release-option:hover {
        background: var(--bg-tertiary);
    }

    .release-option.active {
        background: var(--bg-tertiary);
        border-color: var(--accent-primary);
    }

    .release-option input[type='radio'] {
        accent-color: var(--accent-primary);
    }

    .release-tag {
        font-weight: 600;
        font-size: 13px;
        flex: 1;
    }

    .release-date {
        font-size: 12px;
        color: var(--text-tertiary);
    }
</style>
