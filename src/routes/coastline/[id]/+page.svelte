<script lang="ts">
    import { goto } from '$app/navigation'
    import { page } from '$app/state'
    import { drydock } from 'services/drydock.svelte'
    import { animator } from 'services'
    import { Navbar, TiptapEditor } from 'components'
    import type { ConcernSourceMeta } from 'schema'
    import { invoke } from '@tauri-apps/api/core'
    import { onMount, onDestroy } from 'svelte'
    import { Repospace } from 'services/repospace.svelte'
    import type { SceneData } from 'services/repospace.svelte'

    let currentPage = $state(1)
    let viewMode = $state<'topic' | 'issue'>('topic')

    let rsCanvas: HTMLCanvasElement
    const rs = new Repospace()

    let topics = $state<{ id: number; label: string; issueIds: string[] }[] | null>(null)
    let clustering = $state(false)
    let clusterProblem = $state<string | null>(null)

    let planetInFocus = $state<{ centroid: Planet; memberIndex: number } | null>(null)
    let topicInFocus = $state<{ planet: TopicPlanet; memberIndex: number } | null>(null)
    let orphanInFocus = $state<{ index: number } | null>(null)

    let matching = $state(false)
    let matchResult = $state<{
        match: { issueNumber: string; issueTitle: string } | null
        candidates: { issueNumber: string; issueTitle: string }[]
    } | null>(null)

    let userPick = $state<string | null>(null)

    let coastlineId = $derived(page.params.id)
    let coastline = $derived(drydock.coastlines.find((c) => c.id === coastlineId))
    let sources = $derived(drydock.concernSources.filter((s) => s.coastlineId === coastlineId))

    let promoted = $state<string | null>(null)
    let tooltip = $state<{ text: string; x: number; y: number } | null>(null)
    let topicsHover = $state(false)

    // Issues as planets in the ui space
    let grab = $derived(sources.filter((s) => s.concernSource === 'issue'))

    let planets = $derived(
        (() => {
            const byCount = new Map<string, number>()
            for (const source of sources) {
                for (const number of source.refs ?? []) {
                    byCount.set(number, (byCount.get(number) ?? 0) + 1)
                }
            }
            return [...grab].sort((a, b) => {
                const ca = byCount.get(a.externalId!) ?? 0
                const cb = byCount.get(b.externalId!) ?? 0
                return cb - ca
            })
        })()
    )

    const PAGE_SIZE = 9

    let planetSpread = $derived(
        planets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    )

    let storybook = $derived(Math.max(1, Math.ceil(planets.length / PAGE_SIZE)))

    // Bets linked via promoted evidence
    let couldBeRelated = $derived(
        drydock.evidence
            .filter((evidence) => evidence.coastlineId === coastlineId)
            .map((evidence) => evidence.betId)
            .filter((id, i, arr) => arr.indexOf(id) === i)
            .map((id) => drydock.bets.find((bet) => bet.id === id))
            .filter(Boolean)
    )

    const SVG_W = 880
    const CELL = 200
    const C_R = 16
    const COLS = $derived(Math.max(1, Math.min(3, Math.ceil(Math.sqrt(planetSpread.length)))))
    const ORPHAN_COLS = 12
    const ORPHAN_CELL = 66
    const THRESHOLD = 0.75
    const OUTER_RING_RADIUS = 92
    const TOPIC_ORBIT_R = 75

    const ROWS = $derived(Math.ceil(planetSpread.length / COLS))
    // centering formula once more for svg graphics
    const GRID_W = $derived(COLS * CELL)
    const OFFSET_X = $derived((SVG_W - GRID_W) / 2)

    // Make sure the repo label and centroid map don't share the same z space
    const REPOSPACE_MARGIN = 40
    const OFFSET_Y = $derived(REPOSPACE_MARGIN)

    const GRID_H = $derived(Math.max(CELL, ROWS * CELL) + REPOSPACE_MARGIN)

    type Orbiting = {
        source: ConcernSourceMeta
        x: number
        y: number
        isLoose?: boolean
    }

    type Planet = {
        source: ConcernSourceMeta
        cx: number
        cy: number
        arc: 'complete' | 'partial' | 'none'
        strongly: Orbiting[]
        loosely: Orbiting[]
    }

    type Unrelated = {
        source: ConcernSourceMeta
        x: number
        y: number
    }

    type TopicPlanet = {
        clusterId: number
        label: string
        cx: number
        cy: number
        members: Orbiting[]
    }

    function orbit(source: string): number {
        if (source === 'pr') return 52
        if (source === 'discussion') return 42
        if (source === 'release') return 70
        return 50
    }

    async function getTopicBuckets() {
        if (topics !== null || clustering) return
        clustering = true
        try {
            const cached = await drydock.loadBuckets(coastlineId)
            if (cached && cached.length > 0) {
                topics = cached
                return
            }
            const raw = await invoke<{ id: number; label: string; issue_ids: string[] }[]>(
                'find_coastline_topics',
                { coastlineId }
            )
            const clusters = raw.map((c, i) => ({
                id: i,
                label: c.label,
                issueIds: c.issue_ids,
            }))
            topics = clusters
            await drydock.saveTopicClusters(coastlineId, clusters)
        } finally {
            clustering = false
        }
    }
    const topicLayout = $derived(
        (() => {
            if (!topics) return { planets: [] as TopicPlanet[], storybook: 1, canvasH: CELL }

            const issueById = new Map(planets.map((p) => [p.externalId, p]))

            const clusterList: TopicPlanet[] = topics.map((tc) => ({
                clusterId: tc.id,
                label: tc.label,
                cx: 0,
                cy: 0,
                members: tc.issueIds.flatMap((id) => {
                    const s = issueById.get(id)
                    return s ? [{ source: s, x: 0, y: 0 }] : []
                }),
            }))

            const n = clusterList.length
            const R = Math.max(160, (n * 140) / (2 * Math.PI))
            const canvasH = Math.round(R * 2 + 200)
            const cx = SVG_W / 2
            const cy = canvasH / 2 + 80

            clusterList.forEach((tc, i) => {
                const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2
                tc.cx = cx + R * Math.cos(angle)
                tc.cy = cy + R * Math.sin(angle)
                tc.members.forEach((m, j) => {
                    const memberAngle =
                        (j / Math.max(1, tc.members.length)) * 2 * Math.PI - Math.PI / 2
                    const jitter = tc.members.length > 12 ? Math.sin(j * 2.399) * 18 : 0
                    m.x = tc.cx + (TOPIC_ORBIT_R + jitter) * Math.cos(memberAngle)
                    m.y = tc.cy + (TOPIC_ORBIT_R + jitter) * Math.sin(memberAngle)
                })
            })

            return { planets: clusterList, storybook: 1, canvasH }
        })()
    )

    let topicBreakdown = $derived(
        topics && planets.length > 0
            ? topics
                  .map((tc) => ({
                      label: tc.label,
                      pct: Math.round((tc.issueIds.length / planets.length) * 100),
                  }))
                  .sort((a, b) => b.pct - a.pct)
            : []
    )

    let activeStorybook = $derived(viewMode === 'topic' ? topicLayout.storybook : storybook)

    const layout = $derived(
        (() => {
            // Step 1: Compute ALL centroids with their structural orbiters (global)
            const allPlanets: Planet[] = planets.map((c) => {
                const issueNum = c.externalId!
                const related = sources.filter(
                    (s) => s.concernSource !== 'issue' && s.refs?.includes(issueNum)
                )

                const hasMergedPr = related.some(
                    (s) => s.concernSource === 'pr' && s.state === 'merged'
                )
                const hasRelease = related.some((s) => s.concernSource === 'release')
                const hasPr = related.some((s) => s.concernSource === 'pr')
                const arc: 'complete' | 'partial' | 'none' =
                    hasMergedPr && hasRelease ? 'complete' : hasPr ? 'partial' : 'none'

                return {
                    source: c,
                    cx: 0,
                    cy: 0,
                    arc,
                    strongly: related.map((s) => ({ source: s, x: 0, y: 0 })),
                    loosely: [],
                }
            })

            // Step 2: Slice to current page, then compute positions
            const paged = allPlanets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
            const centroidIdSet = new Set(paged.map((p) => p.source.id))

            paged.forEach((pc, i) => {
                const col = i % COLS
                const row = Math.floor(i / COLS)
                pc.cx = col * CELL + CELL / 2 + OFFSET_X
                pc.cy = row * CELL + CELL / 2 + OFFSET_Y

                pc.strongly.forEach((o, j) => {
                    const angle = (j / Math.max(1, pc.strongly.length)) * 2 * Math.PI - Math.PI / 2
                    const r = orbit(o.source.concernSource)
                    o.x = pc.cx + r * Math.cos(angle)
                    o.y = pc.cy + r * Math.sin(angle)
                })
            })

            // Step 3: Fire weak orbiters async, mutate paged planets when done
            const structuralIds = new Set(
                paged.flatMap((pc) => pc.strongly.map((o) => o.source.id))
            )
            const planetIds = paged.map((p) => p.source.id)
            const weakIds = new Set<string>()

            invoke<Record<string, string>>('find_orbiters', {
                coastlineId,
                planetIds,
                threshold: THRESHOLD,
            }).then((result) => {
                for (const [sourceId, planetId] of Object.entries(result)) {
                    const pc = paged.find((p) => p.source.id === planetId)
                    const send = sources.find((s) => s.id === sourceId)
                    if (!pc || !send) continue
                    if (centroidIdSet.has(sourceId) || structuralIds.has(sourceId)) continue
                    const j = pc.loosely.length
                    const angle = j * 2.399963229728653
                    pc.loosely.push({
                        source: send,
                        x: pc.cx + OUTER_RING_RADIUS * Math.cos(angle),
                        y: pc.cy + OUTER_RING_RADIUS * Math.sin(angle),
                        isLoose: true,
                    })
                    weakIds.add(sourceId)
                }
            })

            // Step 4: True orphans — grouped by type
            const allStructuralIds = new Set(
                allPlanets.flatMap((pc) => pc.strongly.map((o) => o.source.id))
            )
            const trueOrphans = sources.filter((s) => {
                if (s.concernSource === 'issue') return false
                return !allStructuralIds.has(s.id) && !weakIds.has(s.id)
            })

            const groupedOrphans: Record<string, Unrelated[]> = {}
            for (const s of trueOrphans) {
                const type = s.concernSource
                if (!groupedOrphans[type]) groupedOrphans[type] = []
                const i = groupedOrphans[type].length
                const col = i % ORPHAN_COLS
                const row = Math.floor(i / ORPHAN_COLS)
                groupedOrphans[type].push({
                    source: s,
                    x: col * ORPHAN_CELL + ORPHAN_CELL / 2,
                    y: row * 48 + 20,
                })
            }

            return { planets: paged, orphanGroups: groupedOrphans }
        })()
    )
    let orphanGroupEntries = $derived(Object.entries(layout.orphanGroups))
    let totalOrphans = $derived(orphanGroupEntries.reduce((sum, [, arr]) => sum + arr.length, 0))

    let sceneData: SceneData = $derived(
        viewMode === 'topic'
            ? {
                  mode: 'topic',
                  name: coastline?.name ?? '',
                  width: SVG_W,
                  height: topicLayout.canvasH,
                  planets: topicLayout.planets.map((tc) => ({
                      clusterId: tc.clusterId,
                      label: tc.label,
                      cx: tc.cx,
                      cy: tc.cy,
                      members: tc.members.map((m) => ({
                          id: m.source.id,
                          x: m.x,
                          y: m.y,
                          state: m.source.state ?? '',
                          externalId: m.source.externalId ?? '',
                          title: m.source.title ?? '',
                      })),
                  })),
              }
            : {
                  mode: 'issue',
                  name: coastline?.name ?? '',
                  width: SVG_W,
                  height: GRID_H,
                  planets: layout.planets.map((pc) => ({
                      id: pc.source.id,
                      cx: pc.cx,
                      cy: pc.cy,
                      arc: pc.arc,
                      state: pc.source.state ?? '',
                      externalId: pc.source.externalId ?? '',
                      title: pc.source.title ?? '',
                      strongly: pc.strongly.map((o) => ({
                          id: o.source.id,
                          x: o.x,
                          y: o.y,
                          source: o.source.concernSource,
                          title: `${o.source.concernSource} #${o.source.externalId}: ${o.source.title ?? ''}`,
                      })),
                      loosely: pc.loosely.map((w) => ({
                          id: w.source.id,
                          x: w.x,
                          y: w.y,
                          source: w.source.concernSource,
                          title: `~${w.source.concernSource} #${w.source.externalId}: ${w.source.title ?? ''}`,
                          isLoose: true,
                      })),
                  })),
              }
    )

    let repospace = $derived(rs.ready ? (rs.renderScene(sceneData), rs) : null)

    onMount(async () => {
        rs.onTooltip = (text, x, y) => {
            tooltip = { text, x, y }
        }
        rs.onClearTooltip = () => {
            tooltip = null
        }
        rs.onClickPlanet = (id) => {
            const pc = layout.planets.find((p) => p.source.id === id)
            if (pc) clickPlanet(pc)
        }
        rs.onClickPlanetoid = (id, idx) => {
            const pc = layout.planets.find((p) => p.source.id === id)
            if (pc) clickPlanetoid(pc, idx)
        }
        rs.onClickDrifter = (id, idx) => {
            const pc = layout.planets.find((p) => p.source.id === id)
            if (pc) clickDrifter(pc, idx)
        }
        rs.onClickTopicPlanet = (clusterId) => {
            const tc = topicLayout.planets.find((p) => p.clusterId === clusterId)
            if (tc) clickTopicPlanet(tc)
        }
        rs.onClickTopicMember = (clusterId, idx) => {
            const tc = topicLayout.planets.find((p) => p.clusterId === clusterId)
            if (tc) clickTopicMember(tc, idx)
        }
        rs.onClickBackground = () => {
            if (detailPanel) closePanel()
        }
        await rs.init(rsCanvas, SVG_W, GRID_H)
        getTopicBuckets()
    })

    onDestroy(() => rs.destroy())

    let orphanMode = $state(false)
    let orphanTab = $state('pr')

    function enterOrphanMode() {
        orphanMode = true
        planetInFocus = null
        orphanInFocus = null
        matchResult = null
        userPick = null
        if (orphanGroupEntries.length > 0) {
            orphanTab = orphanGroupEntries[0][0]
        }
    }

    function exitOrphanMode() {
        orphanMode = false
        repospace?.resetView()
        orphanInFocus = null
        matchResult = null
        userPick = null
    }

    function selectOrphanTab(type: string) {
        orphanTab = type
        orphanInFocus = null
        matchResult = null
        userPick = null
    }

    function getOrphanFlatIndex(type: string, orphanID: number): number {
        let flatIndex = 0
        for (const [t, items] of orphanGroupEntries) {
            if (t === type) return flatIndex + orphanID
            flatIndex += items.length
        }
        return 0
    }

    async function findMatch() {
        if (!panelSource) return
        matching = true
        try {
            matchResult = await drydock.matchOrphanToIssue(panelSource.id)
        } finally {
            matching = false
        }
    }

    async function confirmMatch() {
        if (!panelSource || !matchResult) return
        const num = userPick || matchResult.match?.issueNumber
        if (!num) return
        await drydock.confirmOrphanMatch(panelSource.id, num)
        matchResult = null
        userPick = null
        orphanInFocus = null
    }

    function dismissMatch() {
        matchResult = null
        userPick = null
    }

    let inOrbit = $derived(
        planetInFocus
            ? [
                  planetInFocus.centroid.source,
                  ...planetInFocus.centroid.strongly.map((o) => o.source),
                  ...planetInFocus.centroid.loosely.map((o) => o.source),
              ]
            : []
    )

    let flatOrphans = $derived(orphanGroupEntries.flatMap(([, items]) => items))

    let panelSource = $derived(
        topicInFocus
            ? (topicInFocus.planet.members[topicInFocus.memberIndex]?.source ?? null)
            : planetInFocus
              ? (inOrbit[planetInFocus.memberIndex] ?? null)
              : orphanInFocus
                ? (flatOrphans[orphanInFocus.index]?.source ?? null)
                : null
    )

    let detailPanel = $derived(planetInFocus !== null || topicInFocus !== null)

    let panelTotal = $derived(
        topicInFocus
            ? topicInFocus.planet.members.length
            : planetInFocus
              ? inOrbit.length
              : flatOrphans.length
    )

    let panelIndex = $derived(
        topicInFocus
            ? topicInFocus.memberIndex
            : planetInFocus
              ? planetInFocus.memberIndex
              : (orphanInFocus?.index ?? 0)
    )

    function clickPlanet(pc: Planet) {
        repospace?.setViewBox(pc.cx, pc.cy, pc.source.id, true)
        planetInFocus = { centroid: pc, memberIndex: 0 }
        orphanInFocus = null
        rs.highlightOrbiter(pc.source.id, 0)
    }

    function clickPlanetoid(pc: Planet, idx: number) {
        repospace?.setViewBox(pc.cx, pc.cy, pc.source.id, true)
        planetInFocus = { centroid: pc, memberIndex: idx + 1 }
        orphanInFocus = null
        rs.highlightOrbiter(pc.source.id, idx + 1)
    }

    function clickDrifter(pc: Planet, idx: number) {
        repospace?.setViewBox(pc.cx, pc.cy, pc.source.id, true)
        const memberIndex = pc.strongly.length + idx + 1
        planetInFocus = { centroid: pc, memberIndex }
        orphanInFocus = null
        rs.highlightOrbiter(pc.source.id, memberIndex)
    }

    function clickOrphans(type: string, orphanID: number) {
        // Find the flat index by counting through groups
        let flatIndex = 0
        for (const [t, items] of orphanGroupEntries) {
            if (t === type) {
                orphanInFocus = { index: flatIndex + orphanID }
                break
            }
            flatIndex += items.length
        }
        planetInFocus = null
        matchResult = null
    }

    function goToPrev() {
        if (topicInFocus) {
            const memberIndex = Math.max(0, topicInFocus.memberIndex - 1)
            topicInFocus = { ...topicInFocus, memberIndex }
            rs.highlightOrbiter(topicInFocus.planet.clusterId, memberIndex)
        } else if (planetInFocus) {
            const memberIndex = Math.max(0, planetInFocus.memberIndex - 1)
            planetInFocus = { ...planetInFocus, memberIndex }
            rs.highlightOrbiter(planetInFocus.centroid.source.id, memberIndex)
        } else if (orphanInFocus) {
            orphanInFocus = { index: Math.max(0, orphanInFocus.index - 1) }
        }
    }

    function goToNext() {
        if (topicInFocus) {
            const memberIndex = Math.min(panelTotal - 1, topicInFocus.memberIndex + 1)
            topicInFocus = { ...topicInFocus, memberIndex }
            rs.highlightOrbiter(topicInFocus.planet.clusterId, memberIndex)
        } else if (planetInFocus) {
            const memberIndex = Math.min(panelTotal - 1, planetInFocus.memberIndex + 1)
            planetInFocus = { ...planetInFocus, memberIndex }
            rs.highlightOrbiter(planetInFocus.centroid.source.id, memberIndex)
        } else if (orphanInFocus) {
            orphanInFocus = { index: Math.min(flatOrphans.length - 1, orphanInFocus.index + 1) }
        }
    }

    function closePanel() {
        repospace?.resetView()
        rs.highlightOrbiter(null, 0)
        animator.animate('.detail-panel-inner', {
            translateX: ['0%', '100%'],
            duration: 260,
            ease: 'in(2)',
            autoplay: true,
            complete: () => {
                planetInFocus = null
                topicInFocus = null
                orphanInFocus = null
                matchResult = null
                userPick = null
            },
        })
    }

    function clickTopicPlanet(tc: TopicPlanet) {
        repospace?.setViewBox(tc.cx, tc.cy, `topic-${tc.clusterId}`, true)
        topicInFocus = { planet: tc, memberIndex: 0 }
        rs.highlightOrbiter(tc.clusterId, 0)
    }

    function clickTopicMember(tc: TopicPlanet, idx: number) {
        repospace?.setViewBox(tc.cx, tc.cy, `topic-${tc.clusterId}`, true)
        topicInFocus = { planet: tc, memberIndex: idx }
        rs.highlightOrbiter(tc.clusterId, idx)
    }

    function switchMode(mode: 'topic' | 'issue') {
        viewMode = mode
        currentPage = 1
        planetInFocus = null
        topicInFocus = null
        matchResult = null
        userPick = null
        repospace?.resetView()
        if (mode === 'topic') getTopicBuckets()
    }

    async function promote() {
        if (!panelSource || !promoted) return
        await drydock.promoteToEvidence(panelSource.id, promoted)
    }

    function colour(s: ConcernSourceMeta): string {
        if (s.concernSource === 'pr') {
            if (s.state === 'merged') return '#8b5cf6'
            if (s.state === 'open') return '#3b82f6'
            return '#64748b'
        }
        if (s.concernSource === 'release') return '#10b981'
        if (s.concernSource === 'discussion') return '#f59e0b'
        return '#94a3b8'
    }

    function withBadge(s: ConcernSourceMeta): string {
        if (s.concernSource === 'pr') {
            return s.state === 'merged' ? 'PR merged' : s.state === 'open' ? 'PR open' : 'PR closed'
        }
        return s.concernSource
    }

    function showDetails(s: ConcernSourceMeta): string {
        const fp = s.footprint
        if (!fp) return ''
        const parts: string[] = []
        const reactionIcons: Record<string, string> = {
            '+1': '👍',
            '-1': '👎',
            laugh: '😄',
            hooray: '🎉',
            heart: '❤️',
            rocket: '🚀',
            eyes: '👀',
        }
        if (s.concernSource === 'pr') {
            const r = fp.reactions as Record<string, number> | undefined
            if (r) {
                for (const [k, v] of Object.entries(r)) {
                    if (v > 0) parts.push(`${reactionIcons[k] ?? k} ${v}`)
                }
            }
            if (fp.comment_count) parts.push(`💬 ${fp.comment_count}`)
            if (fp.review_count) parts.push(`${fp.review_count} reviews`)
            if (fp.additions != null) parts.push(`+${fp.additions} −${fp.deletions}`)
            if (fp.changed_files) parts.push(`${fp.changed_files} files`)
        } else if (s.concernSource === 'release') {
            if (fp.prerelease) parts.push('RC')
            if (fp.asset_count) parts.push(`${fp.asset_count} assets`)
            const dc = fp.download_counts as Record<string, number> | undefined
            if (dc) {
                for (const [name, count] of Object.entries(dc)) {
                    parts.push(
                        `${name}: ${count >= 1000 ? (count / 1000).toFixed(1) + 'k' : count}`
                    )
                }
            }
        } else if (s.concernSource === 'issue' || s.concernSource === 'discussion') {
            const r = fp.reactions as Record<string, number> | undefined
            if (r) {
                for (const [k, v] of Object.entries(r)) {
                    if (v > 0) parts.push(`${reactionIcons[k] ?? k} ${v}`)
                }
            }
            if (fp.comment_count) parts.push(`💬 ${fp.comment_count}`)
        }
        return parts.join('  ·  ')
    }
</script>

<Navbar compact />

<main>
    <button class="btn-secondary" style="align-self: flex-start" onclick={() => goto('/coastline')}
        >Back</button
    >
    <div class="header-actions">
        {#if couldBeRelated.length > 0}
            <div class="bet-chips">
                {#each couldBeRelated as bet}
                    <button
                        class="bet-chip"
                        onclick={() => goto(`/?bet=${bet!.id}`)}
                        title={bet!.claim}
                    >
                        {bet!.codename}
                    </button>
                {/each}
            </div>
        {/if}
    </div>

    <div class="map-row">
        <div class="canvas-area">
            <div class="mode-toggle">
                <div class="topics-toggle-wrap">
                    <button
                        class="toggle-button"
                        class:active={viewMode === 'topic'}
                        onmouseenter={() => (topicsHover = true)}
                        onmouseleave={() => (topicsHover = false)}
                        onclick={() => switchMode('topic')}>Topics</button
                    >
                    {#if topicsHover && topicBreakdown.length > 0}
                        <div class="topics-breakdown">
                            {#each topicBreakdown as tb}
                                <div class="breakdown-row">
                                    <span class="breakdown-label">{tb.label}</span>
                                    <span class="breakdown-pct">{tb.pct}%</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
                <button
                    class="toggle-button"
                    class:active={viewMode === 'issue'}
                    onclick={() => switchMode('issue')}>Issues</button
                >
            </div>
            <div class="canvas-wrap">
                <canvas bind:this={rsCanvas} class="map-canvas"></canvas>
                {#if !repospace || (viewMode === 'topic' && clustering)}
                    <div class="clustering-overlay">Please wait…</div>
                {:else if viewMode === 'topic' && clusterProblem}
                    <div class="clustering-overlay">{clusterProblem}</div>
                {/if}
            </div>

            {#if activeStorybook > 1}
                <div class="controls">
                    <button
                        onclick={() => (currentPage = Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}>←</button
                    >
                    <span>{currentPage} / {activeStorybook}</span>
                    <button
                        onclick={() => (currentPage = Math.min(activeStorybook, currentPage + 1))}
                        disabled={currentPage >= activeStorybook}>→</button
                    >
                </div>
            {/if}
        </div>

        {#if detailPanel && panelSource}
            <div class="detail-panel">
                <div class="detail-panel-inner" {@attach animator.slideIn}>
                    <div class="detail-header">
                        <div class="detail-nav">
                            <button class="nav-btn" onclick={goToPrev} disabled={panelIndex === 0}
                                >←</button
                            >
                            <span class="nav-indicator">{panelIndex + 1} / {panelTotal}</span>
                            <button
                                class="nav-btn"
                                onclick={goToNext}
                                disabled={panelIndex >= panelTotal - 1}>→</button
                            >
                        </div>
                        <div class="detail-title-row">
                            <a
                                class="panel-badge"
                                href={panelSource.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style="background:{colour(panelSource)}22;color:{colour(
                                    panelSource
                                )}"
                            >
                                {withBadge(panelSource)}{panelSource.externalId
                                    ? ` #${panelSource.externalId}`
                                    : ''}
                            </a>
                            {#if showDetails(panelSource)}
                                <span class="panel-footprint-badge">{showDetails(panelSource)}</span
                                >
                            {/if}
                        </div>
                        <p class="panel-title">{panelSource.title ?? ''}</p>
                        {#if panelSource.author}
                            <p class="panel-author">by {panelSource.author}</p>
                        {/if}
                    </div>

                    <div class="detail-body">
                        {#if panelSource.body}
                            {#key panelSource.id}
                                <TiptapEditor value={panelSource.body} readonly />
                            {/key}
                        {:else}
                            <p class="panel-empty">No body content.</p>
                        {/if}
                    </div>

                    <div class="detail-footer">
                        {#if orphanInFocus && (panelSource.concernSource === 'pr' || panelSource.concernSource === 'discussion') && !matchResult}
                            <div class="panel-match">
                                <button
                                    class="btn-secondary"
                                    onclick={findMatch}
                                    disabled={matching}
                                >
                                    {matching ? 'Searching…' : 'Find matching issue'}
                                </button>
                            </div>
                        {/if}
                        {#if matchResult}
                            <div class="panel-match-result">
                                {#if matchResult.match && !userPick}
                                    <span class="match-text"
                                        >Matched to #{matchResult.match.issueNumber}: {matchResult
                                            .match.issueTitle}</span
                                    >
                                    <button
                                        class="btn-primary"
                                        onclick={confirmMatch}
                                        style="padding:4px 12px;font-size:11px">Confirm</button
                                    >
                                {/if}
                                <div class="match-candidates">
                                    <span class="match-candidates-label">Suggested:</span>
                                    {#each matchResult.candidates as c (c.issueNumber)}
                                        <button
                                            class="candidate-btn"
                                            class:active={userPick === c.issueNumber}
                                            onclick={() => (userPick = c.issueNumber)}
                                        >
                                            #{c.issueNumber}: {c.issueTitle}
                                        </button>
                                    {/each}
                                </div>
                                <div class="match-actions">
                                    <button
                                        class="btn-primary"
                                        onclick={confirmMatch}
                                        disabled={!matchResult.match && !userPick}
                                        style="padding:4px 12px;font-size:11px">Confirm</button
                                    >
                                    <button
                                        class="btn-secondary"
                                        onclick={dismissMatch}
                                        style="padding:4px 12px;font-size:11px">Dismiss</button
                                    >
                                </div>
                            </div>
                        {/if}
                        <div class="panel-promote">
                            <select bind:value={promoted} class="bet-select">
                                {#each drydock.bets as bet (bet.id)}
                                    <option value={bet.id}>{bet.codename}</option>
                                {/each}
                            </select>
                            <button class="btn-primary" onclick={promote} disabled={!promoted}
                                >Promote</button
                            >
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if orphanMode}
            <div class="detail-panel orphan-mode">
                <div class="detail-panel-inner" {@attach animator.slideIn}>
                    <div class="detail-header">
                        <button
                            class="btn-secondary"
                            style="align-self:flex-start"
                            onclick={exitOrphanMode}>← Back to Map</button
                        >
                        <div class="toggle-group" style="margin-top:8px">
                            {#each orphanGroupEntries as [type, items]}
                                <button
                                    class="toggle-button"
                                    class:active={orphanTab === type}
                                    onclick={() => selectOrphanTab(type)}
                                >
                                    {type} ({items.length})
                                </button>
                            {/each}
                        </div>
                    </div>

                    <div class="orphan-panel-content">
                        <div class="orphan-list-panel">
                            {#each orphanGroupEntries as [type, items]}
                                {#if type === orphanTab}
                                    {#each items as o, oi (o.source.id)}
                                        <div
                                            class="orphan-list-item"
                                            class:active={orphanInFocus?.index ===
                                                getOrphanFlatIndex(type, oi)}
                                            onclick={() => clickOrphans(type, oi)}
                                        >
                                            <span class="badge flat">#{o.source.externalId}</span>
                                            <span class="orphan-list-item-title"
                                                >{(o.source.title ?? '').substring(0, 60)}</span
                                            >
                                        </div>
                                    {/each}
                                {/if}
                            {/each}
                        </div>

                        {#if orphanInFocus && panelSource}
                            <div class="orphan-detail">
                                <div class="detail-header">
                                    <div class="detail-nav">
                                        <button
                                            class="nav-btn"
                                            onclick={goToPrev}
                                            disabled={panelIndex === 0}>←</button
                                        >
                                        <span class="nav-indicator"
                                            >{panelIndex + 1} / {panelTotal}</span
                                        >
                                        <button
                                            class="nav-btn"
                                            onclick={goToNext}
                                            disabled={panelIndex >= panelTotal - 1}>→</button
                                        >
                                    </div>
                                    <div class="detail-title-row">
                                        <a
                                            class="panel-badge"
                                            href={panelSource.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style="background:{colour(panelSource)}22;color:{colour(
                                                panelSource
                                            )}"
                                        >
                                            {withBadge(panelSource)}{panelSource.externalId
                                                ? ` #${panelSource.externalId}`
                                                : ''}
                                        </a>
                                        {#if showDetails(panelSource)}
                                            <span class="panel-footprint-badge"
                                                >{showDetails(panelSource)}</span
                                            >
                                        {/if}
                                    </div>
                                    <p class="panel-title">{panelSource.title ?? ''}</p>
                                    {#if panelSource.author}
                                        <p class="panel-author">by {panelSource.author}</p>
                                    {/if}
                                </div>

                                <div class="detail-body">
                                    {#if panelSource.body}
                                        {#key panelSource.id}
                                            <TiptapEditor value={panelSource.body} readonly />
                                        {/key}
                                    {:else}
                                        <p class="panel-empty">No body content.</p>
                                    {/if}
                                </div>

                                <div class="detail-footer">
                                    {#if orphanInFocus && (panelSource.concernSource === 'pr' || panelSource.concernSource === 'discussion') && !matchResult}
                                        <div class="panel-match">
                                            <button
                                                class="btn-secondary"
                                                onclick={findMatch}
                                                disabled={matching}
                                            >
                                                {matching ? 'Searching…' : 'Find matching issue'}
                                            </button>
                                        </div>
                                    {/if}
                                    {#if matchResult}
                                        <div class="panel-match-result">
                                            {#if matchResult.match && !userPick}
                                                <span class="match-text"
                                                    >Matched to #{matchResult.match.issueNumber}: {matchResult
                                                        .match.issueTitle}</span
                                                >
                                                <button
                                                    class="btn-primary"
                                                    onclick={confirmMatch}
                                                    style="padding:4px 12px;font-size:11px"
                                                    >Confirm</button
                                                >
                                            {/if}
                                            <div class="match-candidates">
                                                <span class="match-candidates-label"
                                                    >Suggested:</span
                                                >
                                                {#each matchResult.candidates as c (c.issueNumber)}
                                                    <button
                                                        class="candidate-btn"
                                                        class:active={userPick === c.issueNumber}
                                                        onclick={() => (userPick = c.issueNumber)}
                                                    >
                                                        #{c.issueNumber}: {c.issueTitle}
                                                    </button>
                                                {/each}
                                            </div>
                                            <div class="match-actions">
                                                <button
                                                    class="btn-primary"
                                                    onclick={confirmMatch}
                                                    disabled={!matchResult.match && !userPick}
                                                    style="padding:4px 12px;font-size:11px"
                                                    >Confirm</button
                                                >
                                                <button
                                                    class="btn-secondary"
                                                    onclick={dismissMatch}
                                                    style="padding:4px 12px;font-size:11px"
                                                    >Dismiss</button
                                                >
                                            </div>
                                        </div>
                                    {/if}
                                    <div class="panel-promote">
                                        <select bind:value={promoted} class="bet-select">
                                            {#each drydock.bets as bet (bet.id)}
                                                <option value={bet.id}>{bet.codename}</option>
                                            {/each}
                                        </select>
                                        <button
                                            class="btn-primary"
                                            onclick={promote}
                                            disabled={!promoted}>Promote</button
                                        >
                                    </div>
                                </div>
                            </div>
                        {:else}
                            <div class="orphan-detail-placeholder">
                                <p class="orphan-empty">Select an orphan to view details.</p>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        {/if}
    </div>
</main>

{#if totalOrphans > 0}
    <button class="fab" style="left:auto;right:32px" onclick={enterOrphanMode} title="View Orphans">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
            <path
                d="M8 12h8M12 8v8"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            />
        </svg>
    </button>
{/if}

<style>
    main {
        padding: 92px 24px 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow: hidden;
        height: 100vh;
        width: 100%;
        max-width: 1400px;
        margin: 0 auto;
    }

    .map-row {
        display: flex;
        gap: 0;
        align-items: flex-start;
        overflow: hidden;
        position: relative;
        flex: 1;
        min-height: 0;
    }

    .canvas-area {
        flex: 1 1 auto;
        min-width: 0;
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 0;
        align-self: stretch;
    }

    .mode-toggle {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 5;
        display: flex;
        gap: 2px;
    }

    .topics-toggle-wrap {
        position: relative;
    }

    .topics-breakdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 6px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px 16px;
        min-width: 160px;
        z-index: 10;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .breakdown-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
    }

    .breakdown-label {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .breakdown-pct {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .canvas-wrap {
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg-secondary);
        flex: 1;
        min-height: 0;
        position: relative;
    }

    .map-canvas {
        display: block;
        width: 100%;
        height: 100%;
        margin: 20px;
    }

    .clustering-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--text-secondary);
        opacity: 0.5;
        pointer-events: none;
    }

    .detail-panel {
        min-width: 0;
        position: absolute;
        right: 0;
        top: 0;
        width: 45%;
        height: 100%;
        z-index: 10;
        overflow: hidden;
    }

    .detail-panel-inner {
        width: 100%;
        height: 100%;
        min-width: 0;
        display: flex;
        overflow: clip;
        flex-direction: column;
        background: var(--bg-secondary);
    }

    .detail-header {
        width: 100%;
        min-width: 0;
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex-shrink: 0;
    }

    .detail-title-row {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .detail-nav {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
    }

    .panel-footprint-badge {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 500;
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 50%;
    }

    .detail-body {
        flex: 1;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 16px 24px;
        min-height: 0;
    }

    .detail-body :global(.tiptap-wrapper .tiptap) {
        border: none;
        background: transparent;
        padding: 0;
        min-height: unset;
    }

    .detail-footer {
        padding: 12px 16px;
        border-top: 1px solid var(--border);
        flex-shrink: 0;
    }

    .panel-badge {
        display: inline-flex;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        text-decoration: none;
    }

    .panel-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
    }

    .panel-author {
        margin: 0;
        font-size: 11px;
        opacity: 0.4;
    }

    .panel-empty {
        opacity: 0.4;
        font-size: 13px;
        margin: 0;
    }

    .controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 10px 0;
        font-size: 12px;
        opacity: 0.6;
        flex-shrink: 0;
    }

    .controls button {
        background: none;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 10px;
        cursor: pointer;
        color: inherit;
        font-size: 13px;
        line-height: 1;
    }

    .controls button:disabled {
        opacity: 0.25;
        cursor: default;
    }

    .controls button:not(:disabled):hover {
        background: var(--surface-hover, rgba(255, 255, 255, 0.06));
    }

    .nav-indicator {
        font-size: 12px;
        opacity: 0.4;
        flex: 1;
        text-align: center;
    }

    .panel-promote {
        display: flex;
        gap: 8px;
    }

    .panel-match {
        margin-bottom: 12px;
    }

    .panel-match-result {
        margin-bottom: 12px;
        padding: 10px 14px;
        background: var(--bg-tertiary);
        border: 1px solid var(--accent-primary);
        border-radius: var(--radius-sm);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .match-text {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .match-candidates {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .match-candidates-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
    }

    .candidate-btn {
        background: none;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 8px;
        cursor: pointer;
        color: var(--text-secondary);
        font-size: 11px;
        text-align: left;
        transition: all 0.1s;
    }

    .candidate-btn:hover {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
    }

    .candidate-btn.active {
        border-color: var(--accent-primary);
        background: var(--accent-primary);
        color: white;
    }

    .match-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }

    .detail-panel.orphan-mode {
        width: 100%;
    }
    .orphan-panel-content {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }
    .orphan-list-panel {
        width: 30%;
        min-width: 0;
        border-right: 1px solid var(--border);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
    }
    .orphan-list-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        transition: background 0.15s;
    }
    .orphan-list-item:hover {
        background: var(--surface-hover, rgba(255, 255, 255, 0.06));
    }
    .orphan-list-item.active {
        background: var(--accent-primary);
    }
    .orphan-list-item.active .badge.flat {
        background: rgba(255, 255, 255, 0.2);
        color: white;
    }
    .orphan-list-item.active .orphan-list-item-title {
        color: white;
    }
    .orphan-list-item-title {
        font-size: 12px;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .orphan-detail {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: clip;
    }
    .orphan-detail-placeholder {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .orphan-empty {
        text-align: center;
        opacity: 0.4;
        font-size: 13px;
    }
</style>
