// src/lib/drydock.svelte.ts -- the CPU of this desktop app
import { invoke } from '@tauri-apps/api/core'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import Database from '@tauri-apps/plugin-sql'
import type {
    Block,
    Media,
    UserPlatform,
    Evidence,
    MissionStatus,
    Blip,
    Bet,
    Publication,
    CreatorSettings,
    TopicNature,
} from '../schema/'
import { SEED_BETS } from '../schema/'
import { generateId } from 'utils'
import { CoastlineView } from './internal/coastline.svelte'
import { Publisher } from './internal/publisher.svelte'

export class Drydock {
    // User settings
    creator = $state<CreatorSettings | null>(null)

    // Oceans and radars
    bets = $state<Bet[]>([])
    evidence = $state<Evidence[]>([])
    blips = $state<Blip[]>([])
    sweepMessages = $state<{ id: number; text: string; yOffset: number }[]>([])

    // Init jobs
    db: Database | null = null
    private started = false

    // Other routes
    private coastline = new CoastlineView(this)
    private publisher = new Publisher(this)

    // Coastline proxies
    get coastlines() {
        return this.coastline.list
    }

    get concernSources() {
        return this.coastline.meta
    }

    get fetchProgress() {
        return this.coastline.streaming
    }

    get coastlinesLoading() {
        return this.coastline.loading
    }

    async registerCoastline(url: string) {
        await this.coastline.addNew(url)
    }

    async fetchCoastlineMeta(id: string, cutoffDate?: Date) {
        await this.coastline.fetch(id, cutoffDate)
    }

    async getCoastlineReleases(id: string) {
        return this.coastline.lookAheadReleases(id)
    }

    async confirmOrphanMatch(orphanId: string, issueNumber: string) {
        await this.coastline.confirmMatch(orphanId, issueNumber)
    }

    async matchOrphanToIssue(orphanId: string) {
        return this.coastline.findMatchForOrphan(orphanId)
    }

    async deleteCoastline(id: string) {
        await this.coastline.remove(id)
    }

    async promoteToEvidence(sourceId: string, betId: string) {
        await this.coastline.createEvidenceRelationship(sourceId, betId)
        await this.refresh()
    }

    async loadBuckets(coastlineId: string) {
        return this.coastline.loadBuckets(coastlineId)
    }

    async saveTopicClusters(
        coastlineId: string,
        clusters: { id: number; label: string; issueIds: string[] }[]
    ) {
        await this.coastline.saveTopicClusters(coastlineId, clusters)
    }

    // Publisher proxies
    get history() {
        return this.publisher.history
    }

    whatsBeenPublishedOn(betId: string): Publication[] {
        return this.publisher.whatsBeenPublishedOn(betId)
    }

    async saveDraft(betId: string, format: Media, content: string): Promise<string> {
        return await this.publisher.saveDraft(betId, format, content)
    }

    async deleteDraft(publicationId: string): Promise<void> {
        await this.publisher.delete(publicationId)
    }

    async saveBlock(betId: string, blocks: Block[], markdownContent: string): Promise<string> {
        return await this.publisher.syncUI(betId, blocks, markdownContent)
    }

    async updateBlock(publicationId: string, blocks: Block[]): Promise<void> {
        await this.publisher.updateUI(publicationId, blocks)
    }

    async markAsPublished(publicationId: string, url: string): Promise<void> {
        await this.publisher.publish(publicationId, url)
    }

    // Drydock runtime begins here
    constructor() {}

    async getDb() {
        if (!this.db) {
            this.db = await Database.load('sqlite:drydock.db')
        }
        return this.db
    }

    async coldStart() {
        if (this.started) return
        this.started = true

        try {
            await this.refresh()

            const recordToCheck: any = await this.db!.select(
                `SELECT first_time_user FROM user_journey WHERE id= ?`,
                ['onlyuser']
            )

            const wayTooCold = recordToCheck[0].first_time_user === 1

            if (wayTooCold) {
                for (const bet of SEED_BETS) {
                    await this.placeBet({
                        ...bet,
                        madeAt: new Date(),
                        currentConfidence: bet.initialConfidence,
                    })
                }

                await this.db!.execute(
                    `UPDATE user_journey SET first_time_user = FALSE WHERE id = ?`,
                    ['onlyuser']
                )
            }
        } catch (e) {
            message(`There was a problem starting Drydock: ${e}`, {
                title: 'Serious error',
                kind: 'error',
            })
        }
    }

    async niceToMeetUser(
        platform: string,
        tone: string,
        audience: string,
        formats: UserPlatform[] = ['blog']
    ) {
        const db = await this.getDb()
        const id = 'onlyuser'

        await db.execute(
            `INSERT OR REPLACE INTO user_journey (id, platform, voice, audience, output_formats, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, platform, tone, audience, JSON.stringify(formats), new Date().toISOString()]
        )

        await this.refresh()
    }

    evidenceFor(betId: string) {
        return this.evidence.filter((e) => e.betId === betId)
    }

    async refresh() {
        const db = await this.getDb()

        const [preds, evs, sigs, drydockSettings] = await Promise.all([
            db.select('SELECT * FROM predictions ORDER BY made_at DESC'),
            db.select('SELECT * FROM evidence ORDER BY captured_at DESC'),
            db.select('SELECT * FROM pending_signals ORDER BY captured_at DESC'),
            db.select('SELECT * FROM user_journey LIMIT 1'),
        ])

        // Refresh user settings
        if (Array.isArray(drydockSettings)) {
            const onlyEverOne = drydockSettings[0] as any
            this.creator = {
                id: onlyEverOne.id,
                mainPlatform: onlyEverOne.platform,
                voice: onlyEverOne.voice,
                audience: onlyEverOne.audience,
                platforms: JSON.parse(onlyEverOne.output_formats || '["blog"]'),
                createdAt: new Date(onlyEverOne.created_at),
                updatedAt: new Date(onlyEverOne.updated_at),
            }
        }

        const incomingEvs: Evidence[] = (evs as any[]).map((row) => ({
            ...row,
            betId: row.prediction_id,
            capturedAt: new Date(row.captured_at),
            sourceCreatedAt: row.source_created_at ? new Date(row.source_created_at) : undefined,
            sentiment: row.sentiment || undefined,
            timesUsed: row.times_used ?? 0,
            coastlineId: row.coastline_id || undefined,
        }))

        // TODO: We should probably just keep bet and mission status alive in memory without storing them
        // For now this reference holds fresh missions status and confidence for bets and we use it to overwrite the stored values in the DB
        const liveConfidenceAndStatus: Promise<any>[] = []

        const incomingBets: Bet[] = (preds as any[]).map((row) => {
            const betEvidence = incomingEvs.filter((e) => e.betId === row.id)
            const initialConfidence = Number(row.initial_confidence)
            const currentConfidence = getConfidence(initialConfidence, betEvidence)
            const missionStatus = howsMissionGoing(
                {
                    currentConfidence,
                    initialConfidence,
                    targetDate: row.target_date ? new Date(row.target_date) : undefined,
                } as Bet,
                betEvidence,
                row.mission_status || 'active'
            )

            if (
                currentConfidence !== Number(row.current_confidence) ||
                missionStatus !== row.mission_status
            ) {
                liveConfidenceAndStatus.push(
                    db.execute(
                        'UPDATE predictions SET current_confidence=?, mission_status=? WHERE id=?',
                        [currentConfidence, missionStatus, row.id]
                    )
                )
            }

            // WARN: lastPollTime without Date pre-processing can be a nasty issue
            return {
                id: row.id,
                codename: row.codename || 'Unnamed Mission',
                claim: row.claim,
                description: row.description,
                provesRight: row.proves_right || undefined,
                provesWrong: row.proves_wrong || undefined,
                initialConfidence,
                currentConfidence,
                madeAt: new Date(row.made_at),
                targetDate: row.target_date ? new Date(row.target_date) : undefined,
                missionStatus,
                blogPostUrl: row.blog_post_url,
                firehoseFilters: row.firehose_filters
                    ? (() => {
                          const filters = JSON.parse(row.firehose_filters)
                          if (filters.lastPollTime) {
                              filters.lastPollTime = new Date(filters.lastPollTime)
                          }
                          return filters
                      })()
                    : undefined,
                topic: row.topic ? JSON.parse(row.topic) : { frequency: 'low', confidence: 'low' },
            }
        })

        if (liveConfidenceAndStatus.length > 0) await Promise.all(liveConfidenceAndStatus)

        this.bets = incomingBets
        this.evidence = incomingEvs
        this.blips = (sigs as any[]).map((row) => ({
            id: row.id,
            betId: row.prediction_id,
            source: (row.source || 'bluesky') as 'bluesky' | 'hackernews',
            postUri: row.post_uri,
            author: row.author,
            authorAvatar: row.author_avatar || undefined,
            text: row.text,
            createdAt: new Date(row.created_at),
            capturedAt: new Date(row.captured_at),
            expiresAt: new Date(row.expires_at),
            keywordMatches: row.keyword_matches || 0,
            postUrl: row.post_url || '',
        }))

        await this.coastline.refresh()
        await this.publisher.refresh()
    }

    async placeBet(pred: any): Promise<string | null> {
        // Topic should be passed in from the UI, not calculated here
        const topic = pred.topic || { frequency: 'low', confidence: 'low' }

        // TODO: Cold starts probably should be decoupled from placeBet but for now we dedupe here
        const existing = await this.db!.select('SELECT id FROM predictions WHERE claim = ?', [
            pred.claim,
        ])

        if ((existing as any[]).length > 0) return null

        const id = generateId()
        await (
            await this.getDb()
        ).execute(
            `INSERT INTO predictions (id, maturity, codename, claim, description, proves_right, proves_wrong, made_at,
                 initial_confidence, current_confidence, mission_status, blog_post_url, firehose_filters, topic)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                'validating',
                pred.codename,
                pred.claim,
                pred.description,
                pred.provesRight || null,
                pred.provesWrong || null,
                pred.madeAt.toISOString(),
                pred.initialConfidence,
                pred.currentConfidence,
                pred.missionStatus || 'active',
                pred.blogPostUrl,
                pred.firehoseFilters ? JSON.stringify(pred.firehoseFilters) : null,
                JSON.stringify(topic),
            ]
        )
        await this.refresh()
        return id
    }

    async reviseBet(betId: string, updates: Partial<Bet>) {
        await (
            await this.getDb()
        ).execute(
            `UPDATE predictions SET codename=?, claim=?, description=?, proves_right=?, proves_wrong=?,
             target_date=?, initial_confidence=?, current_confidence=?, firehose_filters=? WHERE id=?`,
            [
                updates.codename,
                updates.claim,
                updates.description,
                updates.provesRight || null,
                updates.provesWrong || null,
                updates.targetDate?.toISOString(),
                updates.initialConfidence,
                updates.currentConfidence,
                updates.firehoseFilters ? JSON.stringify(updates.firehoseFilters) : null,
                betId,
            ]
        )
        await this.refresh()
    }

    async updateTopic(betId: string, topic: TopicNature) {
        await (
            await this.getDb()
        ).execute(`UPDATE predictions SET topic = ? WHERE id = ?`, [JSON.stringify(topic), betId])
        await this.refresh()
    }

    async killBet(betId: string) {
        if (
            await confirm('Delete this bet and all its evidence?', {
                title: 'Deleting bet',
                kind: 'warning',
            })
        ) {
            const db = await this.getDb()
            await db.execute(`DELETE FROM dismissed_signals WHERE prediction_id=?`, [betId])
            await db.execute(`DELETE FROM pending_signals WHERE prediction_id=?`, [betId])
            await db.execute(`DELETE FROM evidence WHERE prediction_id=?`, [betId])
            await db.execute(`DELETE FROM predictions WHERE id=?`, [betId])
            await this.refresh()
        }
    }

    async changeStatus(betId: string, newStatus: MissionStatus, blogPostUrl?: string) {
        await (
            await this.getDb()
        ).execute(`UPDATE predictions SET mission_status=?, blog_post_url=? WHERE id=?`, [
            newStatus,
            blogPostUrl,
            betId,
        ])
        await this.refresh()
    }

    async rubberStampEvidence(ev: any) {
        const db = await this.getDb()
        const id = generateId()

        const betThisEvidenceBelongsTo = this.bets.find((b) => b.id === ev.betId)

        const uiSafeCaptureDate = new Date(
            Math.max(ev.capturedAt.getTime(), betThisEvidenceBelongsTo!.madeAt.getTime())
        )

        await db.execute(
            `INSERT INTO evidence (id, prediction_id, source, url, title, snippet,
             captured_at, source_created_at, sentiment, weight, language, coastline_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                ev.betId,
                ev.source,
                ev.url,
                ev.title,
                ev.snippet,
                uiSafeCaptureDate.toISOString(),
                ev.sourceCreatedAt?.toISOString() || null,
                ev.sentiment || null,
                ev.weight,
                ev.language || null,
                ev.coastlineId || null,
            ]
        )
        await this.refresh()
        return id
    }

    async updateEvidence(logId: string, updates: Partial<Evidence>) {
        await (
            await this.getDb()
        ).execute(
            `UPDATE evidence SET source=?, url=?, title=?, snippet=?, sentiment=?, weight=?, language=?, WHERE id=?`,
            [
                updates.source,
                updates.url,
                updates.title,
                updates.snippet,
                updates.sentiment,
                updates.weight,
                updates.language,
                logId,
            ]
        )
        await this.refresh()
    }

    async burnEvidence(logId: string) {
        if (await confirm('Delete this?', { title: 'Delete evidence', kind: 'warning' })) {
            const db = await this.getDb()
            await db.execute(`DELETE FROM evidence WHERE id=?`, [logId])
            await this.refresh()
        }
    }

    // RADAR VIEW

    pushSweepMessage(text: string) {
        const id = Date.now() + Math.random()
        const yOffset = this.sweepMessages.length * 18
        this.sweepMessages = [...this.sweepMessages, { id, text, yOffset }]
        setTimeout(() => {
            this.sweepMessages = this.sweepMessages.filter((m) => m.id !== id)
        }, 5000)
    }

    async pollRadar(betId: string) {
        const pred = this.bets.find((p) => p.id === betId)
        if (!pred?.firehoseFilters?.enabled) return

        const filters = pred.firehoseFilters
        let strategyUpdated = filters.strategyUpdated ?? false

        const lastPollTime = filters.lastPollTime ? new Date(filters.lastPollTime) : null
        const gate1 = !lastPollTime || Date.now() - lastPollTime.getTime() >= 12 * 60 * 60 * 1000

        if (gate1) {
            const db = await this.getDb()
            const lastPollIso = lastPollTime?.toISOString() ?? new Date(0).toISOString()
            const rows = await db.select<Array<{ count: number }>>(
                `SELECT COUNT(*) as count FROM evidence WHERE prediction_id = ? AND captured_at > ?`,
                [betId, lastPollIso]
            )
            if ((rows[0]?.count ?? 0) > 0) {
                const freshKeywords = await invoke<string[]>('refresh_search_strategy', {
                    betId,
                    claim: pred.claim,
                    provesRight: pred.provesRight ?? '',
                    provesWrong: pred.provesWrong ?? '',
                    currentKeywords: filters.keywords,
                })
                filters.keywords = freshKeywords
                strategyUpdated = true
            }
        }

        // Rust case-matching on the backend will throw here
        const handle = await invoke<string>('get_settings', { key: 'bluesky_handle' })
        const appPassword = await invoke<string>('get_settings', { key: 'bluesky_app_password' })
        const accessToken = await invoke<string>('trawl_bsky', { handle, appPassword })

        const db = await this.getDb()
        const now = new Date()
        const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const limit = pred.topic?.frequency === 'low' ? 100 : 25

        this.sweepMessages = []

        // Fire HN immediately (no auth) while Bluesky keyword loop runs
        const hnPromise = invoke<any[]>('fetch_hn_posts', { keywords: filters.keywords })
            .then((posts) => posts.map((p) => ({ ...p, source: 'hackernews' })))
            .catch((err) => {
                console.warn('HN fetch failed:', err)
                this.pushSweepMessage("Hacker News didn't respond this sweep")
                return []
            })

        const bskyPosts: any[] = []
        const seenBskyUris = new Set<string>()
        let bskyWarnSent = false
        for (const keywordString of filters.keywords) {
            try {
                const results = await invoke<any[]>('fetch_bluesky_posts', {
                    accessToken,
                    keywords: keywordString,
                    limit,
                })
                for (const post of results) {
                    if (!seenBskyUris.has(post.uri)) {
                        seenBskyUris.add(post.uri)
                        bskyPosts.push({ ...post, source: 'bluesky' })
                    }
                }
            } catch (err) {
                console.warn(`Bluesky search error for "${keywordString}":`, err)
                if (!bskyWarnSent) {
                    this.pushSweepMessage(
                        'Bluesky is having problems and the sweep might be incomplete'
                    )
                    bskyWarnSent = true
                }
            }
        }

        // Re-score every post against the full fresh keyword list
        const rescore = (text: string) =>
            filters.keywords.filter((kw) =>
                kw.split(',').some((term) => text.toLowerCase().includes(term.trim().toLowerCase()))
            ).length

        const hnPosts = await hnPromise
        const allPosts = [...bskyPosts, ...hnPosts].map((p) => ({
            ...p,
            keyword_matches: rescore(p.text),
        }))

        for (const post of allPosts) {
            const dismissed = await db.select<Array<{ post_uri: string }>>(
                `SELECT post_uri FROM dismissed_signals WHERE prediction_id=? AND post_uri=?`,
                [betId, post.uri]
            )
            if (dismissed.length > 0) continue

            // WARN: Post URIs don't exist in the evidence table — validate against post URLs
            const alreadyEvidence = await db.select<Array<{ url: string }>>(
                `SELECT url FROM evidence WHERE prediction_id=? AND url=?`,
                [betId, post.post_url]
            )
            if (alreadyEvidence.length > 0) continue

            // Guard against recycled content (same text, different URI)
            const recycled = await db.select<Array<{ text: string }>>(
                `SELECT text FROM pending_signals WHERE prediction_id=? AND text=?`,
                [betId, post.text]
            )
            if (recycled.length > 0) continue

            await db.execute(
                `INSERT OR IGNORE INTO pending_signals (
                    id, prediction_id, post_uri, author, author_avatar,
                    text, created_at, captured_at, expires_at, keyword_matches, post_url, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    generateId(),
                    betId,
                    post.uri,
                    post.author,
                    post.author_avatar || '',
                    post.text,
                    post.created_at,
                    now.toISOString(),
                    expires.toISOString(),
                    post.keyword_matches || 0,
                    post.post_url || '',
                    post.source,
                ]
            )
        }

        await (
            await this.getDb()
        ).execute(`UPDATE predictions SET firehose_filters=? WHERE id=?`, [
            JSON.stringify({ ...filters, lastPollTime: now, strategyUpdated }),
            betId,
        ])

        await this.refresh()
    }

    async approve(signalId: string) {
        const signal = this.blips.find((s) => s.id === signalId)
        if (!signal) return

        await this.rubberStampEvidence({
            betId: signal.betId,
            source: signal.source,
            url: signal.postUrl,
            title:
                signal.source === 'hackernews' ? `HN: ${signal.text}` : `Post by @${signal.author}`,
            snippet: signal.text,
            capturedAt: new Date(),
            sourceCreatedAt: signal.createdAt,
            sentiment: 'neutral',
            weight: 3,
        })

        const db = await this.getDb()

        // Record as dismissed so it doesn't resurface on next poll (dedup check uses post_uri)
        await db.execute(
            `INSERT OR IGNORE INTO dismissed_signals (prediction_id, post_uri, dismissed_at) VALUES (?, ?, ?)`,
            [signal.betId, signal.postUri, new Date().toISOString()]
        )

        await db.execute(`DELETE FROM pending_signals WHERE id=?`, [signalId])
        await this.refresh()
    }

    async dismiss(signalId: string) {
        const signal = this.blips.find((s) => s.id === signalId)
        if (!signal) return

        const db = await this.getDb()

        // Record dismissal so it doesn't resurface
        await db.execute(
            `INSERT OR IGNORE INTO dismissed_signals (prediction_id, post_uri, dismissed_at) VALUES (?, ?, ?)`,
            [signal.betId, signal.postUri, new Date().toISOString()]
        )

        // Remove from pending
        await db.execute(`DELETE FROM pending_signals WHERE id=?`, [signalId])
        await this.refresh()
    }

    blipsFor(betId: string) {
        return this.blips.filter((blip) => blip.betId === betId)
    }

    // For the user's blips management
    get firehoseData() {
        return this.bets
            .filter((bet) => bet.firehoseFilters?.enabled)
            .map((bet) => ({ bet, blips: this.blipsFor(bet.id) }))
    }

}

export const drydock = new Drydock()

// Local Helpers
//
//
// Calculate current confidence based on evidence
function getConfidence(storedConf: number, evidence: Evidence[]): number {
    if (evidence.length === 0) return storedConf

    const weight = evidence.reduce((all, e) => all + e.weight, 0)
    if (weight === 0) return storedConf

    const weightedSentiment = evidence.reduce((update, e) => {
        if (e.sentiment === 'supports') return update + e.weight
        if (e.sentiment === 'refutes') return update - e.weight
        return update
    }, 0)

    // Shift confidence based on weighted evidence direction
    // Max ±30 point swing from initial confidence
    const shift = (weightedSentiment / weight) * 30
    return Math.max(0, Math.min(100, Math.round(storedConf + shift)))
}

// Calculate mission status based on bet state
function howsMissionGoing(
    bet: Bet,
    evidence: Evidence[],
    currentStatus: MissionStatus
): MissionStatus {
    // Two cases we don't touch
    if (currentStatus === 'published') return 'published'
    if (evidence.length === 0) return 'dormant'

    const now = Date.now()
    const maturityDay = bet.targetDate
        ? (new Date(bet.targetDate).getTime() - now) / (1000 * 60 * 60 * 24)
        : 30

    // Calculate most recent evidence age
    const mostRecentDays = Math.min(
        ...evidence.map((e) => (now - new Date(e.capturedAt).getTime()) / (1000 * 60 * 60 * 24))
    )

    // Bet is failing if significant confidence drop relative to maturity window
    const confidenceDelta = bet.currentConfidence - bet.initialConfidence
    const failureThreshold = maturityDay > 90 ? -25 : maturityDay > 30 ? -20 : -15
    if (confidenceDelta <= failureThreshold) return 'failing'

    // Bet is stale no recent evidence relative to maturity window
    const stalenessThreshold = Math.min(maturityDay * 0.3, 30) // 30% of time to target, max 30 days
    if (mostRecentDays > stalenessThreshold) return 'stale'

    // Bet is dormant if it has evidence but it's old and the bet is a long way from maturity
    if (mostRecentDays > 60 && maturityDay > 60) return 'dormant'

    // Otherwise bet is alive
    return 'active'
}
