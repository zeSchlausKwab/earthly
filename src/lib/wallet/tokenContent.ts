import { getTokenContent, type TokenContent } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'

/** The upstream getter parses JSON but intentionally does not validate every field.
 * Validate once at Earthly's spend boundary; malformed content stays in recovery. */
export function spendableTokenContent(event: NostrEvent): TokenContent | undefined {
	const content = getTokenContent(event)
	if (!content || typeof content.mint !== 'string' || !content.mint.trim()) return
	if (content.unit !== undefined && content.unit !== 'sat') return
	if (!Array.isArray(content.del) || !content.del.every((id) => typeof id === 'string')) return
	if (
		!Array.isArray(content.proofs) ||
		!content.proofs.every(
			(proof) =>
				proof &&
				typeof proof.id === 'string' &&
				proof.id.length > 0 &&
				typeof proof.secret === 'string' &&
				typeof proof.C === 'string' &&
				typeof proof.amount === 'number' &&
				Number.isSafeInteger(proof.amount) &&
				proof.amount > 0,
		)
	)
		return
	return content
}
