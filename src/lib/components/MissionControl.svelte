<script lang="ts">
  import { drydock } from 'services/drydock.svelte'
  import { animator } from 'services'
  import { blogReady } from 'utils'
  import { goto } from '$app/navigation'
  import type { Evidence } from 'schema'
  import { Ocean, Radar, BetForm, EvidenceForm, QuickBetForm, Parlour } from 'components'

  // Place new bet or chat in the parlour about placing one
  let showQuickBet = $state(false)
  let parlourTalk = $state(false)

  // Floating envelope ui notifier of content ready to be drafted
  const floatingEnvelope = $derived(blogReady())

  // Ocean and Radar views
  let currentView = $state<string>('ocean')
  let width = $state(window.innerWidth - 150)
  let height = $state(window.innerHeight - 68 - 100)

  // These are sent to modals for bet and evidence updates
  let changingBetId = $derived<string | null>(null)
  let evidenceFormData = $derived<{ betId: string; editing: Evidence | null } | null>(null)

  // Input from animator on bringing modals into the view
  $effect(() => {
    if (changingBetId || evidenceFormData || showQuickBet) {
      requestAnimationFrame(() => {
        animator.fadeIn('.modal-backdrop')
      })
    }
  })
</script>

<main class="dashboard">
  {#if drydock.bets.length === 0}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  {:else}
    <div class="mailbox" class:has-mail={floatingEnvelope.length > 0}>
      <button class="mailbox-icon" onclick={() => goto('/outbox')}>
        <svg viewBox="0 0 60 60" width="60" height="60">
          {#if floatingEnvelope.length > 0}
            <rect x="45" y="15" width="8" height="15" fill="var(--error)" class="flag-up" />
          {/if}
          <rect
            x="10"
            y="25"
            width="40"
            height="25"
            rx="5"
            fill="var(--bg-tertiary)"
            stroke="var(--border)"
            stroke-width="2" />
          <path d="M10 35 Q30 45 50 35" fill="none" stroke="var(--border)" stroke-width="2" />
        </svg>
        {#if floatingEnvelope.length > 0}
          <span class="mail-count">{floatingEnvelope.length}</span>
        {/if}
      </button>
    </div>

    <section class="control-view">
      <div class="canvas-container">
        <div class="toggle-group">
          <button
            class="toggle-button"
            class:active={currentView === 'ocean'}
            onclick={() => {
              animator.enterView('.canvas-container')
              currentView = 'ocean'
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round" />
            </svg>
          </button>
          <button
            class="toggle-button"
            class:active={currentView === 'firehose'}
            onclick={() => {
              animator.enterView('.canvas-container')
              currentView = 'firehose'
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        </div>

        {#if currentView === 'ocean'}
          <Ocean
            {width}
            {height}
            changingBet={(pred) => (changingBetId = pred.id)}
            onAddEvidence={(predId, editing) => (evidenceFormData = { betId: predId, editing })} />
        {:else}
          <Radar
            {width}
            {height}
            changingBet={(bet) => (changingBetId = bet.id)}
            onAddEvidence={(predId, editing) => (evidenceFormData = { betId: predId, editing })} />
        {/if}
      </div>
    </section>
  {/if}
</main>

<button class="fab" onclick={() => (showQuickBet = true)} title="Place New Bet">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
</button>

{#if changingBetId}
  <BetForm betId={changingBetId} closeEvent={() => (changingBetId = null)} />
{/if}

{#if evidenceFormData}
  <EvidenceForm
    betId={evidenceFormData.betId}
    editing={evidenceFormData.editing}
    closeEvent={() => (evidenceFormData = null)} />
{/if}

{#if showQuickBet}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => {
      showQuickBet = false
      parlourTalk = false
    }}>
    <div class="modal-container modal-md" role="dialog" onclick={(e) => e.stopPropagation()}>
      {#if parlourTalk}
        <Parlour
          complete={() => {
            showQuickBet = false
            parlourTalk = false
          }}
          backToQuickForm={() => (parlourTalk = false)} />
      {:else}
        <div class="modal-body">
          <div class="quickbet">
            <QuickBetForm complete={() => (showQuickBet = false)} />
            <button class="btn-accent quickbet-parlour" onclick={() => (parlourTalk = true)}>
              Not sure what bet to make from your hunch?
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dashboard {
    flex: 1;
    overflow: auto;
    min-height: 0;
    scrollbar-width: none;
  }
  .control-view {
    padding: 24px;
    padding-top: calc(68px + 24px);
    max-width: 1400px;
    margin: 0 auto;
  }

  .quickbet {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .quickbet-parlour {
    align-self: center;
    margin-top: 8px;
  }

  .mailbox {
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 100;
  }

  .mailbox-icon {
    background: var(--bg-secondary);
    border: 2px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px;
    cursor: pointer;
    position: relative;
  }

  .mailbox.has-mail .mailbox-icon {
    animation: pulse-mail 2s ease-in-out infinite;
  }

  .mail-count {
    position: absolute;
    top: -8px;
    right: -8px;
    background: var(--notification);
    color: white;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
  }

  .flag-up {
    animation: wave-flag 1.5s ease-in-out infinite;
  }

  @keyframes pulse-mail {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }

  @keyframes wave-flag {
    0%,
    100% {
      transform: rotate(0deg);
    }
    50% {
      transform: rotate(-10deg);
    }
  }
</style>
