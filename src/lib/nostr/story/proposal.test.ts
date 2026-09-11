import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { EventTemplate, NostrEvent } from 'applesauce-core/helpers/event'
import type { EventSigner } from 'applesauce-core/factories/types'
import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND, GEO_EDIT_PROPOSAL_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import type { ArticleContent } from '@/lib/nostr/article/helpers'

// Same isolated publish seam as lifecycle.test.ts: no relay or account mutation.
const publishSpy = mock(async (_event: NostrEvent, _options: { routing: string }) => {})
mock.module('@/lib/nostr', () => ({ publish: publishSpy }))
let proposeStoryEdit: typeof import('./proposal').proposeStoryEdit
beforeAll(async () => {
	proposeStoryEdit = (await import('./proposal')).proposeStoryEdit
})

const OWNER = 'd'.repeat(64)
const CONTRIBUTOR = 'a'.repeat(64)
const MAP_OWNER = 'b'.repeat(64)
const MAP_SOURCE = `37515:${MAP_OWNER}:battle-map`
const MAP_MENTION = `nostr:${nip19.naddrEncode({ kind: 37515, pubkey: MAP_OWNER, identifier: 'battle-map' })}`
const opening = {
	version: 1,
	layers: [{ id: 'battle-sites', source: MAP_SOURCE, visible: true, opacityMultiplier: 1 }],
}
const originalContent = {
	modelVersion: MODEL_VERSION,
	title: 'Original title',
	summary: 'Original summary',
	image: 'https://example.com/cover.jpg',
	publishedAt: 123,
	content: `${MAP_MENTION}\n\nOriginal prose.`,
	presentation: opening,
}
function sourceStory(content: ArticleContent = originalContent): NostrEvent {
	return {
		kind: ARTICLE_KIND,
		pubkey: OWNER,
		created_at: 456,
		id: 'f'.repeat(64),
		sig: 'c'.repeat(128),
		tags: [['d', 'story:original']],
		content: JSON.stringify(content),
	}
}
const signSpy = mock(
	async (draft: EventTemplate): Promise<NostrEvent> => ({
		...draft,
		pubkey: CONTRIBUTOR,
		id: 'e'.repeat(64),
		sig: 'c'.repeat(128),
	}),
)
const signer: EventSigner = { getPublicKey: () => CONTRIBUTOR, signEvent: signSpy }
beforeEach(() => {
	signSpy.mockClear()
	publishSpy.mockClear()
})

describe('proposeStoryEdit', () => {
	test('sends only a raw-Markdown proposal targeting the original Story and captured base', async () => {
		const view =
			'```earthly-view\n{"version":1,"type":"view","id":"closer","title":"Closer","display":"both","camera":{"center":[2,49],"zoom":10},"layers":{"battle-sites":{"opacityMultiplier":0.5}}}\n```'
		const body = `${MAP_MENTION}\n\nProposed prose.\n\n${view}`
		const original = sourceStory()
		const signed = await proposeStoryEdit(original, { content: body }, signer)
		expect(signed.kind).toBe(GEO_EDIT_PROPOSAL_KIND)
		expect(signed.pubkey).toBe(CONTRIBUTOR)
		expect(signed.content).toBe(body)
		expect(signed.tags).toContainEqual(['a', `${ARTICLE_KIND}:${OWNER}:story:original`])
		expect(signed.tags).toContainEqual(['p', OWNER])
		expect(signed.tags).toContainEqual(['base-version', original.id])
		expect(signSpy).toHaveBeenCalledTimes(1)
		expect(signSpy.mock.calls[0]?.[0].kind).toBe(GEO_EDIT_PROPOSAL_KIND)
		expect(publishSpy).toHaveBeenCalledTimes(1)
		expect(publishSpy).toHaveBeenCalledWith(signed, { routing: 'outbox' })
		expect(JSON.parse(original.content)).toEqual(originalContent)
	})

	test('accepts unchanged metadata and structurally equal reordered opening data', async () => {
		const reorderedOpening = {
			layers: [{ opacityMultiplier: 1, visible: true, source: MAP_SOURCE, id: 'battle-sites' }],
			version: 1,
		}
		await expect(
			proposeStoryEdit(
				sourceStory(),
				{
					...originalContent,
					content: `${MAP_MENTION}\n\nNew prose.`,
					presentation: reorderedOpening,
				},
				signer,
			),
		).resolves.toMatchObject({ kind: GEO_EDIT_PROPOSAL_KIND })
	})

	test.each([
		['title', 'Changed title'],
		['summary', 'Changed summary'],
		['image', undefined],
		['publishedAt', 999],
		['presentation', { version: 1, layers: [] }],
	] as const)('rejects explicit %s changes before signing or publishing', async (key, value) => {
		await expect(
			proposeStoryEdit(
				sourceStory(),
				{ content: `${MAP_MENTION}\n\nNew prose.`, [key]: value },
				signer,
			),
		).rejects.toThrow(new RegExp(`Changes to ${key}`))
		expect(signSpy).not.toHaveBeenCalled()
		expect(publishSpy).not.toHaveBeenCalled()
	})

	test('preserves omitted opaque future presentation without putting it in the body payload', async () => {
		const future = { ...originalContent, presentation: { version: 12, future: { keep: true } } }
		const signed = await proposeStoryEdit(
			sourceStory(future),
			{ content: 'New narrative only.' },
			signSpy,
		)
		expect(signed.content).toBe('New narrative only.')
		expect(signed.kind).toBe(GEO_EDIT_PROPOSAL_KIND)
	})

	test('validates new references and view targets against the original opening before signing', async () => {
		for (const body of [
			'A body that removes the opening-layer authorization.',
			`${MAP_MENTION}\n\n\`\`\`earthly-view\n{"version":1,"type":"view","id":"unknown","title":"Unknown","display":"cue","layers":{"new-layer":{"visible":true}}}\n\`\`\``,
		]) {
			await expect(proposeStoryEdit(sourceStory(), { content: body }, signer)).rejects.toThrow()
		}
		expect(signSpy).not.toHaveBeenCalled()
		expect(publishSpy).not.toHaveBeenCalled()
	})

	test('rejects empty bodies and non-Story targets before signing', async () => {
		await expect(proposeStoryEdit(sourceStory(), { content: '   ' }, signer)).rejects.toThrow(
			/narrative/,
		)
		await expect(
			proposeStoryEdit({ ...sourceStory(), kind: 1 }, { content: 'Body' }, signer),
		).rejects.toThrow(/not a Story/)
		expect(signSpy).not.toHaveBeenCalled()
		expect(publishSpy).not.toHaveBeenCalled()
	})

	test('never publishes an Article even if a signer returns the wrong event kind', async () => {
		await expect(
			proposeStoryEdit(
				sourceStory(),
				{ content: `${MAP_MENTION}\n\nNew prose.` },
				{ getPublicKey: () => CONTRIBUTOR, signEvent: () => sourceStory() },
			),
		).rejects.toThrow(/modified event kind/)
		expect(publishSpy).not.toHaveBeenCalled()
	})
})
