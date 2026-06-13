<script lang="ts">
    import type { Bet, Evidence, EvidenceDot, StreamData, PublicationDot } from 'schema'
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import { wingman } from 'services/wingman.svelte'
    import { Lighthouse, Submarine } from 'icons'
    import { EvidenceView } from 'components'

    interface Props {
        width: number
        height: number
        changingBet: (bet: Bet) => void
        onAddEvidence: (betId: string, editing: Evidence | null) => void
    }

    let { width, height, changingBet, onAddEvidence }: Props = $props()

    const GRACE_PERIOD = 24 * 60 * 60 * 1000

    // Derived state from drydock - filter out published bets
    let bets = $derived(drydock.bets.filter((b) => b.missionStatus !== 'published'))
    let evidence = $derived(drydock.evidence)
    let voice = $derived(drydock.creator?.voice ?? 'chronicle')

    let capacity = $derived(wingman.checkCapacity)

    // NOTE: Deliberately a one-time only value at mount so we can do the wingman comparison
    // svelte-ignore state_referenced_locally
    let initialBets = $state(capacity.activeBets)

    $effect(() => {
        if (capacity.activeBets !== initialBets) {
            // Draft pressure gauge graphics
            const sweep = 180 + (capacity.activeBets / capacity.capacity) * 180
            animator.gaugeSweep('.gauge-needle', sweep)
            animator.gaugePing('.gauge-ping')

            initialBets = capacity.activeBets
        }
    })

    let focusedBetId = $state<string | null>(null)
    let focusedBet = $derived(focusedBetId ? bets.find((b) => b.id === focusedBetId) : null)
    let showStats = $state(false)

    // Get evidence counts for the expanded bet
    let evidenceMeta = $derived(focusedBet ? getStats(drydock.evidenceFor(focusedBet.id)) : null)

    // Constants
    const STREAM_SPACING = 80
    const STREAM_BASE_WIDTH = 8
    const VIEWPORT_PADDING = { top: 80, bottom: 80, left: 120, right: 100 }
    const ANIMATION_SCALE = 100

    // Animation infrastructure
    let masterTimeline = $state(animator.timeline({ autoplay: true, loop: true }))
    let betTimelines = $state(new Map<string, any>())

    function getStats(fromThe: Evidence[]): {
        supports: number
        refutes: number
        neutral: number
    } {
        return fromThe.reduce(
            (acc, e) => {
                if (e.sentiment === 'supports') acc.supports++
                else if (e.sentiment === 'refutes') acc.refutes++
                else acc.neutral++
                return acc
            },
            { supports: 0, refutes: 0, neutral: 0 }
        )
    }

    function streamColor(status: Bet['missionStatus']): string {
        switch (status) {
            case 'active':
                return 'var(--stream-active)'
            case 'ready':
                return 'var(--stream-ready)'
            case 'failing':
                return 'var(--stream-failing)'
            case 'dormant':
                return 'var(--stream-dormant)'
            default:
                return 'var(--stream-stale)'
        }
    }

    function generateStreamPath(stream: StreamData): string {
        const { originX, originY, destX, destY } = stream

        // Create smooth curves that fan out from origin
        const deltaY = destY - originY
        const controlX1 = originX + (destX - originX) * 0.3
        const controlY1 = originY + deltaY * 0.1
        const controlX2 = originX + (destX - originX) * 0.7
        const controlY2 = originY + deltaY * 0.9

        return `M ${originX},${originY} C ${controlX1},${controlY1} ${controlX2},${controlY2} ${destX},${destY}`
    }

    // Helper to get point along cubic Bezier curve
    function getCurvePoint(stream: StreamData, t: number): { x: number; y: number } {
        const { originX, originY, destX, destY } = stream
        const deltaY = destY - originY
        const controlX1 = originX + (destX - originX) * 0.3
        const controlY1 = originY + deltaY * 0.1
        const controlX2 = originX + (destX - originX) * 0.7
        const controlY2 = originY + deltaY * 0.9

        const t1 = 1 - t
        const x =
            t1 * t1 * t1 * originX +
            3 * t1 * t1 * t * controlX1 +
            3 * t1 * t * t * controlX2 +
            t * t * t * destX
        const y =
            t1 * t1 * t1 * originY +
            3 * t1 * t1 * t * controlY1 +
            3 * t1 * t * t * controlY2 +
            t * t * t * destY

        return { x, y }
    }

    // Calculate dynamic SVG height and lighthouse position
    // Scale spacing to fit all bets within the available height
    let streamSpacing = $derived.by(() => {
        if (bets.length === 0) return STREAM_SPACING
        const availableHeight = height - VIEWPORT_PADDING.top - VIEWPORT_PADDING.bottom
        const requiredHeight = bets.length * STREAM_SPACING
        if (requiredHeight > availableHeight) {
            return availableHeight / bets.length
        }
        return STREAM_SPACING
    })

    let svgHeight = $derived(height)
    let lighthouseX = $derived(VIEWPORT_PADDING.left - 20)
    let lighthouseY = $derived(svgHeight / 2)

    function findFinishedBets(betId: string) {
        const arcClosingRole = voice === 'reckoning' ? 'outcome'
            : voice === 'witness' ? 'conclusion'
            : 'new_map'
        return (
            drydock.history
                .filter(
                    (p) =>
                        p.betId === betId &&
                        !!p.postedUrl &&
                        (p.blocks ?? []).some((b) => b.role === arcClosingRole)
                )
                .sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime())[0] ?? null
        )
    }

    // Layout streams - all originate from lighthouse, fan out horizontally to staggered destinations
    let streams = $derived.by(() => {
        if (bets.length === 0) return []

        // Drop bets whose arc completed more than 1 day ago (grace period expired)
        const visibleBets = bets.filter((bet) => {
            const maybeCompleted = findFinishedBets(bet.id)
            if (!maybeCompleted) return true
            return Date.now() - maybeCompleted.generatedAt.getTime() <= Number(GRACE_PERIOD)
        })

        const maxDays = Math.max(
            ...visibleBets.map((b) =>
                b.targetDate
                    ? (b.targetDate.getTime() - b.madeAt.getTime()) / Number(GRACE_PERIOD)
                    : 30
            )
        )
        const availableWidth = width - VIEWPORT_PADDING.left - VIEWPORT_PADDING.right
        const pixelsPerDay = availableWidth / maxDays

        return visibleBets.map((bet, idx) => {
            const betEvidence = evidence.filter((e) => e.betId === bet.id)
            const days = bet.targetDate
                ? (bet.targetDate.getTime() - bet.madeAt.getTime()) / Number(GRACE_PERIOD)
                : 30 // fallback for bets without targetDate
            const length = days * pixelsPerDay

            // All streams start from lighthouse position
            const originX = lighthouseX + 20
            const originY = lighthouseY

            // Destinations are staggered vertically and horizontally by maturity
            const destY = VIEWPORT_PADDING.top + idx * streamSpacing
            const destX = originX + length

            const plotE: EvidenceDot[] = betEvidence.map((e) => ({
                source: e,
                jitter: (e.capturedAt.getTime() - bet.madeAt.getTime()) / Number(GRACE_PERIOD),
            }))

            const betPubs = drydock.history.filter((p) => p.betId === bet.id)
            const plotP: PublicationDot[] = betPubs.map((source) => ({
                source,
                jitter: Math.max(
                    0,
                    (source.generatedAt.getTime() - bet.madeAt.getTime()) / Number(GRACE_PERIOD)
                ),
                isDraft: !source.postedUrl,
            }))

            const newMapPub = findFinishedBets(bet.id)
            const arcCompletedAt = newMapPub?.generatedAt ?? null

            return {
                bet,
                pathId: `stream-path-${bet.id}`,
                color: streamColor(bet.missionStatus),
                eDots: plotE,
                pDots: plotP,
                arcCompletedAt,
                originX,
                originY,
                destX,
                destY,
                length,
                width: STREAM_BASE_WIDTH,
                days,
            }
        })
    })

    let hoveredStreamId = $state<string | null>(null)

    let arcCompleted = $derived(streams.filter((s) => s.arcCompletedAt !== null))

    function gracePeriodRemaining(completed: Date): string {
        const remaining = GRACE_PERIOD - (Date.now() - completed.getTime())
        const hours = Math.floor(remaining / (60 * 60 * 1000))
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
        if (hours > 0) return `${hours}h ${minutes}m`
        return `${minutes}m`
    }

    async function confirmPublished(betId: string) {
        await drydock.changeStatus(betId, 'published')
    }

    // Svelte action for per-stream animation setup
    function oceanLife(pathElement: SVGPathElement, stream: StreamData) {
        const status = stream.bet.missionStatus
        const motionPath = animator.motionPath(pathElement)
        const betTimeline = animator.timeline({
            duration: stream.days,
            autoplay: status === 'active' || status === 'ready',
            loop: status === 'active' || status === 'ready',
        })

        // Only animate submarines for active/ready bets
        if (status === 'active' || status === 'ready') {
            for (let i = 0; i < 3; i++) {
                const particleDelay = (stream.days / 3) * i
                betTimeline.add(
                    `.particle-${stream.bet.id}-${i}`,
                    {
                        ...motionPath,
                        opacity: [0, 0.8, 0.8, 0],
                        duration: stream.days * ANIMATION_SCALE,
                    },
                    particleDelay
                )
            }
        }

        betTimelines.set(stream.pathId, betTimeline)
        masterTimeline.sync(betTimeline, 0)

        return {
            destroy() {
                betTimeline.cancel()
                betTimelines.delete(stream.pathId)
            },
        }
    }
</script>

<div class="pipeline-container">
    {#if arcCompleted.length > 0}
        <div class="arc-panel">
            {#each arcCompleted as stream}
                <div class="arc-item">
                    <div class="arc-item-info">
                        <span class="arc-item-codename">{stream.bet.codename}</span>
                        <span class="arc-item-detail">
                            Chronicle arc complete · {gracePeriodRemaining(stream.arcCompletedAt!)} remaining
                        </span>
                    </div>
                    <button class="arc-confirm-btn" onclick={() => confirmPublished(stream.bet.id)}>
                        Mark Published ✓
                    </button>
                </div>
            {/each}
        </div>
    {/if}
    <svg {width} height={svgHeight} class="pipeline-canvas">
        {#if !focusedBet}
            <!-- Pressure Gauge capacity indicator - top-left -->
            <g class="gauge-container" transform="translate(100, 80)">
                <!-- Gauge background circle -->
                <circle
                    cx="0"
                    cy="0"
                    r="50"
                    fill="var(--bg-tertiary)"
                    stroke="var(--border)"
                    stroke-width="3"
                />

                <!-- Ping ring (animated) -->
                <circle
                    class="gauge-ping"
                    cx="0"
                    cy="0"
                    r="45"
                    fill="none"
                    stroke="var(--accent-primary)"
                    stroke-width="2"
                    opacity="0"
                />

                <!-- Color zones (arc segments) -->
                <defs>
                    <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="var(--success)" />
                        <stop offset="70%" stop-color="var(--warning)" />
                        <stop offset="100%" stop-color="var(--error)" />
                    </linearGradient>
                </defs>

                <!-- Gauge arc (180° top half from left to right) -->
                <path
                    d="M -35,-35 A 50 50 0 0 1 35,-35"
                    fill="none"
                    stroke="url(#gauge-gradient)"
                    stroke-width="8"
                    stroke-linecap="round"
                />

                <!-- Tick marks -->
                {#each Array(capacity.capacity + 1) as _, i}
                    {@const angle = 180 + (i / capacity.capacity) * 180}
                    {@const radians = (angle * Math.PI) / 180}
                    {@const x1 = Math.cos(radians) * 38}
                    {@const y1 = Math.sin(radians) * 38}
                    {@const x2 = Math.cos(radians) * 32}
                    {@const y2 = Math.sin(radians) * 32}
                    <line {x1} {y1} {x2} {y2} stroke="var(--text-tertiary)" stroke-width="2" />
                {/each}

                <!-- Needle (rotates based on capacity) -->
                <g
                    class="gauge-needle"
                    transform="rotate({180 + (capacity.activeBets / capacity.capacity) * 180})"
                >
                    <line
                        x1="0"
                        y1="0"
                        x2="30"
                        y2="0"
                        stroke="var(--accent-primary)"
                        stroke-width="3"
                        stroke-linecap="round"
                    />
                    <circle cx="0" cy="0" r="4" fill="var(--accent-primary)" />
                </g>

                <!-- Center display -->
                <text
                    x="0"
                    y="25"
                    text-anchor="middle"
                    fill="var(--text-primary)"
                    font-size="16px"
                    font-weight="700">{capacity.activeBets}/{capacity.capacity}</text
                >

                <!-- Label below gauge -->
                <text
                    x="0"
                    y="70"
                    text-anchor="middle"
                    fill="var(--text-secondary)"
                    font-size="10px"
                    font-weight="600">Draft Pressure</text
                >
                <text
                    x="0"
                    y="85"
                    text-anchor="middle"
                    fill={capacity.healthy && !capacity.atCapacity
                        ? 'var(--success)'
                        : 'var(--warning)'}
                    font-size="9px"
                    font-weight="500">{capacity.reason}</text
                >
            </g>
        {/if}

        <!-- Stream Legend - i button -->
        <g class="legend" transform="translate(100, {svgHeight - 150})">
            <!-- Info circle button -->
            <circle
                cx="0"
                cy="0"
                r="16"
                fill="var(--bg-tertiary)"
                stroke="var(--border)"
                stroke-width="2"
                class="info-button"
            />
            <text
                x="0"
                y="0"
                text-anchor="middle"
                fill="var(--text-secondary)"
                font-size="14px"
                font-weight="700"
                dy="5"
                class="info-icon">i</text
            >

            <!-- Legend popup i button -->
            <g class="legend-popup" opacity="0">
                <rect
                    x="30"
                    y="-60"
                    width="130"
                    height="110"
                    rx="8"
                    fill="var(--bg-elevated)"
                    stroke="var(--border)"
                    stroke-width="2"
                />
                <text x="40" y="-40" fill="var(--text-primary)" font-size="11px" font-weight="600"
                    >Stream Health</text
                >
                <line
                    x1="40"
                    y1="-30"
                    x2="55"
                    y2="-30"
                    stroke="var(--stream-active)"
                    stroke-width="4"
                />
                <text x="60" y="-27" fill="var(--text-secondary)" font-size="10px">Active</text>

                <line
                    x1="40"
                    y1="-15"
                    x2="55"
                    y2="-15"
                    stroke="var(--stream-ready)"
                    stroke-width="4"
                />
                <text x="60" y="-12" fill="var(--text-secondary)" font-size="10px">Ready</text>

                <line
                    x1="40"
                    y1="0"
                    x2="55"
                    y2="0"
                    stroke="var(--stream-failing)"
                    stroke-width="4"
                />
                <text x="60" y="3" fill="var(--text-secondary)" font-size="10px">Failing</text>

                <line
                    x1="40"
                    y1="15"
                    x2="55"
                    y2="15"
                    stroke="var(--stream-dormant)"
                    stroke-width="4"
                />
                <text x="60" y="18" fill="var(--text-secondary)" font-size="10px">Dormant</text>

                <line
                    x1="40"
                    y1="30"
                    x2="55"
                    y2="30"
                    stroke="var(--stream-stale)"
                    stroke-width="4"
                />
                <text x="60" y="33" fill="var(--text-secondary)" font-size="10px">Stale</text>
            </g>
        </g>

        {#if streams.length === 0}
            <text
                x={width / 2}
                y={svgHeight / 2}
                text-anchor="middle"
                fill="#64748b"
                font-size="16px"
            >
                No bets yet. Click the + button to create one.
            </text>
        {:else}
            <defs>
                {#each streams as stream}
                    <filter id="glow-{stream.bet.id}">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                {/each}
            </defs>

            <!-- Stream layer -->
            <g class="stream-layer">
                {#each streams as stream (stream.bet.id)}
                    {@const isHovered = hoveredStreamId === stream.bet.id}
                    <g
                        class="stream-group"
                        onmouseenter={() => (hoveredStreamId = stream.bet.id)}
                        onmouseleave={() => (hoveredStreamId = null)}
                        onclick={() => {
                            focusedBetId = stream.bet.id
                            showStats = false
                        }}
                    >
                        <!-- Stream path with animation -->
                        <path
                            id={stream.pathId}
                            use:oceanLife={stream}
                            d={generateStreamPath(stream)}
                            stroke={stream.color}
                            stroke-width={stream.width}
                            fill="none"
                            opacity={isHovered
                                ? 0.95
                                : hoveredStreamId
                                  ? 0.15
                                  : stream.bet.missionStatus === 'ready'
                                    ? 0.85
                                    : stream.bet.missionStatus === 'active'
                                      ? 0.7
                                      : 0.4}
                            stroke-linecap="round"
                            filter={isHovered ? `url(#glow-${stream.bet.id})` : ''}
                            class="stream-path"
                        />

                        <!-- Bet label on hover (near destination) -->
                        {#if isHovered}
                            {@const wouldOverflow =
                                stream.destX + 15 + stream.bet.codename.length * 7 > width}
                            <text
                                x={wouldOverflow ? stream.destX - 15 : stream.destX + 15}
                                y={stream.destY}
                                text-anchor={wouldOverflow ? 'end' : 'start'}
                                fill="var(--text-primary)"
                                font-size="12px"
                                font-weight="600"
                                dy="4"
                                stroke="var(--bg-primary)"
                                stroke-width="3"
                                paint-order="stroke"
                            >
                                {stream.bet.codename}
                            </text>
                        {/if}

                        <!-- Publication markers on stream (always visible) -->
                        {#each stream.pDots as dot}
                            {@const t =
                                stream.days > 0 ? Math.min(dot.jitter / stream.days, 1.0) : 0}
                            {@const point = getCurvePoint(stream, t)}
                            <!-- ▲ pointing up, sitting below the stream line -->
                            <polygon
                                points="{point.x},{point.y + 8} {point.x - 5},{point.y +
                                    17} {point.x + 5},{point.y + 17}"
                                fill={dot.isDraft
                                    ? 'var(--text-tertiary)'
                                    : 'var(--accent-primary)'}
                                opacity={dot.isDraft ? 0.5 : 0.9}
                            />
                        {/each}

                        <!-- Arc-complete pulsing ring at stream endpoint -->
                        {#if stream.arcCompletedAt}
                            <circle
                                cx={stream.destX}
                                cy={stream.destY}
                                r="14"
                                fill="none"
                                stroke="var(--accent-primary)"
                                stroke-width="2"
                                class="arc-ring"
                            />
                            <circle
                                cx={stream.destX}
                                cy={stream.destY}
                                r="5"
                                fill="var(--accent-primary)"
                                opacity="0.9"
                            />
                        {/if}
                    </g>
                {/each}
            </g>

            <!-- Single lighthouse origin (render on top so it's visible) -->
            <g transform="translate({lighthouseX - 50}, {lighthouseY - 20})" opacity="0.7">
                <Lighthouse
                    color={hoveredStreamId ? 'var(--lighthouse-active)' : 'var(--lighthouse-idle)'}
                    scale={0.6}
                    showLabel={false}
                />
            </g>

            <!-- Particle layer -->
            <g class="particle-layer">
                {#each streams as stream (stream.bet.id)}
                    {@const status = stream.bet.missionStatus}

                    {#if status === 'active' || status === 'ready'}
                        <!-- Animated submarines for active/ready bets -->
                        {#each [0, 1, 2] as particleIdx}
                            <g class="particle-{stream.bet.id}-{particleIdx}" opacity="0">
                                <Submarine color={stream.color} x={-30} y={-5} />
                            </g>
                        {/each}
                    {:else if status === 'stale' || status === 'failing'}
                        <!-- Static submarine parked at last evidence -->
                        {#if stream.eDots.length > 0}
                            {@const lastEvidence = stream.eDots[stream.eDots.length - 1]}
                            {@const t = lastEvidence.jitter / stream.days}
                            {@const point = getCurvePoint(stream, t)}
                            <g transform="translate({point.x}, {point.y}) scale(0.5)">
                                <Submarine color={stream.color} />
                            </g>
                        {:else}
                            <!-- No evidence, park at start -->
                            {@const startPoint = { x: stream.originX, y: stream.originY }}
                            <g transform="translate({startPoint.x}, {startPoint.y}) scale(0.5)">
                                <Submarine color={stream.color} />
                            </g>
                        {/if}
                    {/if}
                {/each}
            </g>

            <!-- Expanded evidence view modal -->
            {#if focusedBet}
                {@const cardWidth = 700}
                {@const cardHeight = 600}
                {@const cardX = width / 2 - cardWidth / 2}
                {@const cardY = height / 2 - cardHeight / 2}

                <rect
                    data-backdrop-id={focusedBet.id}
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill="rgba(0, 0, 0, 0.7)"
                    style="cursor: pointer"
                    onclick={() => {
                        focusedBetId = null
                        showStats = false
                    }}
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
                            closing={() => {
                                focusedBetId = null
                                showStats = false
                            }}
                            onEdit={changingBet}
                            {onAddEvidence}
                            onToggleStats={() => {
                                if (showStats) {
                                    showStats = false
                                } else {
                                    showStats = true
                                    requestAnimationFrame(() => {
                                        animator.animate('.stat-item', {
                                            opacity: [0, 1],
                                            translateX: [-10, 0],
                                            duration: 300,
                                            delay: (_el: HTMLElement, i: number) => i * 500,
                                            ease: 'out(2)',
                                            autoplay: true,
                                        })
                                    })
                                }
                            }}
                        />
                    </div>
                </foreignObject>

                <!-- Stats panel alongside modal - thin skyscraper -->
                {#if showStats && evidenceMeta}
                    {@const skyscraperWidth = Math.min(100, width * 0.08)}
                    {@const skyscraperHeight = height / 2}
                    {@const skyscraperX = cardX + cardWidth + 12}
                    {@const skyscraperY = cardY + cardHeight / 2 - skyscraperHeight / 2}

                    <foreignObject
                        x={skyscraperX}
                        y={skyscraperY}
                        width={skyscraperWidth}
                        height={skyscraperHeight}
                        style="pointer-events: auto"
                    >
                        <div class="stats-panel" onclick={(e) => e.stopPropagation()}>
                            {#if evidenceMeta.supports > 0}
                                <div class="stat-item supports">
                                    <span class="stat-value">{evidenceMeta.supports}</span>
                                    <span class="stat-label">✓</span>
                                </div>
                            {/if}
                            {#if evidenceMeta.refutes > 0}
                                <div class="stat-item refutes">
                                    <span class="stat-value">{evidenceMeta.refutes}</span>
                                    <span class="stat-label">✗</span>
                                </div>
                            {/if}
                            {#if evidenceMeta.neutral > 0}
                                <div class="stat-item neutral">
                                    <span class="stat-value">{evidenceMeta.neutral}</span>
                                    <span class="stat-label">○</span>
                                </div>
                            {/if}
                            <div class="stat-item">
                                <span class="stat-value">{focusedBet.currentConfidence}%</span>
                                <span class="stat-label">Conf</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-value"
                                    >{drydock.evidenceFor(focusedBet.id).length}</span
                                >
                                <span class="stat-label">Total</span>
                            </div>
                        </div>
                    </foreignObject>
                {/if}
            {/if}
        {/if}
    </svg>
</div>

<style>
    .pipeline-container {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--bg-secondary);
    }

    .pipeline-canvas {
        display: block;
    }

    .stream-group {
        cursor: pointer;
    }

    .delete-btn-wrapper {
        cursor: pointer;
    }

    .delete-btn:hover {
        r: 12;
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

    .stats-panel {
        background: transparent;
        border: none;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        box-sizing: border-box;
    }

    .stats-header {
        display: flex;
        justify-content: center;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border);
    }

    .close-stats {
        background: none;
        border: none;
        color: var(--text-tertiary);
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    }

    .close-stats:hover {
        color: var(--text-primary);
    }

    .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 10px 6px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
    }

    .stat-item .stat-value {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--text-primary);
    }

    .stat-item.supports .stat-value {
        color: var(--success);
    }

    .stat-item.refutes .stat-value {
        color: var(--error);
    }

    .stat-item.neutral .stat-value {
        color: var(--text-tertiary);
    }

    .stat-item .stat-label {
        font-size: 9px;
        color: var(--text-tertiary);
        text-align: center;
        line-height: 1;
    }

    [data-backdrop-id] {
        animation: fadeIn 0.3s ease-out;
    }

    [data-modal-id] {
        animation: slideIn 0.3s ease-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 0.7;
        }
    }

    @keyframes slideIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .stream-path {
        transition:
            opacity 0.6s ease,
            stroke-width 0.6s ease;
    }

    .stream-group text {
        transition: opacity 0.6s ease;
    }

    .legend .info-button {
        cursor: pointer;
        transition: fill 0.2s ease;
    }

    .legend:hover .info-button {
        fill: var(--bg-elevated);
    }

    .legend:hover .info-icon {
        fill: var(--accent-primary);
    }

    .legend .legend-popup {
        pointer-events: none;
        transition: opacity 0.3s ease;
    }

    .legend:hover .legend-popup {
        opacity: 1;
    }

    /* Arc-complete notification panel */
    .arc-panel {
        position: absolute;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 10;
        min-width: 380px;
        max-width: 560px;
        pointer-events: auto;
    }

    .arc-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 14px;
        background: var(--bg-elevated);
        border: 1px solid var(--accent-primary);
        border-radius: var(--radius-md);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    .arc-item-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    .arc-item-codename {
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .arc-item-detail {
        font-size: 11px;
        color: var(--text-tertiary);
    }

    .arc-confirm-btn {
        padding: 6px 14px;
        background: var(--accent-primary);
        border: none;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 600;
        color: white;
        cursor: pointer;
        white-space: nowrap;
        transition: var(--transition);
        flex-shrink: 0;
    }

    .arc-confirm-btn:hover {
        opacity: 0.85;
    }

    /* Arc ring pulse on stream endpoint */
    .arc-ring {
        animation: arc-pulse 2.4s ease-in-out infinite;
    }

    @keyframes arc-pulse {
        0%,
        100% {
            opacity: 0.7;
        }
        50% {
            opacity: 0.15;
        }
    }
</style>
