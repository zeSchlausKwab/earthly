import { describe, expect, test } from 'bun:test'
import type { Article } from '@/lib/nostr/article'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { parseStoryRefs } from './useStoryMapRefs'

// A Story exposes its `a`-tag coordinates via `referencedAddresses`. parseStoryRefs
// turns those into map-stack identities. The key derivation MUST match
// getDatasetKey(dataset) === `${pubkey}:${datasetId}` so the auto-stacked entry
// and the inline eye-toggle operate on the same map-stack entry.

function fakeStory(referencedAddresses: string[]): Article {
	return { referencedAddresses } as unknown as Article
}

const PK = 'a'.repeat(64)

describe('parseStoryRefs', () => {
	test('returns [] for a null story', () => {
		expect(parseStoryRefs(null)).toEqual([])
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
		})
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
