/**
 * Client-side NIP-40 expiry filter (SPEC-05).
 *
 * Relay GC of expired events is best-effort and never trusted. These helpers let
 * the client drop expired events on read regardless of relay behaviour. The
 * `now` argument (epoch seconds, UTC) is explicit so the predicate is
 * deterministic against a fixed clock; callers at read paths pass `unixNow()`.
 *
 * The NIP-40 `expiration` timestamp is read via applesauce's
 * `getExpirationTimestamp` (the same cached helper `isExpired` wraps), so we
 * stay aligned with the upstream tag-parsing semantics while comparing against
 * our own injected clock.
 */

import { getExpirationTimestamp } from 'applesauce-core/helpers/expiration'
import type { NostrEvent } from 'applesauce-core/helpers/event'

/**
 * True when the event carries a NIP-40 `expiration` strictly in the past
 * relative to `now` (epoch seconds, UTC). No expiration tag ⇒ never expires.
 */
export function isExpired(event: NostrEvent, now: number): boolean {
	const expiration = getExpirationTimestamp(event)
	return expiration !== undefined ? expiration < now : false
}

/** Keep only the non-expired events relative to `now` (epoch seconds, UTC). */
export function dropExpired<T extends NostrEvent>(events: T[], now: number): T[] {
	return events.filter((event) => !isExpired(event, now))
}
