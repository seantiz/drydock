<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { Editor } from '@tiptap/core'
    import StarterKit from '@tiptap/starter-kit'
    import type { Block } from 'schema'
    import { animator } from 'services'

    interface Props {
        blocks: Block[]
        betCodename?: string
        draftContent: string
        onclose: () => void
        oncopy: () => void
        ondownload: () => void
    }

    let { blocks, betCodename, draftContent, onclose, oncopy, ondownload }: Props = $props()

    let editorEl = $state<HTMLElement | null>(null)
    let editor: Editor | null = null
    let wordcount = $state(0)
    let copied = $state(false)

    function blocksToHtml(bs: Block[]): string {
        return [...bs]
            .sort((a, b) => a.position - b.position)
            .map((b) => `<h2>${b.heading}</h2><p>${b.content}</p>`)
            .join('<hr>')
    }

    function getwc(text: string): number {
        return text.trim().split(/\s+/).filter(Boolean).length
    }

    function bgback(e: MouseEvent) {
        if (e.target === e.currentTarget) onclose()
    }

    function hitesc(e: KeyboardEvent) {
        if (e.key === 'Escape') onclose()
    }

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(draftContent)
            copied = true
            setTimeout(() => (copied = false), 2000)
            oncopy()
        } catch (error) {
            console.error('Failed to copy:', error)
        }
    }

    onMount(() => {
        const html = blocksToHtml(blocks)

        editor = new Editor({
            element: editorEl,
            extensions: [StarterKit],
            content: html,
            editable: false,
            onCreate({ editor: e }) {
                wordcount = getwc(e.getText())
            },
        })

        setTimeout(() => {
            animator.animate('.article-frame', {
                opacity: [0, 1],
                translateY: [12, 0],
                duration: 900,
                ease: 'out(2)',
                autoplay: true,
            })
        }, 500)
    })

    onDestroy(() => {
        editor?.destroy()
    })
</script>

<svelte:window onkeydown={hitesc} />

<div
    class="modal-backdrop"
    onclick={bgback}
    {@attach animator.modalEntrance('.modal-backdrop', '.preview-modal')}
>
    <div class="preview-modal">
        <div class="preview-header">
            <div class="header-left">
                <span class="preview-eyebrow">Final draft</span>
                {#if betCodename}
                    <h2 class="preview-title">Part of the {betCodename} series</h2>
                {/if}
            </div>
            <div class="header-right">
                <span class="word-count">{wordcount.toLocaleString()} words</span>
            </div>
        </div>

        <div class="preview-body">
            <div class="article-frame">
                <div class="article-editor" bind:this={editorEl}></div>
            </div>
        </div>

        <div class="preview-footer">
            <span class="footer-hint"> </span>
            <div class="footer-actions">
                <button class="btn-primary" onclick={handleCopy}>
                    {copied ? '✓ Copied!' : 'Copy'}
                </button>
                <button class="btn-primary" onclick={ondownload}> Download </button>
                <button class="btn-accent" onclick={onclose}> Back </button>
            </div>
        </div>
    </div>
</div>

<style>
    .preview-modal {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 780px;
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 28px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }

    .header-left {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .preview-eyebrow {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--accent-primary);
    }

    .preview-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .word-count {
        font-size: 12px;
        color: var(--text-tertiary);
        white-space: nowrap;
    }

    .preview-body {
        flex: 1;
        overflow-y: auto;
        padding: 40px 28px;
        background: var(--bg-primary);
    }

    .article-frame {
        max-width: 660px;
        margin: 0 auto;
        opacity: 0;
    }

    .article-editor :global(.tiptap) {
        outline: none;
        caret-color: transparent;
    }

    .article-editor :global(.tiptap h2) {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.3;
        margin: 2em 0 0.5em;
        padding-bottom: 0.3em;
        border-bottom: 1px solid var(--border);
    }

    .article-editor :global(.tiptap h2:first-child) {
        margin-top: 0;
    }

    .article-editor :global(.tiptap p) {
        font-size: 15px;
        line-height: 1.75;
        color: var(--text-secondary);
        margin: 0 0 1em;
    }

    .article-editor :global(.tiptap p:last-child) {
        margin-bottom: 0;
    }

    .article-editor :global(.tiptap hr) {
        border: none;
        border-top: 1px dashed var(--border);
        margin: 2.5em 0;
    }

    .preview-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 28px;
        border-top: 1px solid var(--border);
        flex-shrink: 0;
        background: var(--bg-secondary);
    }

    .footer-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
</style>
