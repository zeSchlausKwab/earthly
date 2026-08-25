import type { EventSigner } from 'applesauce-core/factories/types'

interface OwnedDeletionTarget {
	pubkey?: string
}

/**
 * Domain-layer ownership preflight for NIP-09 deletion events.
 *
 * UI ownership checks are useful for discoverability, but they are not an
 * authorization boundary. Every public delete path calls this immediately
 * before signing so a stale or forged UI target cannot make the active account
 * publish a tombstone for another author's entity.
 */
export async function assertCanDeleteOwnedEntity(
	target: OwnedDeletionTarget,
	signer: EventSigner,
	entityLabel: string,
): Promise<void> {
	if (!target.pubkey) {
		throw new Error(`${entityLabel} is missing an author and cannot be deleted.`)
	}

	const signerPubkey = await signer.getPublicKey()
	if (!signerPubkey) {
		throw new Error('The active account did not provide a public key.')
	}
	if (signerPubkey !== target.pubkey) {
		throw new Error(`Only the author can delete this ${entityLabel.toLowerCase()}.`)
	}
}
