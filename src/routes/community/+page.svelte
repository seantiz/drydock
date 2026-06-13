<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { Navbar } from 'components'
    import type { Frequency, Confidence } from 'schema'

    let manualText = $state('')
    let promotingId = $state<string | null>(null)
    let promoteFrequency = $state<Frequency>('low')
    let promoteConfidence = $state<Confidence>('low')

    async function addManual() {
        const text = manualText.trim()
        if (!text) return
        manualText = ''
        await drydock.collect(text)
    }

    async function promote(id: string) {
        await drydock.ptl(id, promoteFrequency, promoteConfidence)
        promotingId = null
    }
</script>

<Navbar compact />

<main class="page">
    <div class="page-header">
        <h2>Community Chatter</h2>
    </div>

    <div class="panels">
        <!-- Inbox -->
        <section class="card">
            <div class="section-header">
                <h3>Inbox</h3>
                <div class="add-row">
                    <input
                        class="form-input"
                        bind:value={manualText}
                        placeholder="Add a topic example..."
                        onkeydown={(e) => e.key === 'Enter' && addManual()}
                    />
                    <button class="btn-primary" onclick={addManual}>Add</button>
                </div>
            </div>

            {#if drydock.newChatter.length === 0}
                <p class="empty">No inbox entries. Add one above or approve signals from Radar.</p>
            {:else}
                <ul class="entry-list">
                    {#each drydock.newChatter as entry (entry.id)}
                        <li class="entry">
                            <p class="entry-text">{entry.text}</p>
                            {#if entry.frequency}
                                <div class="entry-meta">
                                    <span class="badge ext-suggested">External</span>
                                    <span class="badge freq-{entry.frequency}"
                                        >{entry.frequency} freq</span
                                    >
                                    <span class="badge conf-{entry.confidence}"
                                        >{entry.confidence} conf</span
                                    >
                                </div>
                            {/if}
                            {#if promotingId === entry.id}
                                <div class="promote-controls">
                                    <label>
                                        Frequency
                                        <select bind:value={promoteFrequency}>
                                            <option value="high">High</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </label>
                                    <label>
                                        Confidence
                                        <select bind:value={promoteConfidence}>
                                            <option value="high">High</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </label>
                                    <button class="btn-primary" onclick={() => promote(entry.id)}
                                        >Promote</button
                                    >
                                    <button
                                        class="btn-secondary"
                                        onclick={() => (promotingId = null)}>Cancel</button
                                    >
                                </div>
                            {:else}
                                <div class="entry-actions">
                                    <button
                                        class="btn-accent"
                                        onclick={() => {
                                            promotingId = entry.id
                                            promoteFrequency = entry.frequency ?? 'low'
                                            promoteConfidence = entry.confidence ?? 'low'
                                        }}
                                    >
                                        {entry.frequency ? 'Review & Promote' : 'Tag & Promote'}
                                    </button>
                                    <button class="btn-ghost" onclick={() => drydock.dfi(entry.id)}
                                        >✕</button
                                    >
                                </div>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>

        <!-- Library -->
        <section class="card">
            <div class="section-header">
                <h3>Library</h3>
                <button class="btn-secondary" onclick={() => drydock.reembedLibrary()}
                    >Re-embed All</button
                >
            </div>

            {#if drydock.chatterLibrary.length === 0}
                <p class="empty">No library entries yet. Promote items from the inbox.</p>
            {:else}
                <ul class="entry-list">
                    {#each drydock.chatterLibrary as entry (entry.id)}
                        <li class="entry">
                            <p class="entry-text">{entry.text}</p>
                            <div class="entry-meta">
                                <span class="badge freq-{entry.frequency}"
                                    >{entry.frequency} freq</span
                                >
                                <span class="badge conf-{entry.confidence}"
                                    >{entry.confidence} conf</span
                                >
                            </div>
                            <div class="entry-actions">
                                <button class="btn-ghost" onclick={() => drydock.dfl(entry.id)}
                                    >✕</button
                                >
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>
    </div>
</main>

<style>
    .page {
        padding: 140px 32px 32px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        min-height: 100vh;
    }

    .page-header {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .page-header h2 {
        margin: 0;
        font-size: 28px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .panels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        flex: 1;
    }

    .empty {
        color: var(--text-tertiary);
        font-size: 14px;
        text-align: center;
        padding: 32px 0;
    }

    .entry-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        max-height: calc(100vh - 340px);
    }

    .entry {
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .entry-text {
        margin: 0;
        font-size: 14px;
        color: var(--text-primary);
        line-height: 1.5;
    }

    .entry-meta {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .ext-suggested {
        background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
        color: var(--accent-secondary);
        border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }

    .entry-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .promote-controls {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }

    .promote-controls label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--text-secondary);
    }

    .promote-controls select {
        padding: 4px 8px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 13px;
    }

    .btn-ghost {
        background: none;
        border: none;
        color: var(--text-tertiary);
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        font-size: 14px;
        margin-left: auto;
    }

    .btn-ghost:hover {
        color: var(--text-primary);
        background: var(--bg-secondary);
    }
</style>
