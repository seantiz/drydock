<!-- Child contact component -->
<script lang="ts">
    import type { Blip } from 'schema'
    import { animator } from 'services'

    interface Props {
        blip: Blip
        x: number
        y: number
        centerX: number
        centerY: number
        expanded: boolean
        onexpand: () => void
        oncollapse: () => void
        todayMode?: boolean
    }

    let {
        blip,
        x,
        y,
        centerX,
        centerY,
        expanded,
        onexpand,
        oncollapse,
        todayMode = false,
    }: Props = $props()

    let reactiveX = $derived(x)
    let reactiveY = $derived(y)
    let reactiveCenterX = $derived(centerX)
    let reactiveCenterY = $derived(centerY)

    // Source is the primary colour axis; today box provides temporal context visually
    let fillColor = $derived(blip.source === 'hackernews' ? '#f59e0b' : '#4ade80')

    const radius = $derived(Math.max(5, Math.min(blip.keywordMatches * 2, 14)))
    const circlePath = $derived(
        `M ${reactiveX + radius},${reactiveY} A ${radius},${radius} 0 1,0 ${reactiveX - radius},${reactiveY} A ${radius},${radius} 0 1,0 ${reactiveX + radius},${reactiveY}`
    )

    // Expanded state
    const cardWidth = 600
    const cardHeight = $derived(Math.min(reactiveCenterY * 2 * 0.8, 900))
    const cardX = $derived(reactiveCenterX - cardWidth / 2)
    const cardY = $derived(reactiveCenterY - cardHeight / 2)
    const cardRadius = 12
    const cardPath = $derived(`M ${cardX + cardRadius},${cardY}
        L ${cardX + cardWidth - cardRadius},${cardY}
        Q ${cardX + cardWidth},${cardY} ${cardX + cardWidth},${cardY + cardRadius}
        L ${cardX + cardWidth},${cardY + cardHeight - cardRadius}
        Q ${cardX + cardWidth},${cardY + cardHeight} ${cardX + cardWidth - cardRadius},${cardY + cardHeight}
        L ${cardX + cardRadius},${cardY + cardHeight}
        Q ${cardX},${cardY + cardHeight} ${cardX},${cardY + cardHeight - cardRadius}
        L ${cardX},${cardY + cardRadius}
        Q ${cardX},${cardY} ${cardX + cardRadius},${cardY} Z`)

    function handleClick() {
        if (expanded) return

        animator.animate(`[data-signal-id="${blip.id}"]`, {
            d: animator.morphTo(`[data-target-id="${blip.id}"]`),
            fill: [fillColor, 'var(--bg-elevated)'],
            duration: 400,
            ease: 'out(3)',
            autoplay: true,
            onComplete: () => {
                onexpand()
            },
        })
    }

    export function close() {
        if (!expanded) return

        animator.animate(`[data-backdrop-id="${blip.id}"]`, {
            opacity: [0.7, 0],
            duration: 300,
            ease: 'inOut(2)',
            autoplay: true,
        })

        animator.animate(`[data-modal-id="${blip.id}"]`, {
            opacity: [1, 0],
            scale: [1, 0.95],
            duration: 300,
            ease: 'inOut(2)',
            autoplay: true,
        })

        animator.animate(`[data-signal-id="${blip.id}"]`, {
            d: animator.morphTo(`[data-circle-id="${blip.id}"]`),
            fill: ['var(--bg-elevated)', fillColor],
            duration: 300,
            ease: 'inOut(2)',
            autoplay: true,
            onComplete: () => {
                oncollapse()
            },
        })
    }
</script>

<!-- Hidden target path for morphTo -->
<path data-target-id={blip.id} d={cardPath} style="opacity: 0; pointer-events: none" />
<path data-circle-id={blip.id} d={circlePath} style="opacity: 0; pointer-events: none" />

<!-- Morphing path -->
<path
    data-signal-id={blip.id}
    d={circlePath}
    fill={fillColor}
    stroke="rgba(255,255,255,0.15)"
    stroke-width="1"
    opacity="0.9"
    style="cursor: pointer"
    onclick={handleClick}
>
    <title>
        {blip.source === 'hackernews' ? blip.author : `@${blip.author}`} ({blip.keywordMatches} matches):
        {blip.text.substring(0, 80)}...</title
    >
</path>
