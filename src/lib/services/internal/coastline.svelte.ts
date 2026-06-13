import type { Coastline, ConcernSourceMeta } from '$lib/schema'
import type { Drydock } from '../drydock.svelte.ts'
import { generateId } from '$lib/utils'
import { invoke } from '@tauri-apps/api/core'
import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

export class CoastlineView {
    list = $state<Coastline[]>([])
    meta = $state<ConcernSourceMeta[]>([])
    streaming = $state<{ current: number; total: number; phase: string } | null>(null)
    loading = $state(true)

    constructor(private dock: Drydock) {}

    async addNew(repoEntered: string) {
        const match = repoEntered.replace('https://github.com/', '').replace(/^@/, '')
        const [owner, repo] = match.split('/')
        if (this.list.some((existingRepos) => existingRepos.repoUrl === repoEntered)) return

        const id = generateId()
        const name = `${owner}/${repo}`
        const now = new Date()
        const db = await this.dock.getDb()
        await db.execute(
            `INSERT INTO coastlines (id, name, repo_url, owner, repo, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name, repoEntered, owner, repo, now.toISOString()]
        )
        this.list = [
            ...this.list,
            { id, name, repoUrl: repoEntered, owner, repo: repo, createdAt: now },
        ]
    }

    async refresh() {
        const db = await this.dock.getDb()
        try {
            const [coasts, ccs] = await Promise.all([
                db.select('SELECT * FROM coastlines ORDER BY created_at DESC'),
                db.select('SELECT * FROM coastline_concern_sources ORDER BY fetched_at DESC'),
            ])
            this.list = (coasts as any[]).map((row) => ({
                id: row.id,
                name: row.name,
                repoUrl: row.repo_url,
                owner: row.owner,
                repo: row.repo,
                description: row.description || undefined,
                lastFetchedAt: row.last_fetched_at ? new Date(row.last_fetched_at) : undefined,
                createdAt: new Date(row.created_at),
            }))
            this.meta = (ccs as any[]).map((row) => ({
                id: row.id,
                coastlineId: row.coastline_id,
                concernSource: row.signal_type,
                concern: row.concern,
                externalId: row.external_id || undefined,
                title: row.title || undefined,
                body: row.body || undefined,
                url: row.url || undefined,
                state: row.state || undefined,
                author: row.author || undefined,
                createdAtSource: row.created_at_source
                    ? new Date(row.created_at_source)
                    : undefined,
                updatedAtSource: row.updated_at_source
                    ? new Date(row.updated_at_source)
                    : undefined,
                fetchedAt: new Date(row.fetched_at),
                refs: row.refs ? JSON.parse(row.refs) : undefined,
                labels: row.labels ? JSON.parse(row.labels) : undefined,
                footprint: row.footprint ? JSON.parse(row.footprint) : undefined,
            }))
        } catch (e) {
            console.error('There was a problem updating the coastline view:', e)
        } finally {
            this.loading = false
        }
    }

    async fetch(coastlineId: string, cutoffDate?: Date) {
        const target = this.list.find((c) => c.id === coastlineId)
        if (!target) return

        let token: string | undefined
        try {
            token = await invoke<string>('get_settings', { key: 'github_token' })
        } catch {
            throw new Error('Please double-check your Github token in Drydock settings.')
        }

        const octokit = new Octokit({ auth: token })
        const gqlWithAuth = token
            ? graphql.defaults({ headers: { authorization: `token ${token}` } })
            : graphql

        const { owner, repo } = target

        const parseRefs = (text: string): string[] => {
            const refs = new Set<string>()
            for (const match of text.matchAll(/(?:closes|fixes|resolves|refs?)\s+#(\d+)/gi)) {
                refs.add(match[1])
            }
            for (const match of text.matchAll(
                /https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/gi
            )) {
                refs.add(match[1])
            }
            return [...refs]
        }

        const stripTemplate = (text: string): string => {
            if (owner !== 'sveltejs') return text
            const idx = text.search(/### Please don't delete this checklist!/i)
            return idx === -1 ? text : text.substring(0, idx).trimEnd()
        }

        const db = await this.dock.getDb()
        await db.execute(
            `DELETE FROM coastline_embeddings WHERE source_id IN (SELECT id FROM coastline_concern_sources WHERE coastline_id=?)`,
            [coastlineId]
        )
        await db.execute(`DELETE FROM coastline_concern_sources WHERE coastline_id=?`, [
            coastlineId,
        ])
        await db.execute(`DELETE FROM coastline_topics WHERE coastline_id=?`, [coastlineId])

        const insert = async (row: Omit<ConcernSourceMeta, 'fetchedAt'>) => {
            await db.execute(
                `INSERT INTO coastline_concern_sources
                 (id, coastline_id, signal_type, concern, external_id, title, body, url, state, author,
                  created_at_source, updated_at_source, refs, labels, footprint)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.id,
                    row.coastlineId,
                    row.concernSource,
                    row.concern,
                    row.externalId || null,
                    row.title || null,
                    row.body || null,
                    row.url || null,
                    row.state || null,
                    row.author || null,
                    row.createdAtSource?.toISOString() || null,
                    row.updatedAtSource?.toISOString() || null,
                    row.refs ? JSON.stringify(row.refs) : null,
                    row.labels ? JSON.stringify(row.labels) : null,
                    row.footprint ? JSON.stringify(row.footprint) : null,
                ]
            )
            const embText = `${row.title ?? ''} ${row.body ?? ''}`.trim()
            if (
                embText &&
                (row.concernSource === 'issue' ||
                    row.concernSource === 'discussion' ||
                    row.concernSource === 'release')
            ) {
                await invoke('send_to_nomic', { sourceId: row.id, text: embText })
            }
            if (this.streaming) {
                this.streaming = {
                    ...this.streaming,
                    current: this.streaming.current + 1,
                }
            }
        }

        const { caps, releases } = await this.lookAhead(octokit, owner, repo)
        const fetchedIssueNumbers = new Set<string>()

        // ── Phase 1: Ships — releases (REST, paginated, cutoff-filtered) ──
        const allReleases: any[] = []
        let releasePage = 1
        const releaseCap = caps.releases
        this.streaming = { phase: 'releases', current: 0, total: releaseCap }
        while (allReleases.length < releaseCap) {
            const { data: releases } = await octokit.repos.listReleases({
                owner,
                repo,
                per_page: Math.min(100, releaseCap - allReleases.length),
                page: releasePage,
            })
            if (releases.length === 0) break
            for (const rel of releases) {
                if (cutoffDate && new Date(rel.published_at ?? rel.created_at) < cutoffDate)
                    continue
                allReleases.push(rel)
            }
            this.streaming = { phase: 'releases', current: allReleases.length, total: releaseCap }
            if (releases.length < 100) break
            releasePage++
        }
        this.streaming = { phase: 'releases', current: 0, total: allReleases.length }
        for (const rel of allReleases) {
            const bodyRefs = parseRefs(rel.body || '')
            const downloadCounts: Record<string, number> = {}
            for (const asset of rel.assets ?? []) {
                downloadCounts[asset.name ?? 'unknown'] = asset.download_count ?? 0
            }
            await insert({
                id: generateId(),
                coastlineId,
                concernSource: 'release',
                concern: 'ship',
                externalId: rel.tag_name,
                title: rel.name || rel.tag_name,
                body: rel.body || undefined,
                url: rel.html_url,
                state: rel.draft ? 'draft' : 'published',
                author: rel.author?.login,
                createdAtSource: new Date(rel.published_at ?? rel.created_at),
                updatedAtSource: new Date(rel.created_at),
                refs: bodyRefs,
                footprint: {
                    prerelease: rel.prerelease ?? false,
                    download_counts: downloadCounts,
                    asset_count: rel.assets?.length ?? 0,
                },
            })
        }

        // ── Phase 2a: Attempts — PRs (REST, paginated, cutoff-filtered) ──
        const allPRs: any[] = []
        let prPage = 1
        this.streaming = { phase: 'PRs', current: 0, total: caps.prs }
        while (allPRs.length < caps.prs) {
            const { data: prs } = await octokit.pulls.list({
                owner,
                repo,
                state: 'all',
                per_page: Math.min(100, caps.prs - allPRs.length),
                page: prPage,
                ...(cutoffDate ? { since: cutoffDate.toISOString() } : {}),
            })
            if (prs.length === 0) break

            // PERF: Filter out noise by dropping closed-but-not merged PRs
            for (const pr of prs) {
                if (pr.state === 'closed' && !pr.merged_at) continue
                allPRs.push(pr)
            }
            this.streaming = { phase: 'PRs', current: allPRs.length, total: caps.prs }
            if (prs.length < 100) break
            prPage++
        }

        this.streaming = { phase: 'PRs', current: 0, total: allPRs.length }

        // ── Phase 2b: PR enrichment — batched GraphQL aliased queries ──
        const prEnrichment = new Map<string, any>()
        const prClosingIssues = new Map<string, string[]>()
        const prNumbers = allPRs.map((p) => p.number)
        const batchSize = 25
        for (let i = 0; i < prNumbers.length; i += batchSize) {
            const batch = prNumbers.slice(i, i + batchSize)
            const aliasedQuery = `
                query($owner: String!, $repo: String!) {
                    repository(owner: $owner, name: $repo) {
                        ${batch
                            .map(
                                (num, idx) => `
                            pr_${idx}: pullRequest(number: ${num}) {
                                reactions(first: 100) {
                                    totalCount
                                    nodes { content users(first: 1) { totalCount } }
                                }
                                comments { totalCount }
                                reviews { totalCount }
                                additions deletions changedFiles
                                closingIssuesReferences(first: 25) {
                                    nodes { number }
                                }
                            }
                        `
                            )
                            .join('\n')}
                    }
                }
            `
            try {
                const result = await gqlWithAuth<any>(aliasedQuery, { owner, repo })
                for (let j = 0; j < batch.length; j++) {
                    const pr = result?.repository?.[`pr_${j}`]
                    if (pr) prEnrichment.set(String(batch[j]), pr)
                }
            } catch {
                // batch failed — PRs still exist without footprint data
            }
            this.streaming = {
                phase: 'PRs',
                current: Math.min(i + batchSize, prNumbers.length),
                total: prNumbers.length,
            }
        }

        this.streaming = { phase: 'PRs', current: 0, total: allPRs.length }
        for (const pr of allPRs) {
            const enriched = prEnrichment.get(String(pr.number))
            const textRefs = parseRefs(pr.body || '')
            const graphRefs =
                enriched?.closingIssuesReferences?.nodes?.map((n: any) => String(n.number)) ?? []
            const allRefs = [...new Set([...textRefs, ...graphRefs])]
            prClosingIssues.set(String(pr.number), allRefs)

            const cleanBody = stripTemplate(pr.body || '')

            const reactionFootprint: Record<string, number> = {}
            for (const r of enriched?.reactions?.nodes ?? []) {
                reactionFootprint[r.content] = r.users?.totalCount ?? 0
            }

            await insert({
                id: generateId(),
                coastlineId,
                concernSource: 'pr',
                concern: 'attempt',
                externalId: String(pr.number),
                title: pr.title,
                body: cleanBody || undefined,
                url: pr.html_url,
                state: pr.merged_at ? 'merged' : pr.state,
                author: pr.user?.login,
                createdAtSource: new Date(pr.created_at),
                updatedAtSource: new Date(pr.updated_at),
                refs: allRefs,
                labels: pr.labels.map((l: any) => l.name ?? '').filter(Boolean),
                footprint: {
                    reactions: reactionFootprint,
                    comment_count: enriched?.comments?.totalCount ?? 0,
                    review_count: enriched?.reviews?.totalCount ?? 0,
                    additions: enriched?.additions ?? 0,
                    deletions: enriched?.deletions ?? 0,
                    changed_files: enriched?.changedFiles ?? 0,
                },
            })
        }

        // ── Phase 3: Resolve debate refs from ships + attempts ──
        const issueRefsToResolve = new Set<string>()
        for (const rel of allReleases) {
            for (const ref of parseRefs(rel.body || '')) {
                issueRefsToResolve.add(ref)
            }
        }
        for (const [, refs] of prClosingIssues) {
            for (const ref of refs) {
                issueRefsToResolve.add(ref)
            }
        }

        if (issueRefsToResolve.size > 0) {
            this.streaming = {
                phase: 'resolving refs',
                current: 0,
                total: issueRefsToResolve.size,
            }
            const refArray = Array.from(issueRefsToResolve)
            for (let i = 0; i < refArray.length; i += batchSize) {
                const batch = refArray.slice(i, i + batchSize)
                const aliasedQuery = `
                    query($owner: String!, $repo: String!) {
                        repository(owner: $owner, name: $repo) {
                            ${batch
                                .map(
                                    (num, idx) => `
                                issue_${idx}: issue(number: ${num}) {
                                    number title body url state createdAt updatedAt
                                    author { login }
                                    labels(first: 10) { nodes { name } }
                                    reactions(first: 100) {
                                        totalCount
                                        nodes { content users(first: 1) { totalCount } }
                                    }
                                    comments { totalCount }
                                }
                            `
                                )
                                .join('\n')}
                        }
                    }
                `
                try {
                    const result = await gqlWithAuth<any>(aliasedQuery, { owner, repo })
                    for (let j = 0; j < batch.length; j++) {
                        const issue = result?.repository?.[`issue_${j}`]
                        if (!issue) continue
                        fetchedIssueNumbers.add(String(issue.number))

                        const reactionFootprint: Record<string, number> = {}
                        for (const r of issue.reactions?.nodes ?? []) {
                            reactionFootprint[r.content] = r.users?.totalCount ?? 0
                        }

                        await insert({
                            id: generateId(),
                            coastlineId,
                            concernSource: 'issue',
                            concern: 'debate',
                            externalId: String(issue.number),
                            title: issue.title,
                            body: issue.body || undefined,
                            url: issue.url,
                            state: issue.state.toLowerCase(),
                            author: issue.author?.login,
                            createdAtSource: new Date(issue.createdAt),
                            updatedAtSource: new Date(issue.updatedAt),
                            refs: parseRefs(issue.body || ''),
                            labels: (issue.labels?.nodes ?? [])
                                .map((l: any) => l.name)
                                .filter(Boolean),
                            footprint: {
                                reactions: reactionFootprint,
                                comment_count: issue.comments?.totalCount ?? 0,
                            },
                        })
                    }
                } catch {
                    // batch failed
                }
                this.streaming = {
                    phase: 'resolving refs',
                    current: Math.min(i + batchSize, refArray.length),
                    total: refArray.length,
                }
            }
        }

        // ── Phase 4: Recency fill — recent uncaptured issues ──
        const remainingIssueCap = Math.max(0, caps.issues - fetchedIssueNumbers.size)
        if (remainingIssueCap > 0) {
            let issuePage = 1
            let fetched = 0
            this.streaming = { phase: 'recent issues', current: 0, total: remainingIssueCap }
            while (fetched < remainingIssueCap) {
                const { data: issues } = await octokit.issues.listForRepo({
                    owner,
                    repo,
                    state: 'open',
                    per_page: Math.min(100, remainingIssueCap - fetched),
                    page: issuePage,
                    sort: 'updated',
                    direction: 'desc',
                    ...(cutoffDate ? { since: cutoffDate.toISOString() } : {}),
                })
                if (issues.length === 0) break
                const realIssues = issues.filter((i) => !i.pull_request)
                for (const issue of realIssues) {
                    if (fetchedIssueNumbers.has(String(issue.number))) continue
                    fetchedIssueNumbers.add(String(issue.number))
                    fetched++
                    await insert({
                        id: generateId(),
                        coastlineId,
                        concernSource: 'issue',
                        concern: 'debate',
                        externalId: String(issue.number),
                        title: issue.title,
                        body: issue.body || undefined,
                        url: issue.html_url,
                        state: issue.state,
                        author: issue.user?.login,
                        createdAtSource: new Date(issue.created_at),
                        updatedAtSource: new Date(issue.updated_at),
                        refs: parseRefs(issue.body || ''),
                        labels: issue.labels
                            .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
                            .filter(Boolean),
                    })
                    if (fetched >= remainingIssueCap) break
                }
                this.streaming = {
                    phase: 'recent issues',
                    current: fetched,
                    total: remainingIssueCap,
                }
                if (issues.length < 100) break
                issuePage++
            }
        }

        // ── Phase 5: Discussions ──
        try {
            const { repository } = await gqlWithAuth<any>(
                `
                query($owner: String!, $repo: String!) {
                    repository(owner: $owner, name: $repo) {
                        discussions(
                            first: ${Math.min(100, caps.discussions)},
                            states: [OPEN],
                            orderBy: { field: UPDATED_AT, direction: DESC }
                        ) {
                            nodes {
                                number title body url state author { login }
                                createdAt updatedAt category { name }
                                comments { totalCount }
                                reactions { totalCount }
                            }
                        }
                    }
                }`,
                { owner, repo }
            )
            const discussionNodes = repository?.discussions?.nodes ?? []
            const filtered = cutoffDate
                ? discussionNodes.filter((d: any) => new Date(d.updatedAt) >= cutoffDate)
                : discussionNodes
            this.streaming = {
                phase: 'discussions',
                current: 0,
                total: filtered.length,
            }
            for (const d of filtered) {
                await insert({
                    id: generateId(),
                    coastlineId,
                    concernSource: 'discussion',
                    concern: 'debate',
                    externalId: String(d.number),
                    title: d.title,
                    body: d.body || undefined,
                    url: d.url,
                    state: d.state.toLowerCase(),
                    author: d.author?.login,
                    createdAtSource: new Date(d.createdAt),
                    updatedAtSource: new Date(d.updatedAt),
                    refs: parseRefs(d.body || ''),
                    labels: d.category?.name ? [d.category.name] : undefined,
                    footprint: {
                        comment_count: d.comments?.totalCount ?? 0,
                        reaction_count: d.reactions?.totalCount ?? 0,
                    },
                })
            }
        } catch {
            // discussions may be disabled on this repo
        }

        await db.execute(`UPDATE coastlines SET last_fetched_at=? WHERE id=?`, [
            new Date().toISOString(),
            coastlineId,
        ])

        this.streaming = null
        await this.refresh()
    }

    private async lookAhead(
        octokit: Octokit,
        owner: string,
        repo: string
    ): Promise<{
        caps: {
            issues: number
            prs: number
            releases: number
            discussions: number
        }
        releases: { tag: string; name: string; publishedAt: Date }[]
    }> {
        const { data: repoData } = await octokit.repos.get({ owner, repo })

        const totalIssues = repoData.open_issues_count ?? 0
        const size = repoData.size ?? 0

        const isMassive = totalIssues > 2000 || size > 500000
        const isLarge = totalIssues > 500 || size > 100000
        const isMedium = totalIssues > 100 || size > 10000

        const caps = isMassive
            ? { issues: 500, prs: 500, releases: 30, discussions: 100 }
            : isLarge
              ? { issues: 500, prs: 400, releases: 30, discussions: 100 }
              : isMedium
                ? { issues: 500, prs: 300, releases: 30, discussions: 100 }
                : { issues: 500, prs: 300, releases: 30, discussions: 100 }

        const releases: { tag: string; name: string; publishedAt: Date }[] = []
        let page = 1
        while (releases.length < 100) {
            const { data: rels } = await octokit.repos.listReleases({
                owner,
                repo,
                per_page: 100,
                page,
            })
            if (rels.length === 0) break
            for (const r of rels) {
                releases.push({
                    tag: r.tag_name,
                    name: r.name || r.tag_name,
                    publishedAt: new Date(r.published_at ?? r.created_at),
                })
            }
            if (rels.length < 100) break
            page++
        }

        return { caps, releases }
    }

    async lookAheadReleases(coastlineId: string) {
        const target = this.list.find((c) => c.id === coastlineId)
        if (!target) return []

        let token: string | undefined
        try {
            token = await invoke<string>('get_settings', { key: 'github_token' })
        } catch {
            return []
        }

        const octokit = new Octokit({ auth: token })
        const { owner, repo } = target

        const releases: { tag: string; name: string; publishedAt: Date }[] = []
        let page = 1
        while (releases.length < 100) {
            const { data: rels } = await octokit.repos.listReleases({
                owner,
                repo,
                per_page: 100,
                page,
            })
            if (rels.length === 0) break
            for (const r of rels) {
                releases.push({
                    tag: r.tag_name,
                    name: r.name || r.tag_name,
                    publishedAt: new Date(r.published_at ?? r.created_at),
                })
            }
            if (rels.length < 100) break
            page++
        }
        return releases
    }

    async remove(coastlineId: string) {
        const db = await this.dock.getDb()
        await db.execute(
            `DELETE FROM coastline_embeddings WHERE source_id IN (SELECT id FROM coastline_concern_sources WHERE coastline_id=?)`,
            [coastlineId]
        )
        await db.execute(`DELETE FROM coastline_concern_sources WHERE coastline_id=?`, [
            coastlineId,
        ])
        await db.execute(`DELETE FROM coastlines WHERE id=?`, [coastlineId])
        await this.refresh()
    }

    sourcesFor(id: string) {
        return this.meta.filter((source) => source.id === id)
    }

    async createEvidenceRelationship(id: string, betId: string) {
        const source = this.meta.find((s) => s.id === id)
        if (!source) return

        await this.dock.rubberStampEvidence({
            betId,
            source: 'github',
            url: source.url || '',
            title: source.title || `${source.concernSource} #${source.externalId}`,
            snippet: source.body?.substring(0, 500) || source.title || '',
            capturedAt: new Date(),
            sourceCreatedAt: source.createdAtSource,
            sentiment: 'neutral',
            weight: 3,
            coastlineId: source.coastlineId,
        })
    }

    async findMatchForOrphan(orphanId: string) {
        const orphan = this.meta.find((s) => s.id === orphanId)
        if (!orphan) return null
        const coastlineId = orphan.coastlineId

        try {
            const result = await invoke<{
                match: { issueNumber: string; issueTitle: string } | null
                candidates: { issueNumber: string; issueTitle: string }[]
            } | null>('match_orphan_to_issue', { orphanId, coastlineId })
            return result ?? null
        } catch {
            return null
        }
    }

    async confirmMatch(orphanId: string, issueNumber: string) {
        const db = await this.dock.getDb()
        const row = await db.select(`SELECT refs FROM coastline_concern_sources WHERE id = ?`, [
            orphanId,
        ])
        const existing = (row as any[])?.[0]?.refs ?? '[]'
        const refs = JSON.parse(existing) as string[]
        if (refs.includes(issueNumber)) return

        refs.push(issueNumber)
        await db.execute(`UPDATE coastline_concern_sources SET refs = ? WHERE id = ?`, [
            JSON.stringify(refs),
            orphanId,
        ])

        await this.refresh()
    }

    async loadBuckets(
        coastlineId: string
    ): Promise<{ id: number; label: string; issueIds: string[] }[] | null> {
        const db = await this.dock.getDb()
        const rows = await db.select(
            `SELECT cluster_id, label, issue_ids FROM coastline_topics WHERE coastline_id = ? ORDER BY cluster_id`,
            [coastlineId]
        )
        const arr = rows as any[]
        if (arr.length === 0) return null
        return arr.map((r) => ({
            id: r.cluster_id,
            label: r.label,
            issueIds: JSON.parse(r.issue_ids),
        }))
    }

    async saveTopicClusters(
        coastlineId: string,
        clusters: { id: number; label: string; issueIds: string[] }[]
    ) {
        const db = await this.dock.getDb()
        await db.execute(`DELETE FROM coastline_topics WHERE coastline_id = ?`, [coastlineId])
        for (const c of clusters) {
            await db.execute(
                `INSERT INTO coastline_topics (coastline_id, cluster_id, label, issue_ids) VALUES (?, ?, ?, ?)`,
                [coastlineId, c.id, c.label, JSON.stringify(c.issueIds)]
            )
        }
    }
}
