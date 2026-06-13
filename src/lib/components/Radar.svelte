<!-- Radar component - parent of radar contacts -->
<script lang="ts">
    import type { Blip, Evidence, Bet } from 'schema'
    import { open } from '@tauri-apps/plugin-shell'
    import { message } from '@tauri-apps/plugin-dialog'
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import { Ping, Contact, EvidenceView } from 'components'
    import { Submarine } from 'icons'

    interface Props {
        width: number
        height: number
        changingBet: (bet: Bet) => void
        onAddEvidence: (betId: string, editing: Evidence | null) => void
    }

    let { width, height, changingBet, onAddEvidence }: Props = $props()

    let focusedBlip = $state<Blip | null>(null)
    let focusedBet = $derived<Bet | null>(null)
    let contactRefs = $derived<Record<string, any>>({})

    let radarRadius = $derived(Math.min(width, height) * 0.3)

    let currentRadarIndex = $state(0)
    let polling = $state({ active: false, windingDown: false })

    // Store stable reference frames per bet
    let referenceFrames = $state<
        Map<string, { maxMatches: number; oldest: number; newest: number; timeRange: number }>
    >(new Map())

    function getOrCreateReferenceFrame(betId: string, blips: Blip[]) {
        if (!referenceFrames.has(betId) && blips.length > 0) {
            const timestamps = blips.map((s) => s.createdAt.getTime())
            const oldest = Math.min(...timestamps)
            const newest = Math.max(...timestamps)
            const timeRange = newest - oldest || 1
            const maxMatches = Math.max(...blips.map((s) => s.keywordMatches), 5)

            referenceFrames.set(betId, { maxMatches, oldest, newest, timeRange })
        }
        return referenceFrames.get(betId)
    }

    function calculateRadarPositions(betId: string, blips: Blip[]) {
        if (blips.length === 0) return []

        const frame = getOrCreateReferenceFrame(betId, blips)
        if (!frame) return []

        return blips.map((blip) => {
            const jitter = blip.keywordMatches / frame.maxMatches
            const distance = radarRadius * (0.95 - jitter * 0.65)
            const timeFraction = (blip.createdAt.getTime() - frame.oldest) / frame.timeRange
            const angle = timeFraction * 2 * Math.PI

            return {
                blip: blip,
                x: Math.sin(angle) * distance,
                y: -Math.cos(angle) * distance,
            }
        })
    }

    function calculateTodayPositions(blips: Blip[], boxSize: number) {
        if (blips.length === 0) return []

        const boxRadius = boxSize * 0.35
        const maxMatches = Math.max(...blips.map((s) => s.keywordMatches), 5)

        return blips.map((blip, index) => {
            const jitter = blip.keywordMatches / maxMatches
            const distance = boxRadius * (0.8 - jitter * 0.5)
            // Distribute evenly around the circle
            const angle = (index / blips.length) * 2 * Math.PI

            return {
                blip: blip,
                x: Math.sin(angle) * distance,
                y: -Math.cos(angle) * distance,
            }
        })
    }

    async function pollRadar(predId: string) {
        if (polling.active) return
        polling = { active: true, windingDown: false }
        try {
            await drydock.pollRadar(predId)
            // Reset reference frame so new blips recalibrate the radar
            referenceFrames.delete(predId)
        } catch (err) {
            console.error('Polling error:', err)
            await message(
                `We couldn't connect to one or more sources. Please send a report if this keeps happening.`,
                {
                    title: 'Problem with radar sweep',
                    kind: 'error',
                }
            )
        } finally {
            polling = { active: false, windingDown: true }
            setTimeout(() => {
                polling = { active: false, windingDown: false }
            }, 2000)
        }
    }

    function navigateRadar(direction: 'next' | 'prev') {
        const maxIndex = drydock.firehoseData.length - 1
        if (direction === 'next' && currentRadarIndex >= maxIndex) return
        if (direction === 'prev' && currentRadarIndex <= 0) return

        currentRadarIndex = direction === 'next' ? currentRadarIndex + 1 : currentRadarIndex - 1

        animator.animate('.radar-canvas', {
            opacity: [0, 1],
            duration: 300,
            ease: 'out(2)',
            autoplay: true,
        })
    }

    async function approve(blipId: string) {
        const contact = contactRefs[blipId]
        if (contact) {
            contact.close()
        }
        await drydock.approve(blipId)
    }

    async function discard(blipId: string) {
        const contact = contactRefs[blipId]
        if (contact) {
            contact.close()
        }
        await drydock.dismiss(blipId)
    }
</script>

{#if drydock.firehoseData.length > 1 && !focusedBlip}
    <div class="radar-navigation">
        <button
            class="nav-btn"
            onclick={() => navigateRadar('prev')}
            disabled={currentRadarIndex === 0}>←</button
        >
        <button
            class="nav-btn"
            onclick={() => navigateRadar('next')}
            disabled={currentRadarIndex === drydock.firehoseData.length - 1}>→</button
        >
    </div>
{/if}

<svg {width} {height} class="radar-canvas">
    {#if drydock.firehoseData.length === 0}
        <text
            x={width / 2}
            y={height / 2 - radarRadius - 40}
            text-anchor="middle"
            fill="var(--radar-empty-text)"
            font-size="16px"
        >
            No bets with firehose enabled
        </text>
    {:else}
        <circle
            cx={width / 2}
            cy={height / 2}
            r={radarRadius}
            fill="rgba(100, 116, 139, 0.1)"
            stroke="var(--radar-grid)"
            stroke-width={2}
        />
        <circle
            cx={width / 2}
            cy={height / 2}
            r={radarRadius * 0.33}
            fill="none"
            stroke="var(--radar-grid)"
            stroke-width={1}
            opacity={0.3}
        />
        <circle
            cx={width / 2}
            cy={height / 2}
            r={radarRadius * 0.66}
            fill="none"
            stroke="var(--radar-grid)"
            stroke-width={1}
            opacity={0.3}
        />

        <g class="radar-submarine" transform="translate({width / 2}, {height / 2})">
            <!-- Ripple animations -->
            <circle class="sub-ripple ripple-1" cx="0" cy="0" r="0" />
            <circle class="sub-ripple ripple-2" cx="0" cy="0" r="0" />
            <circle class="sub-ripple ripple-3" cx="0" cy="0" r="0" />

            <!-- The submarine itself -->
            <g class="sub-bobbing">
                <Submarine color="var(--radar-submarine)" width={120} height={60} />
            </g>
        </g>

        <line
            x1={width / 2}
            x2={width / 2}
            y1={height / 2 - radarRadius}
            y2={height / 2 + radarRadius}
            stroke="var(--radar-grid)"
            stroke-width={1}
            stroke-dasharray="4,4"
            opacity={0.5}
        />
        <line
            x1={width / 2 - radarRadius}
            x2={width / 2 + radarRadius}
            y1={height / 2}
            y2={height / 2}
            stroke="var(--radar-grid)"
            stroke-width={1}
            stroke-dasharray="4,4"
            opacity={0.5}
        />

        {#if polling.active || polling.windingDown}
            <g
                class="radar-sweep-line"
                style="transform-origin: {width / 2}px {height / 2}px; opacity: {polling.active
                    ? 0.7
                    : 0}; transition: opacity 2s"
            >
                <line
                    x1={width / 2}
                    y1={height / 2}
                    x2={width / 2}
                    y2={height / 2 - radarRadius}
                    stroke="var(--radar-sweep)"
                    stroke-width={3}
                    opacity={0.7}
                />
            </g>
        {/if}

        <text
            x={width / 2}
            y={height / 2 - radarRadius - 40}
            text-anchor="middle"
            fill="var(--text-primary)"
            font-size="20px"
            font-weight="600"
            style="cursor: pointer"
            onclick={() => (focusedBet = drydock.firehoseData[currentRadarIndex].bet)}
        >
            {drydock.firehoseData[currentRadarIndex].bet.codename}
        </text>

        {#if drydock.firehoseData[currentRadarIndex].bet.firehoseFilters?.strategyUpdated}
            <text
                x={width / 2}
                y={height / 2 - radarRadius + 500}
                text-anchor="middle"
                fill="var(--logo-recon)"
                font-size="14px"
                opacity="0.9"
            >
                Your search words are synced
            </text>
        {/if}

        <!-- Filter blips: last 24h go to box, rest go to radar -->
        {@const now = Date.now()}
        {@const oneDayAgo = now - 24 * 60 * 60 * 1000}
        {@const allBlips = drydock.firehoseData[currentRadarIndex].blips}
        {@const todaysBlips = allBlips.filter((s) => s.createdAt.getTime() > oneDayAgo)}
        {@const radarblips = allBlips.filter((s) => s.createdAt.getTime() <= oneDayAgo)}

        {#each calculateRadarPositions(drydock.firehoseData[currentRadarIndex].bet.id, radarblips) as { blip, x, y } (blip.id)}
            <Contact
                bind:this={contactRefs[blip.id]}
                {blip}
                x={width / 2 + x}
                y={height / 2 + y}
                centerX={width / 2}
                centerY={height / 2}
                expanded={focusedBlip?.id === blip.id}
                onexpand={() => (focusedBlip = blip)}
                oncollapse={() => (focusedBlip = null)}
            />
        {/each}

        <!-- Timeline quadrant labels -->
        {#if drydock.firehoseData[currentRadarIndex].blips.length > 1}
            {@const predId = drydock.firehoseData[currentRadarIndex].bet.id}
            {@const frame = getOrCreateReferenceFrame(
                predId,
                drydock.firehoseData[currentRadarIndex].blips
            )}
            {#if frame && frame.timeRange > 0}
                {@const labelRadius = radarRadius + 30}
                {@const formatDate = (timestamp: number) => {
                    const d = new Date(timestamp)
                    const month = d.toLocaleDateString('en-US', { month: 'short' })
                    const day = d.getDate()
                    const year = String(d.getFullYear()).slice(-2)
                    return `${month} ${day} '${year}`
                }}
                // Map 0°, 90°, 180°, 270° to timestamps
                {@const date0 = formatDate(frame.oldest)} // 0° = oldest
                {@const date1 = formatDate(frame.oldest + frame.timeRange * 0.25)} // 90°
                {@const date2 = formatDate(frame.oldest + frame.timeRange * 0.5)} // 180°
                {@const date3 = formatDate(frame.oldest + frame.timeRange * 0.75)} // 270°

                <!-- 12 o'clock (oldest) -->
                <text
                    x={width / 2}
                    y={height / 2 - labelRadius}
                    text-anchor="middle"
                    fill="var(--radar-grid)"
                    font-size="10px"
                    opacity="0.5"
                >
                    {date0}
                </text>

                <!-- 3 o'clock -->
                <text
                    x={width / 2 + labelRadius}
                    y={height / 2 + 4}
                    text-anchor="start"
                    fill="var(--radar-grid)"
                    font-size="10px"
                    opacity="0.5"
                >
                    {date1}
                </text>

                <!-- 6 o'clock -->
                <text
                    x={width / 2}
                    y={height / 2 + labelRadius + 10}
                    text-anchor="middle"
                    fill="var(--radar-grid)"
                    font-size="10px"
                    opacity="0.5"
                >
                    {date2}
                </text>

                <!-- 9 o'clock -->
                <text
                    x={width / 2 - labelRadius}
                    y={height / 2 + 4}
                    text-anchor="end"
                    fill="var(--radar-grid)"
                    font-size="10px"
                    opacity="0.5"
                >
                    {date3}
                </text>
            {/if}
        {/if}

        <Ping
            {polling}
            x={width / 2 + radarRadius + 80}
            y={height / 2 - radarRadius}
            onclick={() => pollRadar(drydock.firehoseData[currentRadarIndex].bet.id)}
        />

        {#each drydock.sweepMessages as msg (msg.id)}
            <text
                x={width / 2 + radarRadius + 80}
                y={height / 2 - radarRadius + 52 + msg.yOffset}
                text-anchor="middle"
                fill="var(--text-secondary)"
                font-size="11px"
                class="sweep-message">{msg.text}</text
            >
        {/each}

        <!-- TODAY box for last 24 hours blips -->
        {#if todaysBlips.length > 0}
            {@const boxSize = 150}
            {@const boxX = 20}
            {@const boxY = 20}
            {@const boxCenterX = boxX + boxSize / 2}
            {@const boxCenterY = boxY + boxSize / 2}

            <!-- Box background -->
            <rect
                x={boxX}
                y={boxY}
                width={boxSize}
                height={boxSize}
                fill="rgba(251, 146, 60, 0.05)"
                stroke="var(--radar-sweep)"
                stroke-width="2"
                rx="8"
            />

            <!-- TODAY label -->
            <text
                x={boxCenterX}
                y={boxY + 15}
                text-anchor="middle"
                fill="var(--radar-sweep)"
                font-size="10px"
                font-weight="700"
            >
                Over The Last Day
            </text>

            <!-- Today's blips -->
            {#each calculateTodayPositions(todaysBlips, boxSize) as { blip, x, y } (blip.id)}
                <Contact
                    bind:this={contactRefs[blip.id]}
                    {blip}
                    x={boxCenterX + x}
                    y={boxCenterY + y}
                    centerX={boxCenterX}
                    centerY={boxCenterY}
                    expanded={focusedBlip?.id === blip.id}
                    onexpand={() => (focusedBlip = blip)}
                    oncollapse={() => (focusedBlip = null)}
                    todayMode={true}
                />
            {/each}
        {/if}
    {/if}

    <!-- Expanded existing evidence view modal -->
    {#if focusedBet}
        {@const cardWidth = 900}
        {@const cardHeight = Math.min(height * 0.85, 800)}
        {@const cardX = width / 2 - cardWidth / 2}
        {@const cardY = height / 2 - cardHeight / 2}

        <g {@attach animator.modalEntrance('[data-backdrop-id]', '[data-modal-id]')}>
            <rect
                data-backdrop-id={focusedBet.id}
                x="0"
                y="0"
                width="100%"
                height="100%"
                fill="rgba(0, 0, 0, 0.7)"
                style="cursor: pointer"
                onclick={() => (focusedBet = null)}
            />

            <foreignObject
                x={cardX}
                y={cardY}
                width={cardWidth}
                height={cardHeight}
                style="pointer-events: auto"
            >
                <div
                    class="evidence-modal-content"
                    data-modal-id={focusedBet.id}
                    onclick={(e) => e.stopPropagation()}
                >
                    <EvidenceView
                        bet={focusedBet}
                        closing={() => (focusedBet = null)}
                        onEdit={changingBet}
                        {onAddEvidence}
                    />
                </div>
            </foreignObject>
        </g>
    {/if}

    {#if focusedBlip}
        {@const cardWidth = 600}
        {@const cardHeight = Math.min(height * 0.8, 900)}
        {@const cardX = width / 2 - cardWidth / 2}
        {@const cardY = height / 2 - cardHeight / 2}
        {@const swept = focusedBlip}

        <!--- This is just the backdrop --->
        <rect
            data-backdrop-id={swept.id}
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.7)"
            style="cursor: pointer"
            onclick={() => contactRefs[swept.id]?.close()}
        />

        <!-- This is the actual modal container -->
        <foreignObject
            data-modal-id={focusedBlip.id}
            x={cardX}
            y={cardY}
            width={cardWidth}
            height={cardHeight}
            style="pointer-events: auto; overflow: visible;"
            >>
            <!--- This is the modal child container for content -->
            <div class="signal-modal-content" onclick={(e) => e.stopPropagation()}>
                <div class="section-header">
                    <div class="signal-author-info">
                        {#if swept.source === 'bluesky' && swept.authorAvatar}
                            <img
                                src={swept.authorAvatar}
                                alt={swept.author}
                                class="author-avatar"
                            />
                        {:else}
                            <span
                                class="source-badge {swept.source === 'hackernews'
                                    ? 'hnavatar'
                                    : 'bskyavatar'}"
                            >
                                {swept.source === 'hackernews' ? 'HN' : 'B'}
                            </span>
                        {/if}
                        <button
                            class="author-handle"
                            onclick={() =>
                                open(
                                    swept.source === 'hackernews'
                                        ? `https://news.ycombinator.com/user?id=${swept.author}`
                                        : `https://bsky.app/profile/${swept.author}`
                                )}
                        >
                            {swept.source === 'hackernews' ? swept.author : `@${swept.author}`}
                        </button>
                    </div>
                    <button class="close-btn" onclick={() => contactRefs[swept.id]?.close()}
                        >✕</button
                    >
                </div>
                <div class="signal-body">
                    <p class="signal-text">{swept.text}</p>
                    <div class="signal-meta">
                        <span><strong>Keyword matches:</strong> {swept.keywordMatches}</span>
                        <span
                            ><strong>Captured:</strong>
                            {swept.capturedAt.toLocaleDateString()}</span
                        >
                    </div>
                    <button class="view-original-btn" onclick={() => open(swept.postUrl)}>
                        View on {swept.source === 'hackernews' ? 'Hacker News' : 'Bluesky'} →
                    </button>
                </div>
                <div class="signal-actions">
                    <button class="btn-dismiss" onclick={() => discard(swept.id)}> Dismiss </button>
                    <button class="btn-approve" onclick={() => approve(swept.id)}>
                        Approve as Evidence
                    </button>
                </div>
            </div>
        </foreignObject>
    {/if}
</svg>

<style>
    .radar-canvas {
        display: block;
    }

    .sweep-message {
        animation: sweepMsgFade 5s forwards ease-out;
    }

    @keyframes sweepMsgFade {
        0% {
            opacity: 0.65;
        }
        60% {
            opacity: 0.5;
        }
        100% {
            opacity: 0;
        }
    }

    .radar-sweep-line {
        animation: spin 2s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .radar-navigation {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        transform: translateY(-50%);
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 20px;
        pointer-events: none;
        z-index: 1;
    }

    .signal-modal-content {
        background: var(--bg-elevated);
        border: 2px solid var(--border);
        border-radius: 12px;
        padding: 24px;
        height: 100%;
        min-height: 100%;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        contain: layout style;
    }

    .signal-body {
        flex: 1;
        overflow-y: auto;
    }

    .signal-text {
        margin: 16px 0;
        line-height: 1.6;
        color: var(--text-primary);
    }

    .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
    }

    .signal-author-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .author-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
    }

    .source-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 700;
        flex-shrink: 0;
    }

    .hnavatar {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .bskyavatar {
        background: rgba(0, 133, 255, 0.15);
        color: #0085ff;
        border: 1px solid rgba(0, 133, 255, 0.3);
    }

    .author-handle {
        background: none;
        border: none;
        color: var(--accent-primary);
        cursor: pointer;
        font-weight: 600;
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 24px;
        cursor: pointer;
    }

    .signal-text {
        margin: 16px 0;
        line-height: 1.6;
    }

    .signal-meta {
        display: flex;
        gap: 16px;
        font-size: 14px;
        color: var(--text-secondary);
        margin: 16px 0;
    }

    .signal-actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
    }

    .btn-dismiss,
    .btn-chatter,
    .btn-approve {
        flex: 1;
        padding: 12px;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: 600;
    }

    .btn-dismiss {
        background: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .btn-approve {
        background: var(--accent-primary);
        color: white;
    }

    .view-original-btn {
        background: var(--bg-tertiary);
        border: none;
        padding: 8px 16px;
        border-radius: var(--radius-sm);
        color: var(--accent-primary);
        cursor: pointer;
        font-size: 14px;
    }

    .evidence-modal-content {
        background: var(--bg-elevated);
        border: 2px solid var(--border);
        border-radius: 12px;
        height: 100%;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
    }

    [data-backdrop-id] {
        animation: fadeIn 0.3s ease-out;
    }

    [data-modal-id] {
        animation: modalSlideIn 0.3s ease-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 0.7;
        }
    }

    @keyframes modalSlideIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    /* Submarine ambient stuff */
    .radar-submarine {
        pointer-events: none;
    }

    .sub-bobbing {
        animation: gentle-bob 4s ease-in-out infinite;
    }

    .sub-ripple {
        fill: none;
        stroke: var(--radar-grid);
        stroke-width: 2;
        opacity: 0.5;
    }

    .ripple-1 {
        animation: ripple-expand 6s ease-out infinite;
    }

    .ripple-2 {
        animation: ripple-expand 6s ease-out 2s infinite;
    }

    .ripple-3 {
        animation: ripple-expand 6s ease-out 4s infinite;
    }

    @keyframes gentle-bob {
        0%,
        100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-8px);
        }
    }

    @keyframes ripple-expand {
        0% {
            r: 0;
            opacity: 0.6;
        }
        100% {
            r: 80;
            opacity: 0;
        }
    }
</style>
