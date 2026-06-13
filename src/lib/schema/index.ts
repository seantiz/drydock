// src/lib/schema.ts
export type Source =
    | 'github'
    | 'discord'
    | 'hackernews'
    | 'twitter'
    | 'bluesky'
    | 'docs'
    | 'blog'
    | 'conversation'
    | 'client-work'
    | 'other'

export type Sentiment = 'supports' | 'refutes' | 'neutral'

export type MissionStatus = 'active' | 'dormant' | 'stale' | 'failing' | 'ready' | 'published'

// WARN: This is stored as a JSON TEXT on the db file - be sure to always process Date types with Date() in runtime
export interface BetFirehoseFilters {
    enabled: boolean
    keywords: string[]
    lastPollTime?: Date
    strategyUpdated?: boolean
}

// TODO: We still have yet to really decide what we're trying to book here in real day-to-day use
// Is it a bet, a prediction or a proposition?
export interface Bet {
    id: string
    codename: string
    claim: string
    description: string
    provesRight?: string
    provesWrong?: string
    madeAt: Date
    targetDate?: Date
    initialConfidence: number
    currentConfidence: number
    missionStatus: MissionStatus
    blogPostUrl?: string
    firehoseFilters?: BetFirehoseFilters
    topic: TopicNature
    publications?: Publication[]
}

/**
 * capturedAt is local to our app - when we created the new pieced of Evidence
 * sourcedCreatedAt is pulled from external API - e.g. Bluepost post authored date
 * We could be capturing evidence from a backdated social media post
 * But in all cases our LOCAL evidence cannot be backdated beyond
 * its LOCAL parent bet's timeline start date
 */
export interface Evidence {
    id: string
    betId: string
    source: Source
    url: string
    title: string
    snippet: string
    capturedAt: Date
    sourceCreatedAt?: Date
    sentiment?: Sentiment
    weight: number
    timesUsed: number
    language?: 'rust' | 'typescript' | 'svelte' | 'other'
    coastlineId?: string
}

export type ConcernSource = 'issue' | 'discussion' | 'pr' | 'release'

export type Concern = 'debate' | 'attempt' | 'ship'

export interface Coastline {
    id: string
    name: string
    repoUrl: string
    owner: string
    repo: string
    description?: string
    lastFetchedAt?: Date
    createdAt: Date
}

export interface ConcernSourceMeta {
    id: string
    coastlineId: string
    concernSource: ConcernSource
    concern: Concern
    externalId?: string
    title?: string
    body?: string
    url?: string
    state?: string
    author?: string
    createdAtSource?: Date
    updatedAtSource?: Date
    fetchedAt: Date
    refs?: string[]
    labels?: string[]
    footprint?: Record<string, unknown>
}

/**
A blip comes in through the Firehose 
at which point it can turn out to be evidence, chatter or be discarded
*/
export interface Blip {
    id: string
    betId: string
    source: 'bluesky' | 'hackernews'
    postUri: string
    author: string
    authorAvatar?: string
    text: string
    createdAt: Date
    capturedAt: Date
    expiresAt: Date
    keywordMatches: number
    postUrl: string
}

export interface ContentExport {
    type: 'thread' | 'blog' | 'markdown'
    betId: string
    generatedAt: Date
    content: string
}

/* User Profile types */
export type UserPlatform = 'bluesky' | 'instagram' | 'blog' | 'linkedin'

export type Media = 'bluesky-post' | 'bluesky-thread' | 'instagram' | 'blog' | 'linkedin'

export type NarrativeStyle = 'chronicle' | 'reckoning' | 'witness'

export type TargetAudience = 'technical' | 'general' | 'hottakes' | 'evergreen'

export interface CreatorSettings {
    id: string
    mainPlatform: UserPlatform
    voice: NarrativeStyle
    audience: TargetAudience
    platforms: UserPlatform[]
    createdAt: Date
    updatedAt: Date
}

type ForChronicle =
    | 'unexpected_connection'
    | 'pattern_hunters'
    | 'underground_current'
    | 'assumptions_collide'
    | 'unraveling'
    | 'new_map'

type ForReckoning = 'the_consensus' | 'the_case_for' | 'the_crack' | 'the_case_against' | 'outcome'

type ForWitness = 'proposition' | 'observation' | 'conclusion'

export type BlockHeaders = ForChronicle | ForReckoning | ForWitness

export const ROLE_LABELS = {
    chronicle: {
        unexpected_connection: 'The Unexpected Connection',
        pattern_hunters: 'The Pattern Hunters',
        underground_current: 'The Underground Current',
        assumptions_collide: 'When Assumptions Collide',
        unraveling: 'The Unraveling',
        new_map: 'The New Map',
    } satisfies Record<ForChronicle, string>,
    reckoning: {
        the_consensus: 'The Consensus',
        the_case_for: 'The Case For',
        the_crack: 'The Crack',
        the_case_against: 'The Case Against',
        outcome: 'The Outcome',
    } satisfies Record<ForReckoning, string>,
    witness: {
        proposition: 'Proposition',
        observation: 'Observation',
        conclusion: 'Conclusion',
    } satisfies Record<ForWitness, string>,
}

export interface EvidenceChip {
    evidenceId: string
    title: string
    snippet: string
    sentiment: 'supports' | 'refutes' | 'neutral'
    confidence: number // 0-1, LLM assigned
}

export interface Block {
    id: string // stable generateId()
    role: BlockHeaders
    heading: string // LLM-generated heading (user can edit)
    content: string // LLM kickstart prose (user expands)
    evidenceChips: EvidenceChip[] // LLM-suggested evidence, user can add/remove
    position: number // 0-based, determines display order
}

export interface Publication {
    id: string
    betId: string
    format: Media
    generatedAt: Date
    content: string
    postedUrl?: string
    blocks?: Block[]
}

/* Topical Profile types */
export type Frequency = 'high' | 'low'
export type Confidence = 'high' | 'low'

export interface TopicNature {
    frequency: Frequency
    confidence: Confidence
    reasoning?: string
}

export const TOPIC_LABELS: Record<
    `${Frequency}-${Confidence}`,
    { label: string; explanation: string }
> = {
    'high-high': {
        label: 'Trending',
        explanation: `Expect fresh evidence everywhere. Reddit threads from this week, GitHub issues still open, Discord channels actively debating. Numbers change monthly - star counts, download stats, poll results. Your evidence will have recent timestamps and you'll need to keep collecting as things shift.`,
    },
    'high-low': {
        label: 'Hot Topic',
        explanation: `Evidence keeps flowing but it contradicts itself. You'll find blog posts from last month arguing opposite sides. Twitter threads where people keep changing their minds. No consensus forming despite lots of chatter. Track the mood swings, not hard data.`,
    },
    'low-high': {
        label: 'Specialist',
        explanation: `Evidence appears in big chunks with long gaps. A spec document from 6 months ago, then silence until a release announcement. Reddit threads from a year back that nobody's challenged. When new evidence drops, it's definitive - version bumps, RFCs merged, browser support tables updated.`,
    },
    'low-low': {
        label: 'Niche',
        explanation: `You'll dig through old conference talks and 2-year-old blog posts. Reddit threads with no recent activity because the question isn't settled enough to fight about. Evidence is scattered, contradictory, and stale. Nobody's tracking this with metrics - just vague industry vibes shifting over years.`,
    },
}


/**
 * Inbox entries are a sum of either signals pulled from social media or manually promoted chatter
 * @param sourceSignalId - only guaranteed to be written when collected from social media
 * @param frequency - topic frequency (same guarantees)
 * @param confidence - topic confidence (same guarantees)
 */

/**
 * A promoted chatter entry for Drydock product.
 * @param frequency - topic frequency
 * @param confidence - topic confidence
 */

export type NetworkPostSource = 'bluesky' | 'hackernews'

export interface NetworkPost {
    source: NetworkPostSource
    uri: string
    author_handle: string
    author_avatar?: string // absent on HN
    text: string
    created_at: string
    // Bluesky / Twitter-style
    replies?: number
    reposts?: number
    likes?: number
    quoted?: number
    // HN-style
    score?: number
    descendants?: number // total comment count
    post_url: string
}

// Developer Mode Logs



// Cold-start problem management
export const SEED_BETS: Omit<Bet, 'id' | 'madeAt' | 'currentConfidence'>[] = [
    {
        codename: 'Hunt for Red Svelte',
        claim: 'Frameworks hide complexity rather than eliminate it',
        description:
            "Pattern: rewrites trade visible complexity for invisible (melt-ui: file sprawl → type graphs, Next.js: App Router confusion). New feature announcements often wrap existing tools with proprietary APIs (SvelteKit Remote Functions = tRPC). Scan: when framework claims 'simpler', ask where complexity moved. When they add 'native' feature, check if it's just a wrapper.",
        initialConfidence: 85,
        missionStatus: 'active',
        topic: { frequency: 'low', confidence: 'low' },
    },
    {
        codename: 'Security Theatre',
        claim: 'Type safety without boundary validation creates false confidence',
        description:
            "Pattern: compile-time guarantees (branded types, generic bounds, error enums) evaporate at system boundaries. Teams ship 'impossible' bugs because they trusted the types but didn't validate inputs. Applies to static languages only. Scan: look for type complexity WITHOUT runtime guards (Zod, parser combinators, newtype constructors that validate). Evidence: TypeScript branded types at API boundaries, Rust newtypes without validation, deep trait bounds with <40% test coverage.",
        initialConfidence: 80,
        missionStatus: 'active',
        topic: { frequency: 'low', confidence: 'low' },
    },
    {
        codename: 'Political Offload',
        claim: 'Multiple blessed patterns mean the framework exported their design problem to you',
        description:
            "Pattern: 2-3 'official' ways to solve same thing = framework couldn't decide, so you burn hours per feature debating approaches. It's not flexibility, it's architectural debt dumped downstream. Scan: count official patterns for core tasks (data fetching, state management) - if 3+, framework has strategy problem. Evidence: SvelteKit (3 data patterns), PE scaling tax (dual implementations).",
        initialConfidence: 80,
        missionStatus: 'active',
        topic: { frequency: 'low', confidence: 'low' },
    },
    {
        codename: 'Composition Over Opinion',
        claim: 'Middleware systems stay adaptable, opinionated frameworks fossilize',
        description:
            "Pattern: composable layers (tower/axum, Effect-TS) let you add structure incrementally. Opinionated frameworks force upfront decisions that become prisons. Scan: does it compose or prescribe? Can you add patterns later without fighting the framework? Evidence: tower layers, Effect adoption rising, framework 'example gaps' revealing limitations.",
        initialConfidence: 75,
        missionStatus: 'active',
        topic: { frequency: 'low', confidence: 'low' },
    },
    {
        codename: 'Ecosystem Fragmentation',
        claim: "Dominant libraries fragment when 'X but faster' forks emerge during standardization",
        description:
            "Pattern: successful library spawns performance alternatives (Valibot vs Zod) while standards bodies debate native equivalents (TC39 validation). Adoption becomes minefield - pick the wrong fork and you're stranded. Scan: check for performance forks AND standards proposals when library crosses ~100k weekly. Evidence: Zod ecosystem, Effect rising, adapter complexity revealing abstraction leaks.",
        initialConfidence: 70,
        missionStatus: 'active',
        topic: { frequency: 'low', confidence: 'low' },
    },
]

// OCEAN VIEW TYPES

export interface StreamData {
    bet: Bet
    pathId: string
    color: string
    eDots: EvidenceDot[]
    pDots: PublicationDot[]
    arcCompletedAt: Date | null
    originX: number
    originY: number
    destX: number
    destY: number
    length: number
    width: number
    days: number
}

// TODO: Right now we're using this purely for dormant submarine icon placement
export interface EvidenceDot {
    source: Evidence
    jitter: number
}

export interface PublicationDot {
    source: Publication
    jitter: number
    isDraft: boolean
}
