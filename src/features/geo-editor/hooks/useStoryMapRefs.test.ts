import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { Article } from '@/lib/nostr/article'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { parseStoryRefs } from './useStoryMapRefs'

// A Story exposes its `a`-tag coordinates via `referencedAddresses`. parseStoryRefs
// turns those into map-stack identities. The key derivation MUST match
// getDatasetKey(dataset) === `${pubkey}:${datasetId}` so the explicit inline
// eye-toggle and the map operate on the same entry.

const PK = 'a'.repeat(64)

function fakeStory(referencedAddresses: string[], title = 'A Story', content = ''): Article {
	return {
		referencedAddresses,
		pubkey: PK,
		dTag: 'story-1',
		article: { title, content },
	} as unknown as Article
}

/** The carrier provenance every parsed ref carries — see MapStackEntryVia. */
const STORY_VIA = {
	entityType: 'story' as const,
	entityKey: `${PK}:story-1`,
	title: 'A Story',
}

describe('parseStoryRefs', () => {
	test('returns [] for a null story', () => {
		expect(parseStoryRefs(null)).toEqual([])
	})

	test('keeps exact feature selectors from inline Story references', () => {
		const naddr = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey: PK,
			identifier: 'east-german-travel',
		})
		const coordinate = `${GEO_EVENT_KIND}:${PK}:east-german-travel`
		const refs = parseStoryRefs(
			fakeStory(
				[coordinate],
				'A Story',
				`Crossing nostr:${naddr}#relation%2F62504 and nostr:${naddr}#checkpoint-alpha.`,
			),
		)
		expect(refs.map((ref) => ref.featureId)).toEqual(['relation/62504', 'checkpoint-alpha'])
		expect(refs[0]?.entryId).toContain('relation%2F62504')
	})

	test('derives dataset key + entry id from a 37515 coordinate', () => {
		const refs = parseStoryRefs(fakeStory([`${GEO_EVENT_KIND}:${PK}:river-segments`]))
		expect(refs).toHaveLength(1)
		expect(refs[0]).toEqual({
			coord: `${GEO_EVENT_KIND}:${PK}:river-segments`,
			pubkey: PK,
			identifier: 'river-segments',
			datasetKey: `${PK}:river-segments`,
			entryId: `dataset:${PK}:river-segments`,
			via: STORY_VIA,
		})
	})

	test('stamps carrier provenance (via) so the Map Stack nests refs under the story', () => {
		const refs = parseStoryRefs(
			fakeStory([`${GEO_EVENT_KIND}:${PK}:x`, `${GEO_EVENT_KIND}:${PK}:y`]),
		)
		expect(refs).toHaveLength(2)
		for (const ref of refs) {
			expect(ref.via).toEqual(STORY_VIA)
		}
	})

	test('via title falls back to the d-tag when the story has no title', () => {
		const refs = parseStoryRefs(fakeStory([`${GEO_EVENT_KIND}:${PK}:x`], ''))
		expect(refs[0]?.via.title).toBe('story-1')
	})

	test('preserves d-tags that contain colons', () => {
		const refs = parseStoryRefs(fakeStory([`${GEO_EVENT_KIND}:${PK}:a:b:c`]))
		expect(refs[0]?.identifier).toBe('a:b:c')
		expect(refs[0]?.datasetKey).toBe(`${PK}:a:b:c`)
	})

	test('drops non-37515 (e.g. context/story) coordinates and malformed entries', () => {
		const refs = parseStoryRefs(
			fakeStory([
				`37518:${PK}:some-context`, // wrong kind
				`${GEO_EVENT_KIND}:${PK}:keep`, // valid
				'not-a-coordinate', // malformed
				`${GEO_EVENT_KIND}::no-pubkey`, // empty pubkey
			]),
		)
		expect(refs.map((r) => r.identifier)).toEqual(['keep'])
	})
})
