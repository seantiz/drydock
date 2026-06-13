import { invoke } from '@tauri-apps/api/core'
import type { Drydock } from '../drydock.svelte.ts'
import type { Block, Media, Publication } from '$lib/schema/'
import { generateId } from '$lib/utils'

export class Publisher {
    history = $state<Publication[]>([])

    constructor(private dock: Drydock) {}

    async refresh() {
        const db = await this.dock.getDb()

        const pubs = await db.select('SELECT * FROM publications ORDER BY generated_at DESC')

        this.history = (pubs as any[]).map((row) => ({
            id: row.id,
            betId: row.prediction_id,
            format: row.format as Media,
            generatedAt: new Date(row.generated_at),
            content: row.content,
            postedUrl: row.posted_url || undefined,
            blocks: row.blocks ? JSON.parse(row.blocks) : undefined,
        }))
    }

    whatsBeenPublishedOn(betId: string): Publication[] {
        return this.history.filter((publication) => publication.betId === betId)
    }

    async saveDraft(betId: string, format: Media, content: string): Promise<string> {
        const db = await this.dock.getDb()
        const id = generateId()

        await db.execute(
            `INSERT INTO publications (id, prediction_id, format, generated_at, content)
             VALUES (?, ?, ?, ?, ?)`,
            [id, betId, format, new Date().toISOString(), content]
        )

        await this.dock.refresh()
        return id
    }

    async syncUI(betId: string, blocks: Block[], markdownContent: string): Promise<string> {
        const db = await this.dock.getDb()
        const id = generateId()

        await db.execute(
            `INSERT INTO publications (id, prediction_id, format, generated_at, content, blocks)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, betId, 'blog', new Date().toISOString(), markdownContent, JSON.stringify(blocks)]
        )

        await this.dock.refresh()
        return id
    }

    async updateUI(publicationId: string, blocks: Block[]): Promise<void> {
        const db = await this.dock.getDb()
        const markdownContent = blocks
            .sort((a, b) => a.position - b.position)
            .map((b) => `## ${b.heading}\n\n${b.content}`)
            .join('\n\n')

        await db.execute(`UPDATE publications SET blocks=?, content=? WHERE id=?`, [
            JSON.stringify(blocks),
            markdownContent,
            publicationId,
        ])

        const pub = this.history.find((p) => p.id === publicationId)
        if (pub) {
            pub.blocks = blocks
            pub.content = markdownContent
        }
    }

    async publish(publicationId: string, url: string): Promise<void> {
        const db = await this.dock.getDb()
        await db.execute(`UPDATE publications SET posted_url = ? WHERE id = ?`, [
            url,
            publicationId,
        ])

        const pub = this.history.find((p) => p.id === publicationId)
        const evidenceIds = [
            ...new Set(
                (pub?.blocks ?? []).flatMap((b) => b.evidenceChips.map((c) => c.evidenceId))
            ),
        ]
        if (evidenceIds.length > 0) {
            await invoke('batter_up', { evidenceIds })
        }

        await this.dock.refresh()
    }

    async delete(publicationId: string): Promise<void> {
        const db = await this.dock.getDb()
        await db.execute('DELETE FROM publications WHERE id = ?', [publicationId])
        await this.dock.refresh()
    }
}
