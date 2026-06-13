<script lang="ts">
    import '../app.css'
    let { children } = $props()
    import { getCurrentWindow } from '@tauri-apps/api/window'
    import { invoke } from '@tauri-apps/api/core'
    import { onMount } from 'svelte'
    import { drydock } from '$lib/services/drydock.svelte'
    import { onNavigate } from '$app/navigation'

    onNavigate(() => {
        if (document.startViewTransition) {
            return new Promise<void>((resolve) => {
                const transition = document.startViewTransition(() => resolve())
                transition.finished.then(() => {})
            })
        }
    })

    onMount(() => {
        drydock.coldStart()
        invoke<string>('load_theme').then((themeJson) => {
            const { name, mode } = themeJson
                ? JSON.parse(themeJson)
                : { name: 'default', mode: 'auto' }

            function applyTheme() {
                if (mode === 'auto') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                    document.documentElement.className = `${name}-${prefersDark ? 'dark' : 'light'}`
                } else {
                    document.documentElement.className = `${name}-${mode}`
                }
            }

            applyTheme()

            if (mode === 'auto') {
                window
                    .matchMedia('(prefers-color-scheme: dark)')
                    .addEventListener('change', applyTheme)
            }
        })

        const appWindow = getCurrentWindow()

        document
            .getElementById('titlebar-minimize')
            ?.addEventListener('click', () => appWindow.minimize())
        document
            .getElementById('titlebar-maximize')
            ?.addEventListener('click', () => appWindow.toggleMaximize())
        document
            .getElementById('titlebar-close')
            ?.addEventListener('click', () => appWindow.close())
        document.getElementById('titlebar')?.addEventListener('mousedown', (e) => {
            if (e.buttons === 1) {
                // Primary (left) button
                e.detail === 2
                    ? appWindow.toggleMaximize() // Maximize on double click
                    : appWindow.startDragging() // Else start dragging
            }
        })
    })
</script>

<div class="app">
    {@render children()}
</div>

<style>
    .app {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
</style>
