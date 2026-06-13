// Wingman - the 5-vector health service that watches your back
// Consider making drydock props private when they're not used here
import type { Evidence, UserPlatform, Bet, TopicNature, CreatorSettings } from '../schema'
import { drydock } from './drydock.svelte'

class Wingman {
    // Vector 1: Are you publishing too early for this topic's maturation timeline?
    letItCook(betId: string): { healthy: boolean; reason: string; daysRemaining?: number } {
        const bet: Bet | undefined = drydock.bets.find((b) => b.id === betId)
        if (!bet) return { healthy: false, reason: 'Bet not found' }

        const evidence: Evidence[] = drydock.evidenceFor(betId)
        if (evidence.length === 0) {
            return { healthy: false, reason: 'No evidence yet - let it cook' }
        }

        const creator: CreatorSettings | null = drydock.creator
        const voice = creator?.voice ?? 'chronicle'

        if (voice === 'reckoning') {
            const hasRefuting = evidence.some((e) => e.sentiment === 'refutes')
            if (!hasRefuting) {
                return {
                    healthy: false,
                    reason: 'Reckoning needs refuting evidence before the antithesis can be scaffolded',
                }
            }
        }

        if (voice === 'witness') {
            // Witness cooks on recency, not timespan — most recent evidence must be within 14 days
            const mostRecent = Math.max(...evidence.map((e) => new Date(e.capturedAt).getTime()))
            const daysSinceLastEvidence = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24)
            if (daysSinceLastEvidence > 14) {
                return {
                    healthy: false,
                    reason: `Most recent evidence is ${Math.floor(daysSinceLastEvidence)} days old — witness dispatches need fresh signal`,
                    daysRemaining: Math.ceil(daysSinceLastEvidence - 14),
                }
            }
            return { healthy: true, reason: 'Evidence is fresh enough to dispatch' }
        }

        // Chronicle and reckoning: check evidence timespan against platform cycle time
        const sorted = [...evidence].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
        const firstEvidence = new Date(sorted[0].capturedAt).getTime()
        const lastEvidence = new Date(sorted[sorted.length - 1].capturedAt).getTime()
        const monthsOfEvidence = (lastEvidence - firstEvidence) / (1000 * 60 * 60 * 24 * 30)

        const platformCycleMonths = this.getPlatformCycleTime(creator?.mainPlatform)

        if (monthsOfEvidence < platformCycleMonths) {
            const daysShort = (platformCycleMonths - monthsOfEvidence) * 30
            return {
                healthy: false,
                reason: `Evidence spans ${monthsOfEvidence.toFixed(1)} months, need ${platformCycleMonths} for ${creator?.mainPlatform || 'blog'}`,
                daysRemaining: Math.ceil(daysShort),
            }
        }

        return { healthy: true, reason: 'Evidence has cooked long enough' }
    }

    // Vector 2: Portfolio cognitive load - are you overextended?
    checkCapacity = $derived.by(() => {
        const activeBets: Bet[] = drydock.bets.filter(
            (b) => b.missionStatus != 'published' && b.missionStatus != 'dormant'
        )

        const now = Date.now()
        const avgMaturationDays =
            activeBets.reduce((sum, bet) => {
                const daysUntilTarget = bet.targetDate
                    ? (new Date(bet.targetDate).getTime() - now) / (1000 * 60 * 60 * 24)
                    : 90
                return sum + daysUntilTarget
            }, 0) / (activeBets.length || 1)

        let capacity = 8
        if (avgMaturationDays > 180) capacity = 4
        else if (avgMaturationDays > 90) capacity = 6
        else if (avgMaturationDays <= 30) capacity = 12

        const healthy = activeBets.length <= capacity
        const atCapacity = activeBets.length === capacity
        const overCapacity = activeBets.length > capacity

        return {
            healthy,
            atCapacity,
            reason: overCapacity
                ? "You're overextended, let some bets rest"
                : atCapacity
                  ? "You've got your plate full"
                  : 'You have room to breathe',
            activeBets: activeBets.length,
            capacity,
        }
    })

    // Vector 3: Is your keyword strategy working for this topic?
    keywordHealth(betId: string): { healthy: boolean; reason: string; suggestion?: string } {
        const bet: Bet | undefined = drydock.bets.find((b) => b.id === betId)
        if (!bet?.firehoseFilters?.enabled) {
            return { healthy: true, reason: 'Firehose not enabled' }
        }

        const signals = drydock.blipsFor(betId)
        const topic: TopicNature | undefined = bet.topic

        // High-frequency topics should have lots of matches
        // Low-frequency topics should have few, specific matches
        if (topic?.frequency === 'high' && signals.length > 30) {
            return {
                healthy: false,
                reason: 'Hot topic drowning in matches - tighten keywords',
                suggestion: 'Use more specific phrase combinations',
            }
        }

        if (topic?.frequency === 'low' && signals.length === 0) {
            return {
                healthy: false,
                reason: 'Niche topic getting no matches - broaden keywords',
                suggestion: 'Try related terms or less specific phrases',
            }
        }

        return { healthy: true, reason: 'Keyword strategy looks good' }
    }

    // Vector 4: Source diversity - echo chamber check
    sourceTriangulation(betId: string): { healthy: boolean; reason: string; sources: string[] } {
        const evidence: Evidence[] = drydock.evidenceFor(betId)
        if (evidence.length === 0) {
            return { healthy: false, reason: 'No evidence yet', sources: [] }
        }

        // Count unique sources
        const sources = new Set(evidence.map((e) => e.source))
        const uniqueSources = Array.from(sources)

        // For Bluesky evidence, also check unique authors
        const blueskyEvidence = evidence.filter((e) => e.source === 'bluesky')
        const blueskyAuthors = new Set(
            blueskyEvidence
                .map((e) => {
                    // Extract author from title like "Post by @username"
                    const match = e.title.match(/@(\w+)/)
                    return match ? match[1] : null
                })
                .filter(Boolean)
        )

        // Triangulation rules
        const creator: CreatorSettings | null = drydock.creator

        if (creator?.mainPlatform === 'blog' || creator?.audience === 'technical') {
            // Technical blogs need diverse sources (papers, docs, code)
            if (sources.size < 3) {
                return {
                    healthy: false,
                    reason: `Only ${sources.size} source type(s) - need papers/docs/code for technical depth`,
                    sources: uniqueSources,
                }
            }
        }

        // Check for Bluesky echo chamber
        if (blueskyEvidence.length > evidence.length * 0.7 && blueskyAuthors.size < 5) {
            return {
                healthy: false,
                reason: `70%+ evidence from ${blueskyAuthors.size} Bluesky authors - echo chamber risk`,
                sources: uniqueSources,
            }
        }

        return {
            healthy: true,
            reason: `Good triangulation across ${sources.size} sources`,
            sources: uniqueSources,
        }
    }

    // Vector 5: Do you have the right sentiment distribution for your narrative tone?
    narrativeShape(betId: string): {
        healthy: boolean
        reason: string
        distribution: { supports: number; refutes: number; neutral: number }
    } {
        const evidence: Evidence[] = drydock.evidenceFor(betId)
        const creator: CreatorSettings | null = drydock.creator

        if (evidence.length === 0) {
            return {
                healthy: false,
                reason: 'No evidence yet',
                distribution: { supports: 0, refutes: 0, neutral: 0 },
            }
        }

        // Count sentiment distribution
        const distribution = evidence.reduce(
            (acc, e) => {
                if (e.sentiment === 'supports') acc.supports++
                else if (e.sentiment === 'refutes') acc.refutes++
                else acc.neutral++
                return acc
            },
            { supports: 0, refutes: 0, neutral: 0 }
        )

        // Check based on narrative voice
        if (creator?.voice === 'reckoning') {
            if (distribution.supports === 0 || distribution.refutes === 0) {
                return {
                    healthy: false,
                    reason: 'Reckoning needs both supporting and refuting evidence for the case-for/case-against structure',
                    distribution,
                }
            }
        }

        if (creator?.voice === 'chronicle') {
            // Chronicle needs neutral context evidence for timeline narrative
            if (distribution.neutral < evidence.length * 0.4) {
                return {
                    healthy: false,
                    reason: 'Chronicle needs more neutral/contextual evidence for timeline',
                    distribution,
                }
            }
        }

        // Must have at least SOME polarity (not all neutral)
        if (distribution.supports === 0 && distribution.refutes === 0) {
            return {
                healthy: false,
                reason: 'Need polarized evidence (supports OR refutes), not just context',
                distribution,
            }
        }

        return {
            healthy: true,
            reason: 'Good narrative shape for your voice',
            distribution,
        }
    }

    // Helper: Get platform cycle time in months
    private getPlatformCycleTime(platform?: UserPlatform): number {
        switch (platform) {
            case 'bluesky':
                return 0.5 // 2 weeks
            case 'instagram':
                return 0.25 // 1 week
            case 'linkedin':
                return 0.5 // 2 weeks
            case 'blog':
            default:
                return 1 // 1 month
        }
    }
}

export const wingman = new Wingman()
