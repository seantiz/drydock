<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import { Navbar, MissionControl, Creator } from 'components'
    import { onMount } from 'svelte'

    let showSplash = $state(!animator.startupCompleted)
    let needsJourney = $derived(!drydock.creator)

    onMount(() => {
        if (animator.validationDaddy !== 'startup') return
        setTimeout(() => {
            animator.startupSequence(() => {
                showSplash = false
                animator.postSplash(() => {
                    animator.startupComplete()
                })
                if (drydock.bets.length > 0) {
                    animator.notFirstTimeUser()
                }
            })
        }, 100)
    })
</script>

<Navbar compact={!showSplash} />

<main class="app-root">
    {#if showSplash}
        <div class="splash-container">
            <div class="splash-line">Build your next great story.</div>
            <div class="splash-line">Track the story as it changes.</div>
            <div class="splash-line">Be the voice of your community.</div>
        </div>
    {:else if needsJourney}
        <Creator onComplete={() => drydock.refresh()} />
    {:else}
        <MissionControl />
    {/if}
</main>

<style>
    .app-root {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }

    .splash-container {
        display: flex;
        flex-direction: column;
        gap: 24px;
        text-align: center;
        align-items: center;
        justify-content: center;
        flex: 1;
    }

    .splash-line {
        font-size: 48px;
        font-weight: 700;
        color: var(--text-primary);
    }
</style>
