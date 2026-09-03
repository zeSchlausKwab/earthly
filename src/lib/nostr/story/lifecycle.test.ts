/**
 * Story lifecycle contract (STORY-03/04).
 *
 * publishStory/editStory wrap ArticleFactory and, on every publish, re-derive the
 * `a` tags from the Markdown body's inline `nostr:naddr…` refs (body = single source
 * of truth), preserve the `d`-tag lineage on edit, and exclude malformed refs without
 * throwing. No live publish — `@/lib/nostr`'s `publish` is mocked to a no-op and we
 * assert on the returned signed event template.
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

// Stub the relay publish so the lifecycle service never hits the network.
const publishSpy = mock(async (_event: NostrEvent) => {})
mock.module('@/lib/nostr', () => ({ publish: publishSpy }))

// Import AFTER the module mock so lifecycle.ts binds the stubbed `publish`.
let publishStory: typeof import('./lifecycle').publishStory
let editStory: typeof import('./lifecycle').editStory
let StoryPresentationValidationError: typeof import('./lifecycle').StoryPresentationValidationError

beforeAll(async () => {
	const mod = await import('./lifecycle')
	publishStory = mod.publishStory
	editStory = mod.editStory
	StoryPresentationValidationError = mod.StoryPresentationValidationError
})

/** Bare sign-function (EntityFactory contract) — stamps a deterministic id/pubkey/sig. */
async function bareSign(e: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}): Promise<NostrEvent> {
	return {
		...e,
		created_at: e.created_at ?? 1_700_000_000,
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	} as NostrEvent
}

const PUBKEY = 'b'.repeat(64)

/** A valid naddr coordinate + its `nostr:naddr…` body reference. */
function validRef(identifier: string): { coordinate: string; ref: string } {
	const coordinate = `${ARTICLE_KIND}:${PUBKEY}:${identifier}`
	const address = nip19.naddrEncode({ kind: ARTICLE_KIND, pubkey: PUBKEY, identifier })
	return { coordinate, ref: `nostr:${address}` }
}

function mapRef(identifier: string, featureId?: string): { coordinate: string; ref: string } {
	const coordinate = `37515:${PUBKEY}:${identifier}`
	const address = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier })
	return {
		coordinate,
		ref: `nostr:${address}${featureId ? `#${encodeURIComponent(featureId)}` : ''}`,
	}
}

function aTags(event: NostrEvent): string[] {
	return event.tags.filter((t) => t[0] === 'a').map((t) => t[1] ?? '')
}

function dTag(event: NostrEvent): string | undefined {
	return event.tags.find((t) => t[0] === 'd')?.[1]
}

/** A pre-existing well-formed Article event with a known `d`-tag for edit tests. */
function makeExistingArticle(dValue: string): NostrEvent {
	return {
		id: 'f'.repeat(64),
		pubkey: PUBKEY,
		created_at: 1_600_000_000,
		kind: ARTICLE_KIND,
		tags: [
			['d', dValue],
			['a', '37520:deadbeef:stale-ref'],
		],
		content: JSON.stringify({ modelVersion: MODEL_VERSION, title: 'Old', content: '' }),
		sig: 'c'.repeat(128),
	}
}

describe('publishStory — naddr→a re-derivation (STORY-03)', () => {
	test('one valid ref → exactly one matching a tag', async () => {
		const { coordinate, ref } = validRef('cafe-guide')
		const signed = await publishStory({ content: `Visit ${ref} today.` }, bareSign)
		expect(aTags(signed)).toEqual([coordinate])
	})

	test('malformed ref → ZERO a tags and does not throw', async () => {
		const signed = await publishStory(
			{ content: 'Broken nostr:naddr1zzzzzzzzzzzz here.' },
			bareSign,
		)
		expect(aTags(signed)).toEqual([])
	})

	test('two identical valid refs → deduped to one a tag', async () => {
		const { coordinate, ref } = validRef('dup-ref')
		const signed = await publishStory({ content: `${ref} and again ${ref}` }, bareSign)
		expect(aTags(signed)).toEqual([coordinate])
	})
})

describe('editStory — lineage + destructive re-derive (STORY-04/03)', () => {
	test('preserves the existing d tag (lineage)', async () => {
		const existing = makeExistingArticle('story-lineage-1')
		const { ref } = validRef('linked')
		const signed = await editStory(existing, { content: `Now links ${ref}` }, bareSign)
		expect(dTag(signed)).toBe('story-lineage-1')
	})

	test('refs removed since last publish → stale a tags dropped (destructive re-derive)', async () => {
		const existing = makeExistingArticle('story-lineage-2')
		// New body has NO refs → the pre-existing stale `a` tag must be gone.
		const signed = await editStory(existing, { content: 'No references anymore.' }, bareSign)
		expect(aTags(signed)).toEqual([])
	})

	test('a title-only edit preserves the authoritative body, a tags, and future presentation raw', async () => {
		const { coordinate, ref } = mapRef('future-map')
		const futurePresentation = { version: 12, layers: [{ future: true }] }
		const existing = makeExistingArticle('story-partial-edit')
		existing.content = JSON.stringify({
			modelVersion: MODEL_VERSION,
			title: 'Old',
			content: `Keep ${ref}`,
			presentation: futurePresentation,
		})

		const signed = await editStory(existing, { title: 'New' }, bareSign)
		const parsed = JSON.parse(signed.content)
		expect(parsed.title).toBe('New')
		expect(parsed.content).toBe(`Keep ${ref}`)
		expect(parsed.presentation).toEqual(futurePresentation)
		expect(aTags(signed)).toEqual([coordinate])
	})
})

describe('Story presentation publication authorization', () => {
	test('a whole-Map body mention authorizes a selective presentation layer', async () => {
		const { coordinate, ref } = mapRef('western-front')
		const signed = await publishStory(
			{
				content: `Follow ${ref}.`,
				presentation: {
					version: 1,
					layers: [{ id: 'verdun', source: coordinate, featureIds: ['verdun'] }],
				},
			},
			bareSign,
		)
		const parsed = JSON.parse(signed.content)
		expect(parsed.presentation.layers[0]).toMatchObject({
			id: 'verdun',
			visible: true,
			opacityMultiplier: 1,
		})
	})

	test('feature-only mentions reject whole-map or uncited feature requests', async () => {
		const { coordinate, ref } = mapRef('battles', 'verdun')
		const whole = publishStory(
			{
				content: `Only ${ref}.`,
				presentation: { version: 1, layers: [{ id: 'all', source: coordinate }] },
			},
			bareSign,
		)
		await expect(whole).rejects.toBeInstanceOf(StoryPresentationValidationError)
		await expect(
			publishStory(
				{
					content: `Only ${ref}.`,
					presentation: {
						version: 1,
						layers: [{ id: 'somme', source: coordinate, featureIds: ['somme'] }],
					},
				},
				bareSign,
			),
		).rejects.toMatchObject({ code: 'unauthorized-features', featureIds: ['somme'] })
	})

	test('a reference shown only inside a code fence cannot authorize a layer', async () => {
		const { coordinate, ref } = mapRef('code-example')
		await expect(
			publishStory(
				{
					content: `\`\`\`text\n${ref}\n\`\`\``,
					presentation: { version: 1, layers: [{ id: 'code', source: coordinate }] },
				},
				bareSign,
			),
		).rejects.toMatchObject({ code: 'unauthorized-source', layerId: 'code' })
	})

	test('view patches cannot target a layer outside the opening presentation', async () => {
		const { coordinate, ref } = mapRef('views')
		const view = {
			version: 1,
			type: 'view',
			id: 'bad-view',
			title: 'Bad view',
			display: 'cue',
			layers: { missing: { visible: false } },
		}
		await expect(
			publishStory(
				{
					content: `${ref}\n\n\`\`\`earthly-view\n${JSON.stringify(view)}\n\`\`\``,
					presentation: { version: 1, layers: [{ id: 'base', source: coordinate }] },
				},
				bareSign,
			),
		).rejects.toMatchObject({ code: 'unknown-view-layer' })
	})

	test('a layer-changing view also requires an opening presentation', async () => {
		const view = {
			version: 1,
			type: 'view',
			id: 'orphan-view',
			title: 'Orphan view',
			display: 'cue',
			layers: { missing: { visible: true } },
		}
		await expect(
			publishStory({ content: `\`\`\`earthly-view\n${JSON.stringify(view)}\n\`\`\`` }, bareSign),
		).rejects.toMatchObject({ code: 'unknown-view-layer' })
	})
})
