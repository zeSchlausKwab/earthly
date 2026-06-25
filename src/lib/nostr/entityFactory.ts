/**
 * Shared base for the Phase 8 per-kind entity factories (37520/37521/37522).
 *
 * Every entity factory injects the SPEC-03 `modelVersion` discriminator on
 * `create()`, generates a `d` tag only if absent, preserves `d` on `modify()`,
 * and delegates tag writes to the shared `tags.ts` transformers (SPEC-02). The
 * one thing this base adds over the stock applesauce `EventFactory` is a
 * `sign()` override that ALSO accepts a bare sign-function
 * `(template) => signedEvent`, not just a full `EventSigner` object — the shape
 * the per-kind Wave-0 tests pin.
 */

import { EventFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { EventTemplate, NostrEvent, UnsignedEvent } from 'applesauce-core/helpers/event'

/** A bare sign-function: takes an (unsigned) template, returns the signed event. */
export type SignFunction = (
	template: EventTemplate | UnsignedEvent,
) => Promise<NostrEvent> | NostrEvent

/** Anything our factories' `sign()` accepts: a full signer or a bare function. */
export type SignerLike = EventSigner | SignFunction

/**
 * Adapt a bare sign-function into an `EventSigner`. The function owns the final
 * event (it returns the signed result, including its own pubkey/id/sig), so
 * `getPublicKey()` is a best-effort placeholder that the function's own result
 * overrides during `signEvent`.
 */
function toEventSigner(signer: SignerLike): EventSigner {
	if (typeof signer === 'function') {
		return {
			getPublicKey: () => '',
			signEvent: (draft) => signer(draft),
		}
	}
	return signer
}

/** Base class shared by Article/LiveBeacon/TemporalSighting factories. */
export class EntityFactory<K extends number> extends EventFactory<K> {
	/**
	 * Sign the built template. Accepts a full `EventSigner` OR a bare
	 * sign-function `(template) => signedEvent`.
	 */
	override sign(signer?: SignerLike): Promise<NostrEvent> {
		const resolved = signer !== undefined ? toEventSigner(signer) : this.signer
		return super.sign(resolved) as Promise<NostrEvent>
	}
}
