import type { Bet, Source } from 'schema'
import { drydock } from 'services/drydock.svelte'
import { wingman } from 'services/wingman.svelte'

// Random id generator because Tauri does not use crypto
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// TODO: Maturity and completion is entirely bound to Chronicle style right now
/**
 * Used for the floating envelope notifier in mission control view
 * And as a getter in the Outbox route
 * @returns Any bets that pass all of wingman's score checks as ready to publish content on
 */
export function blogReady(): Bet[] {
    return drydock.bets.filter((bet) => {
        const maturity = wingman.letItCook(bet.id)
        const searchCampaign = wingman.keywordHealth(bet.id)
        const echoChamber = wingman.sourceTriangulation(bet.id)
        const plot = wingman.narrativeShape(bet.id)

        return (
            maturity.healthy &&
            searchCampaign.healthy &&
            echoChamber.healthy &&
            plot.healthy &&
            bet.missionStatus !== 'published'
        )
    })
}

// So far only used in Evidence forms to re-score evidence weights
export function boostCredibility(
    source: Source,
    sourceCredibility: 'high' | 'medium' | 'low'
): number {
    const boosts: Record<Source, number> = {
        github: 0,
        docs: 0,
        blog: 1,
        bluesky: 0,
        hackernews: 0,
        twitter: -1,
        discord: -1,
        other: 0,
        conversation: 0,
        'client-work': 0,
    }

    let boost = boosts[source] || 0

    if (source === 'conversation' || source === 'client-work') {
        if (sourceCredibility === 'high') boost = 2
        else if (sourceCredibility === 'medium') boost = 1
        else boost = 0
    }

    return boost
}

