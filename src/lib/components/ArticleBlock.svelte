<script lang="ts">
    import { onDestroy } from 'svelte'
    import { Editor } from '@tiptap/core'
    import StarterKit from '@tiptap/starter-kit'
    import type { Block, BlockHeaders, Evidence, NarrativeStyle } from 'schema'
    import { ROLE_LABELS } from 'schema'

    interface Props {
        blocks: Block[]
        onchange: (blocks: Block[]) => void
        evidence?: Evidence[]
        voice: NarrativeStyle
    }

    let { blocks = $bindable(), onchange, evidence = [], voice }: Props = $props()

    const SENTIMENT: Record<string, string> = {
        supports: 'badge-supports',
        refutes: 'badge-refutes',
        neutral: 'badge-neutral',
    }

    // save status

    let lastChanged = $state<number | null>(null)
    let lastSaved = $state<number | null>(null)

    let saveStatus = $derived<'idle' | 'pending' | 'saved'>(
        !lastChanged ? 'idle' : !lastSaved || lastSaved < lastChanged ? 'pending' : 'saved'
    )

    $effect(() => {
        if (!lastChanged) return
        const t = setTimeout(() => {
            onchange(blocks)
            lastSaved = Date.now()
        }, 5000)
        return () => clearTimeout(t)
    })

    function updateBlock(id: string, patch: Partial<Block>) {
        onchange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
        lastChanged = Date.now()
    }

    // drag state

    let dragSourceId = $state<string | null>(null)
    let dragOverId = $state<string | null>(null)

    let displayedBlocks = $derived.by(() => {
        const sorted = [...blocks].sort((a, b) => a.position - b.position)
        if (!dragSourceId || !dragOverId || dragSourceId === dragOverId) return sorted
        const from = sorted.findIndex((b) => b.id === dragSourceId)
        const to = sorted.findIndex((b) => b.id === dragOverId)
        const reordered = [...sorted]
        const [moved] = reordered.splice(from, 1)
        reordered.splice(to, 0, moved)
        return reordered
    })

    // drag handle attachment — pointer events bypass contenteditable entirely

    function dragHandle(blockId: string) {
        return (el: HTMLElement) => {
            function onPointerDown(e: PointerEvent) {
                e.preventDefault()
                el.setPointerCapture(e.pointerId)
                dragSourceId = blockId
            }

            function onPointerMove(e: PointerEvent) {
                if (!dragSourceId) return
                const target = document.elementFromPoint(e.clientX, e.clientY)
                const card = target?.closest<HTMLElement>('[data-block-id]')
                dragOverId = card ? (card.dataset.blockId ?? null) : null
            }

            function onPointerUp() {
                if (dragSourceId && dragOverId && dragSourceId !== dragOverId) {
                    onchange(displayedBlocks.map((b, i) => ({ ...b, position: i })))
                }
                dragSourceId = null
                dragOverId = null
            }

            el.addEventListener('pointerdown', onPointerDown)
            el.addEventListener('pointermove', onPointerMove)
            el.addEventListener('pointerup', onPointerUp)

            return () => {
                el.removeEventListener('pointerdown', onPointerDown)
                el.removeEventListener('pointermove', onPointerMove)
                el.removeEventListener('pointerup', onPointerUp)
            }
        }
    }

    // evidence peek + picker

    let activeChip = $state<Record<string, string | null>>({})
    let openPickerBlockId = $state<string | null>(null)

    function togglePicker(blockId: string) {
        openPickerBlockId = openPickerBlockId === blockId ? null : blockId
    }

    function pickerTransition(_node: HTMLElement) {
        return {
            duration: 180,
            css(t: number) {
                return `
                    opacity: ${t};
                    transform: translateY(${(1 - t) * -6}px);
                    transform-origin: top;
                `
            },
        }
    }

    // tiptap instances

    const headingEditors = new Map<string, Editor>()
    const bodyEditors = new Map<string, Editor>()

    function headingAction(el: HTMLElement, block: Block) {
        const editor = new Editor({
            element: el,
            extensions: [
                StarterKit.configure({
                    blockquote: false,
                    bulletList: false,
                    orderedList: false,
                    listItem: false,
                    codeBlock: false,
                    horizontalRule: false,
                    heading: { levels: [2] },
                }),
            ],
            content: block.heading ? `<h2>${block.heading}</h2>` : '<h2></h2>',
            onUpdate({ editor: e }) {
                updateBlock(block.id, { heading: e.getText() })
            },
        })

        editor.view.dom.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                bodyEditors.get(block.id)?.commands.focus('start')
            }
        })

        headingEditors.set(block.id, editor)
        return {
            destroy() {
                editor.destroy()
                headingEditors.delete(block.id)
            },
        }
    }

    function bodyAction(el: HTMLElement, block: Block) {
        const editor = new Editor({
            element: el,
            extensions: [StarterKit.configure({ heading: false })],
            content: block.content ? `<p>${block.content}</p>` : '<p></p>',
            onUpdate({ editor: e }) {
                updateBlock(block.id, { content: e.getText() })
            },
        })

        bodyEditors.set(block.id, editor)
        return {
            destroy() {
                editor.destroy()
                bodyEditors.delete(block.id)
            },
        }
    }

    onDestroy(() => {
        lastChanged = null
    })
</script>

<div class="block">
    <div
        class="save-indicator"
        class:visible={saveStatus !== 'idle'}
        class:saved={saveStatus === 'saved'}
    >
        {#if saveStatus === 'pending'}
            <span class="save-dot pending"></span> Unsaved changes
        {:else if saveStatus === 'saved'}
            <span class="save-dot saved"></span> Saved
        {/if}
    </div>

    <div class="block-list" role="list">
        {#each displayedBlocks as block (block.id)}
            <div
                class="block-card"
                class:drag-over={dragOverId === block.id}
                class:dragging={dragSourceId === block.id}
                data-block-id={block.id}
                role="listitem"
            >
                <div class="block-header">
                    <div class="drag-handle" {@attach dragHandle(block.id)} aria-hidden="true">
                        ⠿
                    </div>
                    <span class="badge flat"
                        >{(ROLE_LABELS[voice] as Record<BlockHeaders, string>)[block.role]}</span
                    >
                    {#if evidence.length > 0}
                        <button
                            class="btn-secondary"
                            class:active={openPickerBlockId === block.id}
                            title="Add evidence"
                            onclick={() => togglePicker(block.id)}>+</button
                        >
                    {/if}
                </div>

                <div class="heading-editor" use:headingAction={block}></div>
                <div class="body-editor" use:bodyAction={block}></div>

                <div class="badge-row">
                    {#if block.evidenceChips.length === 0}
                        <span class="badge-empty">No evidence assigned</span>
                    {:else}
                        {#each block.evidenceChips as badge (badge.evidenceId)}
                            <span class="badge {SENTIMENT[badge.sentiment]}">
                                <button
                                    class="badge-title"
                                    title="Preview evidence"
                                    onclick={() =>
                                        (activeChip[block.id] =
                                            activeChip[block.id] === badge.evidenceId
                                                ? null
                                                : badge.evidenceId)}
                                >
                                    {badge.title.slice(0, 40)}{badge.title.length > 40 ? '…' : ''}
                                </button>
                                <button
                                    class="remove-btn"
                                    title="Remove evidence"
                                    onclick={() =>
                                        updateBlock(block.id, {
                                            evidenceChips: block.evidenceChips.filter(
                                                (ba) => ba.evidenceId !== badge.evidenceId
                                            ),
                                        })}>×</button
                                >
                            </span>
                        {/each}
                    {/if}
                </div>
                {#if openPickerBlockId === block.id}
                    {@const attached = new Set(block.evidenceChips.map((c) => c.evidenceId))}
                    {@const available = evidence.filter((e) => !attached.has(e.id))}
                    <div class="evidence-picker" transition:pickerTransition>
                        {#if available.length === 0}
                            <p class="picker-empty">
                                All evidence is already attached to this block.
                            </p>
                        {:else}
                            {#each available as ev (ev.id)}
                                <div class="picker-item">
                                    <div class="picker-info">
                                        <span class="picker-source">{ev.source}</span>
                                        <span class="picker-title">{ev.title}</span>
                                    </div>
                                    <button
                                        class="picker-add"
                                        title="Add to block"
                                        onclick={() => {
                                            updateBlock(block.id, {
                                                evidenceChips: [
                                                    ...block.evidenceChips,
                                                    {
                                                        evidenceId: ev.id,
                                                        title: ev.title,
                                                        snippet: ev.snippet,
                                                        sentiment: ev.sentiment ?? 'neutral',
                                                        confidence: 1,
                                                    },
                                                ],
                                            })
                                        }}>+</button
                                    >
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/if}

                {#if activeChip[block.id]}
                    {@const ev = evidence.find((e) => e.id === activeChip[block.id])}
                    {@const chip = block.evidenceChips.find(
                        (c) => c.evidenceId === activeChip[block.id]
                    )}
                    {#if ev || chip}
                        <div class="evidence-peek" transition:pickerTransition>
                            <div class="peek-header">
                                <span class="peek-source"
                                    >{ev?.source ?? chip?.sentiment ?? ''}</span
                                >
                                <button
                                    class="peek-close"
                                    onclick={() => (activeChip[block.id] = null)}>✕</button
                                >
                            </div>
                            <p class="peek-title">{ev?.title ?? chip?.title}</p>
                            <p class="peek-snippet">{ev?.snippet ?? chip?.snippet}</p>
                            {#if ev?.url}
                                <a class="peek-url" href={ev.url} target="_blank" rel="noreferrer"
                                    >{ev.url}</a
                                >
                            {/if}
                        </div>
                    {/if}
                {/if}
            </div>
        {/each}
    </div>
</div>

<style>
    .block {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 4px 0;
    }

    .save-indicator {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text-tertiary);
        height: 0;
        overflow: hidden;
        opacity: 0;
        transition:
            opacity 0.2s,
            height 0.2s;
    }

    .save-indicator.visible {
        height: 20px;
        opacity: 1;
    }

    .save-indicator.saved {
        color: var(--success);
    }

    .save-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .save-dot.pending {
        background: var(--text-tertiary);
        animation: pulse 1.2s ease-in-out infinite;
    }

    .save-dot.saved {
        background: var(--success);
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.3;
        }
    }

    .block-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .block-card {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition:
            border-color 0.15s,
            opacity 0.15s;
    }

    .block-card.drag-over {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
    }

    .block-card.dragging {
        opacity: 0.4;
    }

    .block-header {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .drag-handle {
        font-size: 18px;
        color: var(--text-tertiary);
        cursor: grab;
        line-height: 1;
        user-select: none;
        flex-shrink: 0;
        touch-action: none;
    }

    .drag-handle:active {
        cursor: grabbing;
    }

    .heading-editor :global(.tiptap) {
        outline: none;
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.4;
        padding: 2px 0;
        border-bottom: 1px solid transparent;
        transition: border-color 0.15s;
    }

    .heading-editor :global(.tiptap:focus-within) {
        border-bottom-color: var(--accent-primary);
    }

    .heading-editor :global(.tiptap h2) {
        margin: 0;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
    }

    .body-editor :global(.tiptap) {
        outline: none;
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.6;
        min-height: 3.2em;
        padding: 4px 0;
        white-space: pre-wrap;
        transition: color 0.15s;
    }

    .body-editor :global(.tiptap:focus-within) {
        color: var(--text-primary);
    }

    .body-editor :global(.tiptap p) {
        margin: 0 0 0.5em;
    }

    .body-editor :global(.tiptap p:last-child) {
        margin-bottom: 0;
    }

    .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-height: 24px;
        align-items: center;
    }

    .badge-empty {
        font-size: 11px;
        color: var(--text-tertiary);
        font-style: italic;
    }

    .badge-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: none;
        border: none;
        padding: 0;
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-align: left;
    }

    .badge-title:hover {
        text-decoration: underline;
        text-underline-offset: 2px;
    }

    .evidence-picker {
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        overflow: hidden;
        max-height: 220px;
        overflow-y: auto;
    }

    .picker-empty {
        margin: 0;
        padding: 12px;
        font-size: 12px;
        color: var(--text-tertiary);
        font-style: italic;
    }

    .picker-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
    }

    .picker-item:last-child {
        border-bottom: none;
    }

    .picker-item:hover {
        background: var(--bg-tertiary);
    }

    .picker-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    .picker-source {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
    }

    .picker-title {
        font-size: 12px;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .picker-add {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: 16px;
        color: var(--text-secondary);
        cursor: pointer;
        line-height: 1;
    }

    .picker-add:hover {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    .btn-secondary.active {
        background: var(--accent-tertiary);
        color: white;
        border-color: var(--accent-tertiary);
    }

    .evidence-peek {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .peek-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .peek-source {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
    }

    .peek-title {
        margin: 0;
        font-weight: 600;
        color: var(--text-primary);
    }

    .peek-snippet {
        margin: 0;
        color: var(--text-secondary);
    }

    .peek-url {
        font-size: 11px;
        color: var(--accent-primary);
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .peek-url:hover {
        text-decoration: underline;
    }

    .peek-close {
        background: none;
        border: none;
        font-size: 11px;
        color: var(--text-tertiary);
        cursor: pointer;
        padding: 2px 4px;
        line-height: 1;
        flex-shrink: 0;
    }

    .peek-close:hover {
        color: var(--text-primary);
    }
</style>
