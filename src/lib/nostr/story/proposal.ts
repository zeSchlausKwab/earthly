/** Submit the existing Markdown-only Story proposal format from any editor. */
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import { publish } from '@/lib/nostr'
import {
	getArticleContent,
	getArticleId,
	isArticle,
	type ArticleContent,
} from '@/lib/nostr/article'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import { GeoProposalFactory } from '@/lib/nostr/geo-proposal/factory'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { validateStoryPresentation } from './lifecycle'

/** Object key order is not a change; array order and opaque future values are. */
function sameJsonValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => sameJsonValue(value, right[index]))
		)
	}
	const leftRecord = left as Record<string, unknown>
	const rightRecord = right as Record<string, unknown>
	const keys = Object.keys(leftRecord)
	return (
		keys.length === Object.keys(rightRecord).length &&
		keys.every(
			(key) => Object.hasOwn(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key]),
		)
	)
}

/** Shared by editor disclosure and the final send boundary; omitted fields preserve. */
export function getStoryProposalUnsupportedFields(
	original: Partial<ArticleContent>,
	proposed: Partial<ArticleContent>,
): string[] {
	const proposedFields = proposed as Record<string, unknown>
	const originalFields = original as Record<string, unknown>
	return Object.keys(proposedFields).filter(
		(key) => key !== 'content' && !sameJsonValue(proposedFields[key], originalFields[key]),
	)
}

/**
 * A proposal never republishes the source Article. Only its raw Markdown body
 * travels in kind 37519; other explicitly supplied fields must remain unchanged
 * so a regular editor cannot silently discard unsupported proposal edits.
 */
export async function proposeStoryEdit(
	existingEvent: NostrEvent,
	content: Partial<ArticleContent>,
	signer: SignerLike,
): Promise<NostrEvent> {
	if (!isArticle(existingEvent))
		throw new Error('The event is not a Story and cannot receive a proposed edit.')
	const dTag = getArticleId(existingEvent)
	if (!dTag || !existingEvent.pubkey)
		throw new Error(
			'The Story is missing its author or address. Reload it before proposing an edit.',
		)
	const original = getArticleContent(existingEvent)
	const changedFields = getStoryProposalUnsupportedFields(original, content)
	if (changedFields.length) {
		throw new Error(
			`Story proposals currently send the narrative only. Changes to ${changedFields.join(', ')} cannot be included. Restore those fields to the original Story before sending your proposal.`,
		)
	}
	const markdown = Object.hasOwn(content, 'content') ? content.content : original.content
	if (typeof markdown !== 'string' || !markdown.trim())
		throw new Error('Add some narrative before sending your proposed edit.')

	// Proposed physical views must fit the owner's ORIGINAL opening layers and
	// the new body's semantic references; no new opening data is serialized here.
	validateStoryPresentation({ ...original, content: markdown })
	const eventSigner: EventSigner =
		typeof signer === 'function' ? { getPublicKey: () => '', signEvent: signer } : signer
	const signed = await GeoProposalFactory.createForStory(
		{
			address: `${ARTICLE_KIND}:${existingEvent.pubkey}:${dTag}`,
			ownerPubkey: existingEvent.pubkey,
			baseVersion: existingEvent.id,
		},
		markdown,
	).sign(eventSigner)
	await publish(signed, { routing: 'outbox' })
	return signed
}
