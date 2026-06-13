<script lang="ts">
    import type { NetworkPost } from 'schema'
    import { Lighthouse } from 'icons'
    import { openUrl } from '@tauri-apps/plugin-opener'

    interface Author {
        handle: string
        source: NetworkPost['source']
        profileUrl: string
        score: number
        postCount: number
        strategy: 'Reply-first' | 'Mention' | 'Cold post'
    }

    interface Props {
        // biggest convo, authors and stream freshness derive from posts
        posts: NetworkPost[]
        // Affects only the .search element
        searchStrategy: string[]
        // UI streaming props
        loading: false | 'strategy' | 'trawling'
    }

    interface Oceanview {
        width: number
        height: number
        padding: Record<'top' | 'bottom' | 'left' | 'right', number>
    }

    let { posts, searchStrategy, loading }: Props = $props()

    let networkPost = $state<{
        as: NetworkPost | null
        xcoord: number
        ycoord: number
        select: (e: MouseEvent, post: NetworkPost) => void
        close: (e: MouseEvent) => void
    }>({
        as: null,
        xcoord: 0,
        ycoord: 0,
        select(e, post) {
            e.stopPropagation()
            this.as = this.as?.uri === post.uri ? null : post
            this.xcoord = e.offsetX
            this.ycoord = e.offsetY
        },
        close() {
            this.as = null
        },
    })

    let oceanView = $state<Oceanview>({
        width: 800,
        height: 500,
        padding: { top: 60, bottom: 160, left: 30, right: 100 },
    })

    let authors = $derived(combine(posts))
    let showPowerAuthors = $state(false)

    // The Lighthouse and stream elements figure out where they land relative to the ocean
    let lighthouseX = $derived(oceanView.width - oceanView.padding.right)
    // Centre the stream in the padded region so it stays above the authors box at the bottom
    let streamY = $derived(
        oceanView.padding.top +
            (oceanView.height - oceanView.padding.top - oceanView.padding.bottom) / 2
    )

    // Purely read by land() to figure out how much a network post should be padded along the x axis
    let cutoffTime = $derived(Date.now() - 14 * 86400000)

    // Normalised engagement score — branches on source so HN scores are
    // comparable to Bluesky on the same plot
    function engagementScore(post: NetworkPost): number {
        switch (post.source) {
            case 'hackernews':
                return (post.score ?? 0) * 2 + (post.descendants ?? 0) * 1.5
            default: // bluesky
                return (
                    (post.reposts ?? 0) * 2 +
                    (post.quoted ?? 0) * 2 +
                    (post.replies ?? 0) * 1.5 +
                    (post.likes ?? 0)
                )
        }
    }

    // Per-source engagement ceiling so HN and Bluesky don't flatten each other —
    // each platform fills the full radius range independently
    let biggestConvo = $derived(() => {
        const map = new Map<NetworkPost['source'], number>()
        for (const post of posts) {
            const s = engagementScore(post)
            if (s > (map.get(post.source) ?? 0)) map.set(post.source, s)
        }
        return map
    })

    function profileUrl(source: NetworkPost['source'], handle: string): string {
        if (source === 'hackernews') return `https://news.ycombinator.com/user?id=${handle}`
        return `https://bsky.app/profile/${handle}`
    }

    function combine(networkPosts: NetworkPost[]): Author[] {
        // Pass 1: per-source ceiling so authors from different platforms rank fairly
        const sourceCeiling = new Map<NetworkPost['source'], number>()
        for (const post of networkPosts) {
            const s = engagementScore(post)
            if (s > (sourceCeiling.get(post.source) ?? 0)) sourceCeiling.set(post.source, s)
        }

        // Pass 2: accumulate log-normalised scores (0–1 per post) per author.
        // Log-compression mirrors whatsMyWeight so author ranking matches visual weight.
        const map = new Map<
            string,
            { source: NetworkPost['source']; score: number; count: number }
        >()
        for (const post of networkPosts) {
            const ceiling = sourceCeiling.get(post.source) || 1
            const score = Math.log1p(engagementScore(post)) / Math.log1p(ceiling)
            const existing = map.get(post.author_handle)
            if (existing) {
                existing.score += score
                existing.count++
            } else {
                map.set(post.author_handle, { source: post.source, score, count: 1 })
            }
        }
        return [...map.entries()]
            .sort((a, b) => b[1].score - a[1].score)
            .map(([handle, data], idx) => ({
                handle,
                source: data.source,
                profileUrl: profileUrl(data.source, handle),
                score: Math.round(data.score),
                postCount: data.count,
                strategy: (idx === 0
                    ? 'Reply-first'
                    : idx === 1
                      ? 'Mention'
                      : 'Cold post') as Author['strategy'],
            }))
    }

    // Plot a post on the stream
    function land(createdAt: string): number {
        const t = new Date(createdAt).getTime()
        const ratio = (t - cutoffTime) / (Date.now() - cutoffTime)
        return oceanView.padding.left + ratio * (lighthouseX - oceanView.padding.left)
    }

    // Returns a range between 4 to 16 pixels.
    // Log-compressed so power-law outliers don't collapse all other posts to minimum size.
    function whatsMyWeight(post: NetworkPost): number {
        const ceiling = biggestConvo().get(post.source) || 1
        return 4 + (Math.log1p(engagementScore(post)) / Math.log1p(ceiling)) * 12
    }

    // Just a formatter
    function niceNumbers(n: number): string {
        if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
        return String(n)
    }

    function daysSincePost(createdAt: string): number {
        return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
    }

    function postFreshness(createdAt: string): string {
        const d = daysSincePost(createdAt)
        if (d < 7) return 'var(--stream-fresh)'
        if (d < 14) return 'var(--stream-recent)'
        if (d < 30) return 'var(--stream-moderate)'
        if (d < 60) return 'var(--stream-aging)'
        return 'var(--stream-stale)'
    }

    function streamFreshness(): string {
        if (posts.length === 0) return 'var(--stream-stale)'

        const mostRecentDays = Math.min(...posts.map((p) => daysSincePost(p.created_at)))
        if (mostRecentDays < 7) return 'var(--stream-fresh)'
        if (mostRecentDays < 14) return 'var(--stream-recent)'
        if (mostRecentDays < 30) return 'var(--stream-moderate)'
        if (mostRecentDays < 60) return 'var(--stream-aging)'
        return 'var(--stream-stale)'
    }

    // Adds some jitter to post nodes to move slightly above or below stream
    function dontStackY(uri: string): number {
        let hash = 0
        for (let i = 0; i < uri.length; i++) {
            hash = (hash << 5) - hash + uri.charCodeAt(i)
            hash |= 0
        }
        return ((hash % 40) / 40) * 30 - 15
    }
</script>

<div class="oceanview">
    {#if loading}
        <div class="state">
            <div class="spinner"></div>
            <p>
                {loading === 'trawling'
                    ? 'Trawling social media for talk related to your draft...'
                    : 'Coming up with a search strategy for you...'}
            </p>
        </div>
    {:else}
        {#if searchStrategy.length > 0}
            <div class="search">
                {#each searchStrategy as term}
                    <span>{term}</span>
                {/each}
            </div>
        {/if}
        <svg
            width={oceanView.width}
            height={oceanView.height}
            onclick={(e) => {
                e.stopPropagation()
                networkPost.close(e)
            }}>
            <!-- Stream line -->
            <line
                x1={oceanView.padding.left}
                y1={streamY}
                x2={lighthouseX}
                y2={streamY}
                stroke={streamFreshness()}
                stroke-width="3"
                stroke-linecap="round"
                opacity="0.6" />

            <!-- Cutoff label -->
            <text
                x={oceanView.padding.left}
                y={streamY - 20}
                text-anchor="middle"
                fill="var(--text-tertiary)"
                font-size="10px"
                >{new Date(cutoffTime).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                })}</text>
            <line
                x1={oceanView.padding.left}
                y1={streamY - 14}
                x2={oceanView.padding.left}
                y2={streamY + 14}
                stroke="var(--border)"
                stroke-width="1"
                stroke-dasharray="3,3" />

            <!-- Now label that sits to the right of the lighthouse, outside the post-node area -->
            <text
                x={lighthouseX + 40}
                y={streamY - 20}
                text-anchor="start"
                fill="var(--text-tertiary)"
                font-size="10px">Now</text>

            {#if posts.length === 0}
                <text
                    x={oceanView.width / 2}
                    y={oceanView.height / 2}
                    text-anchor="middle"
                    fill="var(--text-tertiary)"
                    font-size="14px"
                    >We did not find any recent chat related to your draft post.</text>
            {:else}
                <!-- Post nodes -->
                {#each posts as post (post.uri)}
                    {@const px = land(post.created_at)}
                    {@const py = streamY + dontStackY(post.uri)}
                    {@const r = whatsMyWeight(post)}
                    <circle
                        cx={px}
                        cy={py}
                        {r}
                        fill={postFreshness(post.created_at)}
                        stroke={networkPost.as?.uri === post.uri
                            ? 'var(--text-primary)'
                            : 'var(--bg-primary)'}
                        stroke-width={networkPost.as?.uri === post.uri ? 2 : 1}
                        opacity={networkPost.as && networkPost.as.uri !== post.uri ? 0.3 : 0.85}
                        class="post-node"
                        onclick={(e) => networkPost.select(e, post)}
                        role="button"
                        tabindex="0" />
                {/each}
            {/if}

            <!-- Lighthouse at right -->
            <g transform="translate({lighthouseX + 20}, {streamY - 30})" opacity="0.8">
                <Lighthouse
                    color={posts.length > 0 ? 'var(--lighthouse-active)' : 'var(--lighthouse-idle)'}
                    scale={0.5}
                    showLabel={false} />
            </g>
        </svg>

        {#if networkPost.as}
            <div
                class="networkpost"
                style="left: {networkPost.xcoord + 16}px; top: {networkPost.ycoord - 8}px"
                onclick={(e) => e.stopPropagation()}>
                <p class="handle">@{networkPost.as.author_handle}</p>
                <p class="text">
                    {networkPost.as.text.slice(0, 120)}{networkPost.as.text.length > 120 ? '…' : ''}
                </p>
                <div class="engagement">
                    {#if networkPost.as.source === 'hackernews'}
                        <span title="Score">▲ {niceNumbers(networkPost.as.score ?? 0)}</span>
                        <span title="Comments"
                            >↩ {niceNumbers(networkPost.as.descendants ?? 0)}</span>
                    {:else}
                        <span title="Replies">↩ {niceNumbers(networkPost.as.replies ?? 0)}</span>
                        <span title="Reposts">↺ {niceNumbers(networkPost.as.reposts ?? 0)}</span>
                        <span title="Likes">♡ {niceNumbers(networkPost.as.likes ?? 0)}</span>
                        <span title="Quotes">" {niceNumbers(networkPost.as.quoted ?? 0)}</span>
                    {/if}
                </div>
                <button onclick={() => openUrl(networkPost.as!.post_url)}>Open post ↗</button>
            </div>
        {/if}

        <!-- Top authors box -->
        {#if authors.length > 0}
            <div class="authors" class:authors--expanded={showPowerAuthors}>
                <button
                    class="authors-toggle"
                    onclick={() => (showPowerAuthors = !showPowerAuthors)}>
                    {showPowerAuthors ? 'Close' : `High-ranking authors`}
                </button>
                {#if showPowerAuthors}
                    <ul>
                        {#each authors.slice(0, 5) as author, i}
                            <li
                                class:highlighted={i < 2}
                                onclick={() => openUrl(author.profileUrl)}
                                role="button"
                                tabindex="0"
                                onkeydown={(e) => e.key === 'Enter' && openUrl(author.profileUrl)}
                                title="Open {author.source} profile">
                                <div class="info">
                                    <span class="handle">@{author.handle}</span>
                                    <span class="meta">
                                        {author.postCount} post{author.postCount !== 1 ? 's' : ''} · {author.score}
                                        reach
                                    </span>
                                </div>
                                {#if i < 2}
                                    <span class="strategy">{author.strategy}</span>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        {/if}
    {/if}
</div>

<style>
    .oceanview {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 400px;
        background: var(--bg-primary);
        overflow: hidden;
    }

    .oceanview svg {
        display: block;
    }

    .oceanview .search {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px;
    }

    .oceanview .search span {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--bg-tertiary);
        color: var(--text-tertiary);
        border: 1px solid var(--border);
    }

    .oceanview .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 16px;
        color: var(--text-tertiary);
    }

    .oceanview .state p {
        font-size: 14px;
        margin: 0;
    }

    .oceanview .state .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid var(--bg-tertiary);
        border-top-color: var(--accent-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .oceanview .post-node {
        cursor: pointer;
        transition:
            opacity 0.2s ease,
            r 0.2s ease;
    }

    .oceanview .networkpost {
        position: absolute;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: 10px 12px;
        max-width: 260px;
        z-index: 100;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }

    .oceanview .networkpost .handle {
        margin: 0 0 4px;
        font-size: 12px;
        font-weight: 700;
        color: var(--accent-primary);
    }

    .oceanview .networkpost .text {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .oceanview .networkpost .engagement {
        display: flex;
        gap: 10px;
        font-size: 11px;
        color: var(--text-tertiary);
        margin-bottom: 8px;
    }

    .oceanview .networkpost button {
        font-size: 11px;
        color: var(--accent-primary);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-decoration: none;
    }

    .oceanview .networkpost button:hover {
        text-decoration: underline;
    }

    .oceanview .authors {
        position: absolute;
        bottom: 16px;
        left: 16px;
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        min-width: 160px;
        max-width: 280px;
    }

    .oceanview .authors-toggle {
        display: block;
        width: 100%;
        background: none;
        border: none;
        padding: 7px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-tertiary);
        cursor: pointer;
        text-align: left;
        letter-spacing: 0.04em;
    }

    .oceanview .authors-toggle:hover {
        color: var(--text-primary);
    }

    .oceanview .authors--expanded .authors-toggle {
        border-bottom: 1px solid var(--border);
        margin-bottom: 4px;
    }

    .oceanview .authors ul {
        list-style: none;
        margin: 0;
        padding: 0 14px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .oceanview .authors li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: var(--radius-sm);
        cursor: pointer;
    }

    .oceanview .authors li:hover {
        background: var(--bg-elevated);
    }

    .oceanview .authors li.highlighted {
        background: var(--bg-tertiary);
    }

    .oceanview .authors li.highlighted:hover {
        background: var(--bg-elevated);
    }

    .oceanview .authors .info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        flex: 1;
        min-width: 0;
    }

    .oceanview .authors .info .handle {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .oceanview .authors .info .meta {
        font-size: 10px;
        color: var(--text-tertiary);
    }

    .oceanview .authors .strategy {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 8px;
        background: var(--accent-tertiary);
        color: white;
        flex-shrink: 0;
        white-space: nowrap;
    }
</style>
