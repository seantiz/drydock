<script lang="ts">
    import { animator } from 'services'

    interface Props {
        polling: Record<string, boolean>
        x: number
        y: number
        onclick: () => void
    }

    let { polling, x, y, onclick }: Props = $props()
    let pingRings = $state<number[]>([])
    let ringIdCounter = $state(0)

    const sweepButtonColour = $derived(
        polling.active || polling.windingDown ? 'var(--ping-active)' : 'var(--ping-idle)'
    )

    function triggerPing() {
        onclick()

        // Create 3 ping rings
        const newRings = [ringIdCounter, ringIdCounter + 1, ringIdCounter + 2]
        pingRings = [...pingRings, ...newRings]
        ringIdCounter += 3

        // Animate each ring
        newRings.forEach((id, i) => {
            setTimeout(() => {
                animator.animate(`.ping-ring-${id}`, {
                    r: [0, 60],
                    opacity: [0.8, 0],
                    duration: 1500,
                    ease: 'out(2)',
                    autoplay: true,
                    onComplete: () => {
                        pingRings = pingRings.filter((ringId) => ringId !== id)
                    },
                })
            }, i * 200)
        })
    }
</script>

<g transform="translate({x}, {y})">
    <!-- Ping rings -->
    {#each pingRings as ringId (ringId)}
        <circle
            class="ping-ring-{ringId}"
            cx="0"
            cy="0"
            r="0"
            fill="none"
            stroke="var(--ping-ring)"
            stroke-width="2"
            opacity="0"
        />
    {/each}

    <g style="cursor: pointer" onclick={triggerPing}>
        <!-- Circular button background for SWEEP button -->
        <circle
            cx="0"
            cy="0"
            r="28"
            fill={sweepButtonColour}
            opacity="0.9"
            style="transition: fill 0.5s"
        />
        <!-- Radar dish -->
        <g transform="translate(0, -4)">
            <!-- Antenna beam (glowing when polling) -->
            {#if polling}
                <line
                    x1="0"
                    y1="-8"
                    x2="0"
                    y2="-18"
                    stroke="var(--radar-sweep)"
                    stroke-width="3"
                    opacity="0.8"
                />
            {/if}
        </g>

        <!-- Label -->
        <text
            x="0"
            y="10"
            text-anchor="middle"
            fill="var(--text-primary)"
            font-size="10px"
            font-weight="600"
            style="pointer-events: none"
        >
            SWEEP
        </text>
    </g>
</g>

<style>
    .polling {
        animation: radar-spin 2s linear infinite;
    }

    @keyframes radar-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
