/**
 * Story lifecycle service (kind 37520) — the single source-of-truth publish path.
 *
 * A thin, testable wrapper over `ArticleFactory` (Phase 8) that, on EVERY publish,
 * re-derives the queryable `a` (address-reference) tags from the Markdown body's
 * inline `nostr:naddr…` refs (STORY-03 — the body is the single source of truth;
 * prior `a` tags are dropped and re-appended) and preserves the `d`-tag lineage on
 * edit (STORY-04 — parameterized-replaceable, no fork).
 *
 * This mirrors the inline analog in `GroupEditorPanel.handleSave`
 * (extractReferencedCoordinates(body) → modifyPublicTags(setAddressReferenceTags))
 * so the authoring panel (Plan 02) and the proposal-accept republish (Plan 04)
 * share one tested code path.
 *
 * Malformed `nostr:naddr…` refs are inherited-handled: `naddrToCoordinate` returns
 * null on a bad decode (references.ts), so `extractReferencedCoordinates` silently
 * excludes them and never throws (T-10-01).
 *
 * The service does NOT cast — callers cast the returned signed event via
 * `castEvent(signed, Article, eventStore)`.
 */

import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import { publish } from '@/lib/nostr'
import { ArticleFactory } from '@/lib/nostr/article'
import type { ArticleContent } from '@/lib/nostr/article'
import { extractReferencedCoordinates, setAddressReferenceTags } from '@/lib/nostr/references'

/**
 * Publish a NEW Story (new `d`-tag). The `a` tags are derived from the body's
 * `nostr:naddr…` refs (STORY-03). Returns the signed event; the caller casts it.
 */
export async function publishStory(
	content: Partial<ArticleContent>,
	signer: SignerLike,
): Promise<NostrEvent> {
	const referencedCoords = extractReferencedCoordinates(content.content ?? '')

	const signed = await ArticleFactory.create(content)
		// Destructively re-derive `a` from the body — body is the single source of
		// truth (STORY-03). No prior `a` tags exist on a fresh create, but the same
		// call keeps create/edit on one path.
		.modifyPublicTags(setAddressReferenceTags(referencedCoords))
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	return signed
}

/**
 * Edit an EXISTING Story, preserving its `d`-tag lineage (STORY-04). The `a` tags
 * are destructively re-derived from the new body (STORY-03) — refs removed since
 * the last publish are dropped, refs added are appended.
 */
export async function editStory(
	existingEvent: NostrEvent,
	content: Partial<ArticleContent>,
	signer: SignerLike,
): Promise<NostrEvent> {
	const referencedCoords = extractReferencedCoordinates(content.content ?? '')

	const signed = await ArticleFactory.modify(existingEvent)
		.article(content)
		.modifyPublicTags(setAddressReferenceTags(referencedCoords))
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	return signed
}
