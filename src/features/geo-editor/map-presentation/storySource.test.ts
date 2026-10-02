import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { resolveRoutedStoryPresentation } from './storySource'

const pubkey = 'a'.repeat(64)
const story = { kind: ARTICLE_KIND, pubkey, dTag: 'field:notes', id: 'original' } as Article
const naddr = nip19.naddrEncode({ kind: ARTICLE_KIND, pubkey, identifier: story.dTag ?? '' })
const route = { focusType: 'story' as const, naddr }

describe('route-owned Story presentation', () => {
	test('keeps the source when geometry inspection clears the Story inspector', () => {
		expect(resolveRoutedStoryPresentation(route, [story], story)).toBe(story)
		expect(resolveRoutedStoryPresentation(route, [story], null)).toBe(story)
	})

	test('matches relay-hinted addresses by exact kind, author and identifier', () => {
		const hinted = nip19.naddrEncode({
			kind: ARTICLE_KIND,
			pubkey,
			identifier: story.dTag ?? '',
			relays: ['wss://example.test'],
		})
		expect(resolveRoutedStoryPresentation({ ...route, naddr: hinted }, [story], null)).toBe(story)
		expect(
			resolveRoutedStoryPresentation(
				route,
				[{ ...story, pubkey: 'b'.repeat(64) } as Article],
				null,
			),
		).toBeNull()
		expect(
			resolveRoutedStoryPresentation(route, [{ ...story, dTag: 'other' } as Article], null),
		).toBeNull()
	})

	test('uses the latest inventory revision over the previously inspected one', () => {
		const replacement = { ...story, id: 'replacement' } as Article
		expect(resolveRoutedStoryPresentation(route, [replacement], story)).toBe(replacement)
	})

	test('only bridges an explicitly inspected Story with the same address', () => {
		expect(resolveRoutedStoryPresentation(route, [], story)).toBe(story)
		expect(
			resolveRoutedStoryPresentation(route, [], { ...story, dTag: 'other' } as Article),
		).toBeNull()
	})

	test('releases the source when leaving the Story route', () => {
		expect(
			resolveRoutedStoryPresentation({ ...route, focusType: 'none' }, [story], story),
		).toBeNull()
		expect(resolveRoutedStoryPresentation({ focusType: 'story' }, [story], story)).toBeNull()
		expect(
			resolveRoutedStoryPresentation({ ...route, naddr: 'invalid' }, [story], story),
		).toBeNull()
		const mapAddress = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey,
			identifier: story.dTag ?? '',
		})
		expect(
			resolveRoutedStoryPresentation({ ...route, naddr: mapAddress }, [story], story),
		).toBeNull()
	})
})
