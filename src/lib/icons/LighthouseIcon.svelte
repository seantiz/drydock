<script lang="ts">
    interface Props {
        color: string
        scale?: number
        showLabel?: boolean
        label?: string
        showDeleteBtn?: boolean
        onDelete?: (e: Event) => void
    }

    let {
        color,
        scale = 0.3,
        showLabel = false,
        label = '',
        showDeleteBtn = false,
        onDelete,
    }: Props = $props()
</script>

<!-- Origin is the beacon finial tip; tower extends downward from there -->
<g class="lighthouse-icon" transform="scale({scale})">

    <!-- Ambient ground shadow -->
    <ellipse cx="0" cy="198" rx="26" ry="6" fill={color} opacity="0.12" />

    <!-- Tower body — oblique foreshortened cylinder -->
    <!-- Shadow side (right sliver) -->
    <path d="M 14,68 L 22,188 L 18,188 Z" fill={color} opacity="0.22" />
    <!-- Main face -->
    <path d="M -14,68 L -22,188 L 22,188 L 14,68 Z" fill={color} opacity="0.55" />
    <!-- Specular stripe left edge -->
    <path d="M -16,74 L -18,182 L -13,182 L -11,74 Z" fill="white" opacity="0.07" />
    <!-- Tower top cap (foreshortened ellipse) -->
    <ellipse cx="0" cy="68" rx="14" ry="5.5" fill={color} opacity="0.9" />

    <!-- Gallery platform — wider than tower, like buoy underside + top -->
    <ellipse cx="0" cy="63" rx="28" ry="9" fill={color} opacity="0.7" />
    <ellipse cx="0" cy="70" rx="26" ry="7.5" fill={color} opacity="0.28" />

    <!-- Lantern room — glass walls with bg-tertiary fill + colour tint -->
    <path d="M -12,63 L -10,25 L 10,25 L 12,63 Z" fill="var(--bg-tertiary)" opacity="0.72" />
    <path d="M -12,63 L -10,25 L 10,25 L 12,63 Z" fill={color} opacity="0.16" />
    <!-- Lantern room top cap -->
    <ellipse cx="0" cy="25" rx="11" ry="4" fill={color} opacity="0.85" />

    <!-- Dome peak finial -->
    <line
        x1="0"
        y1="25"
        x2="0"
        y2="4"
        stroke={color}
        stroke-width="2.5"
        stroke-linecap="round"
        opacity="0.75"
    />
    <circle cx="0" cy="4" r="3.5" fill={color} opacity="0.9" />

    <!-- Beacon halo — pulsing glow behind glass -->
    <circle cx="0" cy="44" r="22" fill={color} class="beacon-halo" />
    <!-- Beacon core — always visible -->
    <circle cx="0" cy="44" r="6" fill={color} opacity="0.9" />

    {#if showLabel && label}
        <text
            x="-30"
            y="68"
            text-anchor="end"
            fill="var(--text-secondary)"
            font-size="32px"
            font-weight="600"
            dy="4"
        >
            {label}
        </text>
    {/if}

    {#if showDeleteBtn && onDelete}
        <g class="delete-btn" transform="translate(32, 68)" onclick={onDelete}>
            <circle r="16" fill="#ef4444" />
            <text text-anchor="middle" dy="5" fill="#fff" font-size="20px" font-weight="bold">
                ×
            </text>
        </g>
    {/if}
</g>

<style>
    .beacon-halo {
        opacity: 0.45;
        animation: beacon-pulse 2.8s ease-in-out infinite;
    }

    @keyframes beacon-pulse {
        0%,
        100% {
            opacity: 0.45;
        }
        50% {
            opacity: 0.06;
        }
    }

    .delete-btn {
        cursor: pointer;
    }

    .delete-btn:hover {
        transform: scale(1.15);
    }
</style>
