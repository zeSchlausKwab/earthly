/**
 * acceptStoryProposalImpl (STORY-06) — the pure accept path, factored out of the
 * React hook so it is unit-testable without a renderer or the live event store.
 *
 * Republishes the target Story IN PLACE via the Plan-01 `editStory` path with the
 * proposal's Markdown body as the new content — so the body's `a` tags re-derive
 * (STORY-03) and the `d`-tag lineage is preserved (STORY-04); an accepted proposal
 * cannot inject phantom `a` tags or fork the lineage (T-10-12). Then publishes an
 * `applied` status event for the proposal (reusing the dataset status path).
 *
 * The proposal `content` is read defensively as a raw string
 * (`getProposalMarkdownContent`, never throws — T-10-14).
 */

import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import { createProposalStatusEvent, getProposalMarkdownContent } from '@/lib/nostr/geo-proposal'
import { GEO_EDIT_PROPOSAL_KIND } from '@/lib/nostr/kinds'
import { editStory } from '@/lib/nostr/story'

/** Re-derive the `37519:<author>:<d>` coordinate of a raw proposal event. */
function proposalCoordinateOf(proposalEvent: NostrEvent): string | undefined {
	const d = proposalEvent.tags.find((t) => t[0] === 'd')?.[1]
	if (!d || !proposalEvent.pubkey) return undefined
	return `${GEO_EDIT_PROPOSAL_KIND}:${proposalEvent.pubkey}:${d}`
}

export async function acceptStoryProposalImpl(
	storyEvent: NostrEvent,
	proposalEvent: NostrEvent,
	signer: SignerLike,
): Promise<NostrEvent> {
	const markdown = getProposalMarkdownContent(proposalEvent)
	// Route through editStory (NOT a re-inlined ArticleFactory): same `d`-tag, and
	// the body's `a` tags re-derive from the accepted Markdown (STORY-03/04).
	const updated = await editStory(storyEvent, { content: markdown }, signer)

	// Publish the "applied" status for the proposal (reuses the dataset status path).
	await createProposalStatusEvent(
		{
			proposalCoordinate: proposalCoordinateOf(proposalEvent),
			id: proposalEvent.id,
			pubkey: proposalEvent.pubkey,
		},
		'applied',
		signer as EventSigner,
	)

	return updated
}
