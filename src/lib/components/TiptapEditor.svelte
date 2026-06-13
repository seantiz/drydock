<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { Editor } from '@tiptap/core'
    import { Markdown } from '@tiptap/markdown'
    import StarterKit from '@tiptap/starter-kit'

    interface Props {
        value: string
        onchange?: (text: string) => void
        readonly?: boolean
        placeholder?: string
        class?: string
    }

    let {
        value,
        onchange,
        readonly = false,
        placeholder = '',
        class: className = '',
    }: Props = $props()

    let element = $state<HTMLElement | null>(null)
    let editor: Editor | null = null

    onMount(() => {
        editor = new Editor({
            element,
            extensions: [Markdown, StarterKit],
            content: value,
            contentType: 'markdown',
            editable: !readonly,
            onUpdate({ editor: e }) {
                if (!readonly) onchange?.(e.getText())
            },
        })
    })

    onDestroy(() => {
        editor?.destroy()
    })
</script>

<div class="tiptap-wrapper {className}" bind:this={element} data-placeholder={placeholder}></div>

<style>
    .tiptap-wrapper {
        width: 100%;
    }
    .tiptap-wrapper :global(.tiptap) {
        outline: none;
        width: 100%;
        min-height: 80px;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 13px;
        line-height: 1.6;
        font-family: inherit;
        transition: border-color 0.15s;
    }
    .tiptap-wrapper :global(.tiptap:focus) {
        border-color: var(--accent-primary);
    }
    .tiptap-wrapper :global(.tiptap p) {
        margin: 0 0 4px 0;
    }
    .tiptap-wrapper :global(.tiptap p:last-child) {
        margin-bottom: 0;
    }
    .tiptap-wrapper :global(.tiptap p.is-editor-empty:first-child::before) {
        content: attr(data-placeholder);
        color: var(--text-tertiary);
        pointer-events: none;
        float: left;
        height: 0;
    }
    .tiptap-wrapper :global(.tiptap pre) {
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        padding: 12px 16px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        overflow-x: auto;
    }
    .tiptap-wrapper :global(.tiptap code) {
        background: var(--bg-tertiary);
        border-radius: 3px;
        padding: 2px 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
    }
    .tiptap-wrapper :global(.tiptap pre code) {
        background: none;
        padding: 0;
    }
</style>
