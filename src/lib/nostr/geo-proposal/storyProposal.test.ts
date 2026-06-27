/**
 * Story-proposal content-type extension (STORY-06).
 *
 * The kind-37519 proposal machinery is generalized from a FeatureCollection target
 * (dataset, kind 37515) to a Markdown-content target (Story, kind 37520) WITHOUT a
 * spec discriminator tag: the target kind is read off the `a` coordinate alone
 * (SPEC.md §17). This test pins the four content-type behaviors:
 *
 *   1. createForStory puts the proposed Markdown STRING directly in `content`
 *      (NOT JSON-wrapped), with `a` = the Story coordinate and `p` = the owner.
 *   2. getProposalTargetKind disambiguates Story (37520) vs dataset (37515) off the
 *      `a` coordinate — proving no on-event discriminator is needed.
 *   3. getProposalMarkdownContent returns the raw content string unchanged.
 *   4. acceptStoryProposalImpl republishes via the Plan-01 `editStory` path (same
 *      d-tag), passing the proposal's Markdown as the new body — so the body's `a`
 *      tags re-derive (STORY-03) and the d-tag lineage is preserved (STORY-04).
 *
 * No live publish: `createForStory().sign()` (applesauce EventFactory) uses a real
 * mock `EventSigner`; for behavior 4, `editStory` and `createProposalStatusEvent`
 * are mocked so we assert on the call arguments, not the network.
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { ARTICLE_KIND, GEO_EVENT_KIND, GEO_EDIT_PROPOSAL_KIND } from '@/lib/nostr/kinds'

let createForStory: typeof import('./factory').GeoProposalFactory.createForStory
let getProposalTargetKind: typeof import('./helpers').getProposalTargetKind
let getProposalMarkdownContent: typeof import('./helpers').getProposalMarkdownContent

beforeAll(async () => {
	const factory = await import('./factory')
	const helpers = await import('./helpers')
	createForStory = factory.GeoProposalFactory.createForStory
	getProposalTargetKind = helpers.getProposalTargetKind
	getProposalMarkdownContent = helpers.getProposalMarkdownContent
})

const OWNER = 'd'.repeat(64)
const STORY_D = 'roman-ruins'
const STORY_COORDINATE = `${ARTICLE_KIND}:${OWNER}:${STORY_D}`
const DATASET_COORDINATE = `${GEO_EVENT_KIND}:${OWNER}:some-dataset`
const MARKDOWN_BODY = '# Updated\n\nVisit the ruins at dawn.'

/** A real applesauce-compatible signer (getPublicKey + signEvent), deterministic. */
const mockSigner: EventSigner = {
	getPublicKey: () => OWNER,
	signEvent: (draft) =>
		({
			...draft,
			pubkey: OWNER,
			id: 'a'.repeat(64),
			sig: 'c'.repeat(128),
		}) as NostrEvent,
}

function tag(event: NostrEvent, name: string): string | undefined {
	return event.tags.find((t) => t[0] === name)?.[1]
}

describe('createForStory — Markdown-content proposal (STORY-06)', () => {
	test('content is the raw Markdown string (NOT JSON-wrapped), a/p tags target the Story', async () => {
		const signed = (await createForStory(
			{ address: STORY_COORDINATE, ownerPubkey: OWNER },
			MARKDOWN_BODY,
		).sign(mockSigner)) as NostrEvent

		expect(signed.kind).toBe(GEO_EDIT_PROPOSAL_KIND)
		expect(signed.content).toBe(MARKDOWN_BODY)
		// Not JSON — parsing the Markdown body as JSON would throw.
		expect(() => JSON.parse(signed.content)).toThrow()
		expect(tag(signed, 'a')).toBe(STORY_COORDINATE)
		expect(tag(signed, 'p')).toBe(OWNER)
		expect(tag(signed, 'd')).toBeTruthy()
	})
})

describe('getProposalTargetKind — coordinate disambiguation (no discriminator, SPEC.md §17)', () => {
	test('Story proposal → 37520; dataset proposal → 37515', async () => {
		const storyProposal = (await createForStory(
			{ address: STORY_COORDINATE, ownerPubkey: OWNER },
			MARKDOWN_BODY,
		).sign(mockSigner)) as NostrEvent
		const datasetProposal: NostrEvent = {
			...storyProposal,
			tags: storyProposal.tags.map((t) => (t[0] === 'a' ? ['a', DATASET_COORDINATE] : t)),
		}

		expect(getProposalTargetKind(storyProposal)).toBe(ARTICLE_KIND)
		expect(getProposalTargetKind(datasetProposal)).toBe(GEO_EVENT_KIND)
	})

	test('malformed `a` coordinate → undefined (not actionable, T-10-13)', async () => {
		const signed = (await createForStory(
			{ address: STORY_COORDINATE, ownerPubkey: OWNER },
			MARKDOWN_BODY,
		).sign(mockSigner)) as NostrEvent
		const malformed: NostrEvent = {
			...signed,
			tags: signed.tags.map((t) => (t[0] === 'a' ? ['a', 'not-a-coordinate'] : t)),
		}
		expect(getProposalTargetKind(malformed)).toBeUndefined()
	})
})

describe('getProposalMarkdownContent — raw content string (STORY-06)', () => {
	test('returns the proposed Markdown unchanged', async () => {
		const signed = (await createForStory(
			{ address: STORY_COORDINATE, ownerPubkey: OWNER },
			MARKDOWN_BODY,
		).sign(mockSigner)) as NostrEvent
		expect(getProposalMarkdownContent(signed)).toBe(MARKDOWN_BODY)
	})

	test('never throws on empty content', () => {
		const empty: NostrEvent = {
			kind: GEO_EDIT_PROPOSAL_KIND,
			pubkey: OWNER,
			created_at: 1,
			tags: [['a', STORY_COORDINATE]],
			content: '',
			id: 'e'.repeat(64),
			sig: 'c'.repeat(128),
		}
		expect(getProposalMarkdownContent(empty)).toBe('')
	})
})

describe('acceptStoryProposalImpl → republish via editStory (STORY-06, T-10-12)', () => {
	test('calls editStory with the proposal markdown as content and the SAME story event (d-tag lineage)', async () => {
		const editStorySpy = mock(
			async (existing: NostrEvent, _content: { content?: string }, _signer: unknown) => existing,
		)
		const statusSpy = mock(async () => ({}) as NostrEvent)

		mock.module('@/lib/nostr/story', () => ({ editStory: editStorySpy }))
		mock.module('@/lib/nostr/geo-proposal', () => ({
			GEO_EDIT_PROPOSAL_KIND,
			createProposalStatusEvent: statusSpy,
			getProposalMarkdownContent: (e: NostrEvent) => e.content ?? '',
		}))

		const { acceptStoryProposalImpl } = await import('@/features/social/hooks/acceptStoryProposal')

		const storyEvent: NostrEvent = {
			kind: ARTICLE_KIND,
			pubkey: OWNER,
			created_at: 1,
			tags: [['d', STORY_D]],
			content: JSON.stringify({ title: 'Original', content: 'old body' }),
			id: 'f'.repeat(64),
			sig: 'c'.repeat(128),
		}
		const proposalEvent = (await createForStory(
			{ address: STORY_COORDINATE, ownerPubkey: OWNER },
			MARKDOWN_BODY,
		).sign(mockSigner)) as NostrEvent

		await acceptStoryProposalImpl(storyEvent, proposalEvent, mockSigner)

		expect(editStorySpy).toHaveBeenCalledTimes(1)
		const [passedEvent, passedContent] = editStorySpy.mock.calls[0]
		expect(passedEvent).toBe(storyEvent)
		expect((passedContent as { content?: string }).content).toBe(MARKDOWN_BODY)
		// the d-tag lineage is preserved by re-using the same story event reference
		expect(passedEvent.tags.find((t) => t[0] === 'd')?.[1]).toBe(STORY_D)
	})
})
