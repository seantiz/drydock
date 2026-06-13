<!-- src/lib/Navbar.svelte -->
<script lang="ts">
    import { animator } from 'services'
    import { goto } from '$app/navigation'
    import { onMount } from 'svelte'
    import { invoke } from '@tauri-apps/api/core'
    import { message } from '@tauri-apps/plugin-dialog'
    import { Gear } from 'icons'
    import { Creator } from 'components'

    interface Props {
        compact?: boolean
    }

    let { compact = false }: Props = $props()

    let showSettings = $state(false)
    let showJourneyModal = $state(false)
    let blueskyHandle = $state('')
    let blueskyAppPassword = $state('')
    let githubToken = $state('')
    let chosenTheme = $state('default')
    let themeMode = $state('auto')

    let dynamicHeaderAllowed = $state(false)
    let dockingComplete = $state(false)

    onMount(async () => {
        blueskyHandle = await invoke('get_settings', { key: 'bluesky_handle' })
        blueskyAppPassword = await invoke('get_settings', { key: 'bluesky_app_password' })
        githubToken = await invoke('get_settings', { key: 'github_token' })

        const themeSettings = await invoke<string>('load_theme')

        if (themeSettings) {
            const settings = JSON.parse(themeSettings)
            chosenTheme = settings.name
            themeMode = settings.mode
        }

        // Enable transitions after initial render
        requestAnimationFrame(() => {
            dynamicHeaderAllowed = true
        })
    })

    async function saveSettings() {
        try {
            await invoke('push_settings', { key: 'bluesky_handle', value: blueskyHandle })
            await invoke('push_settings', {
                key: 'bluesky_app_password',
                value: blueskyAppPassword,
            })

            await invoke('push_settings', { key: 'github_token', value: githubToken })
            await invoke('save_theme', {
                theme: JSON.stringify({ name: chosenTheme, mode: themeMode }),
            })

            if (themeMode === 'auto') {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                document.documentElement.className = `${chosenTheme}-${prefersDark ? 'dark' : 'light'}`
            } else {
                document.documentElement.className = `${chosenTheme}-${themeMode}`
            }

            showSettings = false
        } catch (e) {
            message('Failed to save your credentials. Try again?', {
                title: 'Credentials not saved',
                kind: 'error',
            })
        }
    }

    $effect(() => {
        if (animator.validationDaddy === 'idle' && !dockingComplete) {
            animator.animate('.block-recon, .block-rescue, .block-rebuild', {
                scaleX: [1.15, 1],
                scaleY: [0.85, 1],
                opacity: [0.5, 1],
                duration: 400,
                delay: (_el: HTMLElement, i: number) => i * 150,
                ease: 'out(3)',
                autoplay: true,
                complete: () => {
                    dockingComplete = true
                },
            })
        }
    })
</script>

<header class="header" class:compact class:dynamism={dynamicHeaderAllowed}>
    <div class="header-title-group">
        <h1 class="app-title">Drydock</h1>
    </div>

    <div class="header-content">
        <div class="logo">
            <div class="pillar-blocks" class:ready={animator.startupCompleted}>
                <div
                    class="block-recon"
                    role="button"
                    tabindex="0"
                    onclick={() => goto('/')}
                    onkeydown={(e) => e.key === 'Enter' && goto('/')}
                    onmouseenter={() =>
                        animator.validationDaddy === 'idle' && animator.blockHover('.block-recon')}
                    onmouseleave={() =>
                        animator.validationDaddy === 'idle' && animator.blockLeave('.block-recon')}
                ></div>
                <div
                    class="block-rescue"
                    role="button"
                    tabindex="0"
                    onclick={() => goto('/coastline')}
                    onkeydown={(e) => e.key === 'Enter' && goto('/coastline')}
                    onmouseenter={() =>
                        animator.validationDaddy === 'idle' && animator.blockHover('.block-rescue')}
                    onmouseleave={() =>
                        animator.validationDaddy === 'idle' && animator.blockLeave('.block-rescue')}
                ></div>
                <div
                    class="block-rebuild"
                    role="button"
                    tabindex="0"
                    onclick={() => goto('/community')}
                    onkeydown={(e) => e.key === 'Enter' && goto('/community')}
                    onmouseenter={() =>
                        animator.validationDaddy === 'idle' &&
                        animator.blockHover('.block-rebuild')}
                    onmouseleave={() =>
                        animator.validationDaddy === 'idle' &&
                        animator.blockLeave('.block-rebuild')}
                ></div>
            </div>
        </div>

        <button
            class="settings-button"
            title="settings"
            onclick={() => (showSettings = true)}
            disabled={!animator.startupCompleted}
        >
            <Gear color="var(--accent-primary)" />
        </button>
    </div>
</header>

{#if showSettings}
    <div {@attach animator.modalEntrance('.modal-backdrop', '.settings-modal')}>
        <div
            class="modal-backdrop"
            role="presentation"
            onclick={() => (showSettings = false)}
            onkeydown={(e) => e.key === 'Escape' && (showSettings = false)}
        >
            <div
                class="modal-container settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                tabindex="0"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
            >
                <div class="modal-body">
                    <div class="settings-grid">
                        <div class="settings-column">
<div class="setting-group">
                                <label for="github-token">GitHub Token</label>
                                <input
                                    id="github-token"
                                    type="password"
                                    bind:value={githubToken}
                                    placeholder="ghp_..."
                                    tabindex="0"
                                />
                                <p class="hint">
                                    Personal access token for Coastline (optional, raises rate
                                    limit)
                                </p>
                            </div>
                            <div class="setting-group">
                                <label for="bluesky-handle">Bluesky Handle</label>
                                <input
                                    id="bluesky-handle"
                                    type="text"
                                    bind:value={blueskyHandle}
                                    placeholder="yourhandle.bsky.social"
                                    tabindex="0"
                                />
                                <p class="hint">Your Bluesky username</p>
                            </div>
                            <div class="setting-group">
                                <label for="bluesky-password">Bluesky App Password</label>
                                <input
                                    id="bluesky-password"
                                    type="password"
                                    bind:value={blueskyAppPassword}
                                    placeholder="xxxx-xxxx-xxxx-xxxx"
                                    tabindex="0"
                                />
                                <p class="hint">
                                    Generate at <a
                                        href="https://bsky.app/settings/app-passwords"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        tabindex="0">bsky.app/settings/app-passwords</a
                                    >
                                </p>
                            </div>
                        </div>

                        <div class="settings-column">
                            <div class="setting-group appearance-group">
                                <label for="theme-name">Drydock Appearance</label>
                                <select id="theme-name" bind:value={chosenTheme}>
                                    <option value="default">Default</option>
                                    <option value="fair-game">Fair Game</option>
                                    <option value="gazzetta">Gazzetta</option>
                                </select>
                                <label for="theme-mode">Mode</label>
                                <select id="theme-mode" bind:value={themeMode}>
                                    <option value="auto">Auto (System)</option>
                                    <option value="light">Light</option>
                                    <option value="dark">Dark</option>
                                </select>
                            </div>

                            <button class="btn-accent-lg" onclick={() => (showJourneyModal = true)}>
                                Change Your Creator Settings
                            </button>

                            {#if showJourneyModal}
                                <div
                                    class="modal-backdrop"
                                    onclick={() => (showJourneyModal = false)}
                                >
                                    <div
                                        class="modal-container modal-sm"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        <div class="modal-body">
                                            <Creator
                                                existing={true}
                                                onComplete={() => (showJourneyModal = false)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
</div>
                <div class="settings-actions">
                    <button
                        class="btn-secondary"
                        onclick={() => (showSettings = false)}
                        tabindex="0">Cancel</button
                    >
                    <button class="btn-primary" onclick={saveSettings} tabindex="0">Save</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .header-content {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 16px;
        margin-left: auto;
    }

    .logo {
        display: flex;
        justify-content: flex-end;
    }

    .header-title-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .app-title {
        margin: 0;
        font-size: 48px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--text-primary);
        line-height: 1;
    }

    .header.dynamism .app-title {
        transition: font-size 2s ease;
    }

    .header {
        display: flex;
        position: fixed;
        left: 0;
        right: 0;
        justify-content: space-between;
        align-items: center;
        padding: 14px 32px;
        background: var(--bg-primary);
        z-index: 100;
        flex-shrink: 0;
        height: 120px;
    }

    .header.dynamism {
        transition: all 2s ease;
    }

    .block-recon {
        background: var(--logo-recon);
    }

    .block-rescue {
        background: var(--logo-rescue);
    }

    .block-rebuild {
        background: var(--logo-rebuild);
    }

    .pillar-blocks {
        display: flex;
        gap: 8px;
        padding: 10px;
    }

    .header.dynamism .pillar-blocks {
        transition: padding 2s ease;
    }

    .block-recon,
    .block-rescue,
    .block-rebuild {
        width: 42px;
        height: 78px;
        border-radius: 3px;
        pointer-events: none;
    }

    .pillar-blocks.ready .block-recon,
    .pillar-blocks.ready .block-rescue,
    .pillar-blocks.ready .block-rebuild {
        pointer-events: auto;
        cursor: pointer;
    }

    .header.dynamism .block-recon,
    .header.dynamism .block-rescue,
    .header.dynamism .block-rebuild {
        transition:
            width 2s ease,
            height 2s ease;
    }

    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    }

    .settings-modal {
        background: var(--bg-secondary);
        border: 2px solid var(--border);
        border-radius: var(--radius-lg);
        width: 90%;
        max-width: 800px;
    }

    .settings-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
    }

    .settings-column {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .appearance-group {
        padding: 16px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-md);
    }

    .setting-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .setting-group label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
    }

    .setting-group input {
        padding: 12px 16px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 15px;
    }

    .setting-group input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .hint {
        font-size: 12px;
        color: var(--text-tertiary);
        margin: 0;
    }

    .hint a {
        color: var(--accent-primary);
        text-decoration: none;
    }

    .hint a:hover {
        text-decoration: underline;
    }

    .settings-actions {
        display: flex;
        gap: 12px;
        padding: 20px 32px;
        border-top: 2px solid var(--border);
        justify-content: flex-end;
    }

    .devmode {
        margin-top: 32px;
        padding-top: 24px;
    }

    .settings-button {
        background: transparent;
        border: none;
        padding: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
    }

    .settings-button:disabled {
        pointer-events: none;
        cursor: default;
    }

    .settings-button:hover {
        background: transparent;
    }

    .header.compact {
        height: 68px;
        padding: 8px 32px;
    }

    .header.compact .app-title {
        font-size: 32px;
    }

    .header.compact .pillar-blocks {
        padding: 6px;
    }

    .header.compact .block-recon,
    .header.compact .block-rescue,
    .header.compact .block-rebuild {
        width: 28px;
        height: 52px;
    }
</style>
