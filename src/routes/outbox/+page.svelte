<script lang="ts">
    import type { Media, Block, BlockHeaders, EvidenceChip } from 'schema'
    import { ROLE_LABELS } from 'schema'
    import { drydock } from 'services/drydock.svelte'
    import { blogReady, generateId } from 'utils'
    import { invoke } from '@tauri-apps/api/core'
    import { save, confirm, message } from '@tauri-apps/plugin-dialog'
    import { writeTextFile } from '@tauri-apps/plugin-fs'
    import { goto } from '$app/navigation'
    import { StrangerTides, ArticleBlock, TiptapEditor, FinalDraft } from 'components'
    import { animator } from 'services'

    let betInFocus = $state<string | null>(null)
    let draftInFocus = $state<string | null>(null)
    let draft = $state<string | null>(null)
    let generatedBlocks = $state<Block[] | null>(null)
    let generating = $state(false)
    let generatingStatus = $state<string>('')
    let generatingProgress = $state(0)
    let showFinalDraft = $state(false)
    let activeTab = $state<'draft' | 'ocean'>('draft')
    let selectedDraftFormat = $state<Media>('blog')
    let oceanPosts = $state<import('schema').NetworkPost[]>([])
    let searchStrategy = $state<string[]>([])
    let pendingTerms = $state<{ id: string; value: string }[] | null>(null)
    let oceanLoading = $state<false | 'strategy' | 'trawling'>(false)
    let pendingFormat = $state<'bluesky-post' | 'instagram' | null>(null)

    const creatorVoice = $derived(drydock.creator?.voice ?? 'chronicle')
    const activeRoles = $derived(Object.keys(ROLE_LABELS[creatorVoice]) as BlockHeaders[])

    /**
     * Kicks off the StrangerTides flow.
     * user clicks "Find Social Media Talk" and confirms headings
     * then call to `suggest_keywords` with bet claim, description and topic.frequency
     * then user review
     *
     * User review confirmed -> click "Trawl Social Media"
     * then call `scout_network`
     * then populates `oceanPosts` and sets `searchStrategy`
     * finally StrangerTides renders with results
     *
     */
    async function loadOcean() {
        if (oceanLoading || !generatedBlocks) return
        activeTab = 'ocean'
        oceanLoading = 'strategy'
        oceanPosts = []
        searchStrategy = []
        pendingTerms = null
        try {
            const terms = await invoke<string[]>('suggest_keywords', {
                claim: selectedBet!.claim,
                description: selectedBet!.description,
                frequency: selectedBet!.topic.frequency,
            })
            pendingTerms = terms.map((value) => ({ id: generateId(), value }))
        } catch (e) {
            message(`There was a problem: ${e}`)
        } finally {
            oceanLoading = false
        }
    }

    async function confirmStrategy() {
        if (!pendingTerms?.length) return
        oceanLoading = 'trawling'
        try {
            const terms = pendingTerms.map((t) => t.value).filter((v) => v.trim())
            searchStrategy = terms
            pendingTerms = null
            oceanPosts = await invoke<import('schema').NetworkPost[]>('scout_network', { terms })
        } catch (e) {
            message(`There was a trawling error: ${e}`)
        } finally {
            oceanLoading = false
        }
    }

    const blogReadyBets = $derived(blogReady())

    const selectedBet = $derived(
        betInFocus ? (drydock.bets.find((b) => b.id === betInFocus) ?? null) : null
    )

    function selectBet(betId: string) {
        betInFocus = betId
        draftInFocus = null
        draft = null
        generatedBlocks = null
        pendingFormat = null
        activeTab = 'draft'
        requestAnimationFrame(() => animator.enterView('.bet-detail'))
    }

    function selectDraft(draftId: string, content: string, betId: string, format: Media = 'blog') {
        draftInFocus = draftId
        betInFocus = betId
        draft = content
        const pub = drydock.history.find((p) => p.id === draftId)
        generatedBlocks = pub?.blocks ?? null
        selectedDraftFormat = format
        activeTab = 'draft'
        requestAnimationFrame(() => animator.enterView('.bet-detail'))
    }

    async function draftThePost(betId: string, template: Media, role?: BlockHeaders) {
        generating = true
        generatingProgress = 0
        generatingStatus = 'Reading the current bet...'
        selectedDraftFormat = template

        try {
            generatingProgress = 20
            generatingStatus = 'Reading the evidence...'

            const apiKey = await invoke<string>('get_settings', {
                key: 'openrouter_api_key',
            })

            generatingProgress = 40
            generatingStatus = 'Powering up our writing assistant...'

            const progressInterval = setInterval(() => {
                if (generatingProgress < 90) {
                    generatingProgress += Math.random() * 2
                    if (generatingProgress > 60 && generatingProgress < 70) {
                        generatingStatus = 'Drafting writing prompts...'
                    } else if (generatingProgress > 75) {
                        generatingStatus = 'Nearly done...'
                    }
                }
            }, 800)

            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(message('Starter content timed out.')), 180_000)
            )
            const raw = await Promise.race([
                invoke<string>('starter_draft', {
                    apiKey,
                    betId,
                    creatorVoice,
                    outputFormat: template,
                    selectedRole: role ?? null,
                }),
                timeout,
            ])

            clearInterval(progressInterval)
            generatingProgress = 100
            generatingStatus = 'Done!'

            const blocks: Block[] = JSON.parse(raw)
            generatedBlocks = blocks
            draft = blocks
                .sort((a, b) => a.position - b.position)
                .map((b) => `## ${b.heading}\n\n${b.content}`)
                .join('\n\n')
            await drydock.saveBlock(betId, blocks, draft)
            pendingFormat = null

            betInFocus = betId
            draftInFocus = null
        } catch (error) {
            message(`Couldn't make a first draft: ${error}`)
        } finally {
            setTimeout(() => {
                generating = false
            }, 500)
        }
    }

    async function startFromBlankBlocks(betId: string) {
        generating = true
        generatingStatus = 'Classifying evidence...'
        generatingProgress = 0

        try {
            const evidence = drydock.evidenceFor(betId)

            // Ask Nomic to assign each evidence item to its best-fit block role
            const fill_blocks = await invoke<Record<string, string>>('match_evidence_to_blocks', {
                evidence: evidence.map((e) => ({ id: e.id, snippet: e.snippet })),
                narrativeVoice: creatorVoice,
            })

            generatingProgress = 80

            // Group evidence by assigned role, cap at 3 per block
            const byRole = new Map<string, EvidenceChip[]>()
            for (const role of activeRoles) byRole.set(role, [])

            for (const ev of evidence) {
                const role = fill_blocks[ev.id]
                const chips = byRole.get(role)!
                if (chips.length < 3) {
                    chips.push({
                        evidenceId: ev.id,
                        title: ev.title,
                        snippet: ev.snippet,
                        sentiment: ev.sentiment ?? 'neutral',
                        confidence: 1,
                    })
                }
            }

            const blocks: Block[] = activeRoles.map((role, i) => ({
                id: generateId(),
                role,
                heading: (ROLE_LABELS[creatorVoice] as Record<BlockHeaders, string>)[role],
                content: '',
                evidenceChips: byRole.get(role)!,
                position: i,
            }))

            generatingProgress = 100
            generatedBlocks = blocks
            draft = ''
            await drydock.saveBlock(betId, blocks, '')
            betInFocus = betId
            draftInFocus = null
            pendingFormat = null
            requestAnimationFrame(() => animator.enterView('.bet-detail'))
        } catch (e) {
            message(`Could not classify evidence: ${e}`)
        } finally {
            setTimeout(() => {
                generating = false
            }, 500)
        }
    }

    async function scrap(pubId: string) {
        if (draftInFocus === pubId) {
            draftInFocus = null
            draft = null
            generatedBlocks = null
        }
        await drydock.deleteDraft(pubId)
    }

    async function confirmScrap(pubId: string) {
        const absolutelySure = await confirm('Scrap this draft?', {
            title: 'Are you sure?',
            kind: 'warning',
        })
        if (absolutelySure) {
            scrap(pubId)
        }
    }

    async function downloadMarkdown() {
        if (!draft || !betInFocus) return
        const bet = drydock.bets.find((b) => b.id === betInFocus)
        if (!bet) return

        const slug = bet.codename.toLowerCase().replace(/\s+/g, '-')

        const filePath = await save({
            defaultPath: `${slug}.md`,
            filters: [{ name: 'Markdown', extensions: ['md'] }],
        })

        if (filePath) {
            await writeTextFile(filePath, draft)
        }
    }
</script>

<div class="outbox-page">
    <header class="page-header">
        <button class="btn-accent" onclick={() => goto('/')}>Close</button>
        <h1>Outbox</h1>
    </header>

    <div class="outbox-layout">
        <aside class="folder-panel">
            <section class="folder">
                <h2 class="folder-title">Blog Ready</h2>
                <ul class="folder-list" role="list">
                    {#each blogReadyBets as bet}
                        {@const evidence = drydock.evidenceFor(bet.id)}
                        <li>
                            <button
                                class="folder-item"
                                class:active={betInFocus === bet.id && !draftInFocus}
                                onclick={() => selectBet(bet.id)}>
                                <span class="item-name">{bet.codename}</span>
                                <span class="item-meta">{evidence.length} pieces</span>
                            </button>
                        </li>
                    {/each}
                </ul>
            </section>

            <section class="folder">
                <h2 class="folder-title">Drafts</h2>
                {#if drydock.history.length === 0}
                    <div class="folder-empty">
                        <p>No drafts yet.</p>
                    </div>
                {:else}
                    <ul class="folder-list" role="list">
                        {#each [...drydock.history].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()) as pub}
                            <li>
                                <button
                                    class="folder-item"
                                    class:active={draftInFocus === pub.id}
                                    onclick={() =>
                                        selectDraft(pub.id, pub.content, pub.betId, pub.format)}>
                                    <span class="item-name">
                                        {#if pub.format === 'blog'}📝{:else if pub.format === 'bluesky-thread'}🧵{:else if pub.format === 'bluesky-post'}🦋{:else}📱{/if}
                                        {new Date(pub.generatedAt).toLocaleDateString()}
                                    </span>
                                    {#if pub.postedUrl}
                                        <span class="item-badge">✓</span>
                                    {/if}
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </section>
        </aside>

        <main class="content-panel">
            {#if !betInFocus && !draftInFocus}
                <div class="empty-state">
                    <p class="empty-icon">📬</p>
                    <p class="empty-title">Select a bet or draft</p>
                    <p class="empty-hint">
                        Choose from the Blog Ready folder to generate content, or open a draft to
                        edit it.
                    </p>
                </div>
            {:else if betInFocus && selectedBet}
                {@const evidence = drydock.evidenceFor(betInFocus)}
                {@const delta = selectedBet.currentConfidence - selectedBet.initialConfidence}
                {@const pubs = drydock.whatsBeenPublishedOn(betInFocus)}

                <div class="bet-detail">
                    <div class="content-header">
                        <div>
                            <h2>{selectedBet.codename}</h2>
                            <p class="bet-claim">{selectedBet.claim}</p>
                        </div>
                    </div>

                    <div class="bet-meta">
                        <div class="meta-item">
                            <span class="meta-label">Evidence:</span>
                            <span class="meta-value">{evidence.length} pieces</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Confidence:</span>
                            <span class="meta-value">
                                {selectedBet.currentConfidence}%
                                {#if delta !== 0}
                                    <span class="delta" class:positive={delta > 0}>
                                        ({delta > 0 ? '+' : ''}{delta}%)
                                    </span>
                                {/if}
                            </span>
                        </div>
                    </div>

                    {#if draft || generatedBlocks}
                        <div class="draft-preview">
                            <div class="draft-preview-header">
                                <div class="tab-bar">
                                    <button
                                        class="tab-btn"
                                        class:active={activeTab === 'draft'}
                                        onclick={() => (activeTab = 'draft')}>Writing Desk</button>
                                    <button
                                        class="tab-btn"
                                        class:active={activeTab === 'ocean'}
                                        onclick={loadOcean}>Find Social Media Talk</button>
                                    <button class="tab-btn" onclick={() => (showFinalDraft = true)}>
                                        View Final Draft
                                    </button>
                                    <button
                                        class="tab-btn tab-btn--danger"
                                        onclick={() => confirmScrap(draftInFocus!)}>
                                        Scrap
                                    </button>
                                </div>
                            </div>
                            {#if activeTab === 'draft'}
                                {#if generatedBlocks}
                                    <ArticleBlock
                                        bind:blocks={generatedBlocks}
                                        evidence={drydock.evidenceFor(betInFocus!)}
                                        voice={creatorVoice}
                                        onchange={async (blocks) => {
                                            generatedBlocks = blocks
                                            if (!draftInFocus) return
                                            await drydock.updateBlock(draftInFocus, blocks)
                                        }} />
                                {:else}
                                    <textarea
                                        class="draft-textarea"
                                        bind:value={draft}
                                        aria-label="Draft content"></textarea>
                                {/if}
                            {:else}
                                <div class="ocean-panel">
                                    {#if oceanLoading === 'strategy'}
                                        <p class="strategy-label">
                                            Matching your article to social media talk…
                                        </p>
                                    {:else if oceanLoading === 'trawling' || oceanPosts.length > 0}
                                        <StrangerTides
                                            posts={oceanPosts}
                                            {searchStrategy}
                                            loading={oceanLoading} />
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        {#if pubs.length > 0}
                            <div class="publication-history">
                                <p class="history-label">Draft history</p>
                                <div class="history-items">
                                    {#each pubs as pub}
                                        <button
                                            class="history-badge"
                                            onclick={() =>
                                                selectDraft(
                                                    pub.id,
                                                    pub.content,
                                                    betInFocus!,
                                                    pub.format
                                                )}>
                                            {#if pub.format === 'blog'}📝{:else if pub.format === 'bluesky-thread'}🧵{:else if pub.format === 'bluesky-post'}🦋{:else}📱{/if}
                                            {new Date(pub.generatedAt).toLocaleDateString()}
                                            {#if pub.postedUrl}✓{/if}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        {#if pendingFormat}
                            <div class="role-picker">
                                <p class="role-picker-label">Choose a block role to post about</p>
                                <div class="role-list">
                                    {#each activeRoles as role}
                                        <button
                                            class="role-btn"
                                            onclick={() =>
                                                draftThePost(betInFocus!, pendingFormat!, role)}
                                            disabled={generating}>
                                            {(
                                                ROLE_LABELS[creatorVoice] as Record<
                                                    BlockHeaders,
                                                    string
                                                >
                                            )[role]}
                                        </button>
                                    {/each}
                                </div>
                                <button
                                    class="btn-back-inline"
                                    onclick={() => (pendingFormat = null)}>← Back</button>
                            </div>
                        {:else}
                            <div class="format-templates">
                                <button
                                    class="template-card"
                                    onclick={() => startFromBlankBlocks(betInFocus!)}
                                    disabled={generating}>
                                    <div class="template-preview blank-preview">
                                        <div class="blank-lines">
                                            <div class="blank-line"></div>
                                            <div class="blank-line"></div>
                                            <div class="blank-line"></div>
                                        </div>
                                    </div>
                                    <div class="template-label">
                                        <span class="icon">✏️</span>
                                        <span>Start Writing</span>
                                    </div>
                                </button>

                                {#if drydock.creator?.platforms.includes('blog')}
                                    <button
                                        class="template-card"
                                        onclick={() => draftThePost(betInFocus!, 'blog')}
                                        disabled={generating}>
                                        <div class="template-preview blog-preview">
                                            <div class="preview-lines">
                                                <div class="line title"></div>
                                                <div class="line"></div>
                                                <div class="line"></div>
                                                <div class="line short"></div>
                                            </div>
                                        </div>
                                        <div class="template-label">
                                            <span class="icon">📝</span>
                                            <span>Blog Post</span>
                                        </div>
                                    </button>
                                {/if}

                                {#if drydock.creator?.platforms.includes('bluesky')}
                                    <button
                                        class="template-card"
                                        onclick={() => (pendingFormat = 'bluesky-post')}
                                        disabled={generating}>
                                        <div class="template-preview thread-preview">
                                            <div class="tweet-box">post</div>
                                        </div>
                                        <div class="template-label">
                                            <span class="icon">🦋</span>
                                            <span>Bluesky Post</span>
                                        </div>
                                    </button>
                                    <button
                                        class="template-card"
                                        onclick={() => draftThePost(betInFocus!, 'bluesky-thread')}
                                        disabled={generating}>
                                        <div class="template-preview thread-preview">
                                            <div class="tweet-box">1/</div>
                                            <div class="tweet-box">2/</div>
                                            <div class="tweet-box">3/</div>
                                        </div>
                                        <div class="template-label">
                                            <span class="icon">🧵</span>
                                            <span>Bluesky Thread</span>
                                        </div>
                                    </button>
                                {/if}

                                {#if drydock.creator?.platforms.includes('instagram')}
                                    <button
                                        class="template-card"
                                        onclick={() => (pendingFormat = 'instagram')}
                                        disabled={generating}>
                                        <div class="template-preview instagram-preview">
                                            <div class="square-frame"></div>
                                            <div class="caption-lines">
                                                <div class="caption-line"></div>
                                                <div class="caption-line short"></div>
                                            </div>
                                        </div>
                                        <div class="template-label">
                                            <span class="icon">📱</span>
                                            <span>Instagram</span>
                                        </div>
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    {/if}
                </div>
            {/if}
        </main>
    </div>
</div>

{#if showFinalDraft && generatedBlocks}
    <FinalDraft
        blocks={generatedBlocks}
        betCodename={selectedBet?.codename}
        draftContent={draft!}
        onclose={() => (showFinalDraft = false)}
        oncopy={() => {}}
        ondownload={downloadMarkdown} />
{/if}

{#if pendingTerms !== null}
    <div
        class="modal-backdrop"
        role="presentation"
        onclick={() => (pendingTerms = null)}
        {@attach animator.modalEntrance('.modal-backdrop', '.terms-modal')}>
        <div class="modal-container modal-sm terms-modal" onclick={(e) => e.stopPropagation()}>
            <div class="modal-header">
                <h3>We suggest looking for these terms</h3>
            </div>
            <div class="terms-body">
                {#each pendingTerms as term, i (term.id)}
                    <div class="term-row">
                        <span class="term-index">{i + 1}</span>
                        <TiptapEditor
                            value={term.value}
                            onchange={(v) => {
                                term.value = v
                            }}
                            placeholder="Search term {i + 1}"
                            class="term-editor" />
                        <button
                            class="term-remove"
                            onclick={(e) => {
                                const row = (e.currentTarget as HTMLElement).closest(
                                    '.term-row'
                                ) as HTMLElement
                                row.classList.add('term-row--removing')
                                setTimeout(() => {
                                    pendingTerms = pendingTerms!.filter((t) => t.id !== term.id)
                                }, 180)
                            }}
                            aria-label="Remove term">✕</button>
                    </div>
                {/each}
            </div>
            <div class="terms-footer">
                <button class="btn-secondary" onclick={() => (pendingTerms = null)}>Cancel</button>
                <button class="btn-primary" onclick={confirmStrategy}>Search</button>
            </div>
        </div>
    </div>
{/if}

{#if generating}
    <div class="modal-backdrop">
        <div class="modal-container">
            <div class="generating-card">
                <div class="spinner"></div>
                <p class="generating-status">{generatingStatus}</p>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {generatingProgress}%"></div>
                </div>
                <p class="form-hint">This usually takes 30-60 seconds...</p>
            </div>
        </div>
    </div>
{/if}

<style>
    .outbox-page {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
    }

    .page-header {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 24px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
        flex-shrink: 0;
    }

    .page-header h1 {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
    }

    .outbox-layout {
        display: grid;
        grid-template-columns: 280px 1fr;
        flex: 1;
        overflow: hidden;
    }

    /* ---- Folder Panel ---- */

    .folder-panel {
        border-right: 1px solid var(--border);
        background: var(--bg-secondary);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .folder {
        border-bottom: 1px solid var(--border);
        padding: 12px 0;
    }

    .folder-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-tertiary);
        margin: 0 0 8px;
        padding: 0 16px;
    }

    .folder-list {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .folder-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 8px 16px;
        background: transparent;
        border: none;
        text-align: left;
        cursor: pointer;
        transition: var(--transition);
        color: var(--text-secondary);
        font-size: 13px;
    }

    .folder-item:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .folder-item.active {
        background: var(--accent-tertiary);
        color: white;
    }

    .item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item-meta {
        font-size: 11px;
        color: inherit;
        opacity: 0.7;
        flex-shrink: 0;
        margin-left: 8px;
    }

    .item-badge {
        font-size: 11px;
        color: var(--success);
        flex-shrink: 0;
    }

    .folder-empty {
        padding: 8px 16px;
        font-size: 13px;
        color: var(--text-tertiary);
    }

    .folder-empty p {
        margin: 0 0 8px;
    }

    /* ---- Content Panel ---- */

    .content-panel {
        overflow-y: auto;
        background: var(--bg-primary);
        display: flex;
        flex-direction: column;
    }

    /* ---- Bet Detail ---- */

    .bet-detail {
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        flex: 1;
    }

    .content-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
    }

    .content-header h2 {
        margin: 0 0 4px;
        font-size: 20px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .bet-claim {
        margin: 0;
        font-size: 14px;
        color: var(--text-secondary);
    }

    /* ---- Draft Editor ---- */

    .draft-preview {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 16px;
        overflow: hidden;
    }

    .draft-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }

    .tab-bar {
        display: flex;
        gap: 2px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        padding: 3px;
    }

    .tab-btn {
        padding: 6px 14px;
        background: transparent;
        border: none;
        border-radius: calc(var(--radius-sm) - 2px);
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        transition: var(--transition);
    }

    .tab-btn:hover {
        color: var(--text-primary);
    }

    .tab-btn.active {
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-weight: 600;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    .tab-btn--danger {
        background: rgba(220, 38, 38, 0.1);
        color: var(--error, #dc2626);
    }

    .tab-btn--danger:hover {
        background: rgba(220, 38, 38, 0.2);
        color: #ef4444;
    }

    .ocean-panel {
        flex: 1;
        overflow: hidden;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
    }

    .terms-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 24px 32px;
    }

    .terms-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 16px 32px 24px;
        border-top: 1px solid var(--border);
    }

    .term-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .term-index {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-tertiary);
        width: 18px;
        text-align: right;
        flex-shrink: 0;
    }

    .term-remove {
        background: none;
        border: none;
        color: var(--text-tertiary);
        font-size: 11px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
        line-height: 1;
    }

    .term-remove:hover {
        color: var(--text-primary);
        background: var(--bg-tertiary);
    }

    @keyframes term-exit {
        to {
            opacity: 0;
            transform: translateX(20px);
        }
    }

    :global(.term-row--removing) {
        animation: term-exit 180ms ease-in forwards;
        pointer-events: none;
    }

    .terms-body :global(.term-editor .tiptap) {
        min-height: unset;
        padding: 8px 12px;
    }

    .terms-body :global(.term-editor) {
        flex: 1;
    }

    .draft-textarea {
        flex: 1;
        min-height: 400px;
        resize: none;
        padding: 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-primary);
        width: 100%;
        box-sizing: border-box;
    }

    .draft-textarea:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    /* ---- Publication History ---- */
    .publication-history {
        padding: 12px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }

    .history-label {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--text-tertiary);
        font-weight: 600;
    }

    .history-items {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .history-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 12px;
        font-size: 11px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: var(--transition);
    }

    .history-badge:hover {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
    }

    /* ---- Role Picker ---- */

    .role-picker {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .role-picker-label {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
        font-weight: 500;
    }

    .role-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .role-btn {
        padding: 10px 14px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        text-align: left;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        cursor: pointer;
        transition: var(--transition);
    }

    .role-btn:hover:not(:disabled) {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
    }

    .role-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-back-inline {
        align-self: flex-start;
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: var(--transition);
    }

    .btn-back-inline:hover {
        color: var(--text-primary);
        border-color: var(--border-hover);
    }

    /* ---- Format Templates ---- */

    .format-templates {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
    }

    .template-card {
        display: flex;
        flex-direction: column;
        padding: 16px;
        background: var(--bg-secondary);
        border: 2px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition);
    }

    .template-card:hover:not(:disabled) {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
        transform: translateY(-2px);
    }

    .template-card:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .template-preview {
        height: 80px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .blank-preview {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
        padding: 8px 0;
    }

    .blank-lines {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
    }

    .blank-line {
        height: 28px;
        border: 1px dashed var(--border);
        border-radius: var(--radius-sm);
        opacity: 0.6;
    }

    .blog-preview .preview-lines {
        width: 100%;
    }

    .blog-preview .line {
        height: 6px;
        background: var(--text-tertiary);
        border-radius: 3px;
        margin-bottom: 6px;
        opacity: 0.4;
    }

    .blog-preview .line.title {
        height: 10px;
        width: 80%;
        opacity: 0.6;
    }

    .blog-preview .line.short {
        width: 60%;
    }

    .thread-preview {
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
    }

    .tweet-box {
        width: 100%;
        height: 18px;
        background: var(--text-tertiary);
        border-radius: 4px;
        opacity: 0.4;
        display: flex;
        align-items: center;
        padding-left: 6px;
        font-size: 10px;
        font-weight: 600;
    }

    .instagram-preview {
        flex-direction: column;
        gap: 8px;
    }

    .square-frame {
        width: 60px;
        height: 60px;
        background: var(--text-tertiary);
        border-radius: 4px;
        opacity: 0.4;
    }

    .caption-lines {
        width: 100%;
    }

    .caption-line {
        height: 4px;
        background: var(--text-tertiary);
        border-radius: 2px;
        margin-bottom: 4px;
        opacity: 0.4;
    }

    .caption-line.short {
        width: 70%;
    }

    .template-label {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .template-label .icon {
        font-size: 16px;
    }

    /* ---- Generating Card ---- */

    .generating-card {
        background: var(--bg-secondary);
        border: 2px solid var(--accent-primary);
        border-radius: var(--radius-lg);
        padding: 48px;
        text-align: center;
        max-width: 400px;
    }

    .generating-status {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 16px;
    }

    .progress-bar {
        width: 100%;
        height: 8px;
        background: var(--bg-tertiary);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
    }

    .progress-fill {
        height: 100%;
        background: var(--accent-primary);
        transition: width 0.3s ease;
    }
</style>
