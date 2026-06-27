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

beforeAll(async () => {
	const mod = await import('./lifecycle')
	publishStory = mod.publishStory
	editStory = mod.editStory
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
})
