/**
 * NO-MOD MINIMUM foreign-lane gate (GROUP-08) — the phase's second security-critical guard.
 *
 * Every `c`-attached coordinate arriving from a relay is UNTRUSTED. Before any foreign
 * attachment is allowed into the render set it MUST pass, IN THIS EXACT ORDER:
 *
 *   1. KIND gate    — `event.kind === GEO_EVENT_KIND` (37515). A kind-confused event
 *                     (e.g. a 37518 masquerading on the `#c` filter) is dropped.
 *   2. SIGNATURE gate — `verifyEvent(event)` (nostr-tools schnorr). A forged or unsigned
 *                     event is dropped. NEVER hand-roll signature verification.
 *   3. MUTE gate    — `!mutedPubkeys.has(event.pubkey)`. A device-locally muted contributor
 *                     is dropped app-wide (D-10/D-11).
 *
 * A dropped event NEVER paints — no chip, no flash, it simply never enters the list
 * (T-09-06-FORGED-COORD, HIGH-severity phase guard). Do not weaken or reorder these three
 * gates; the kind check MUST precede the signature check so a wrong-kind event is rejected
 * before any crypto work.
 *
 * Survivors are sorted newest-first by `created_at` and capped at `FOREIGN_LANE_CAP` (50);
 * the remainder is surfaced behind a "Load more" affordance via `hasMore` (D-07).
 *
 * NOTE (RESEARCH O-01 / A1): trust-sort is recency-only this phase — there is no
 * follows-boost source yet. Follows-weighted ordering is the documented follow-up.
 */

import type { NostrEvent } from 'applesauce-core/helpers/event'
import { verifyEvent } from 'nostr-tools'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

/** The maximum number of foreign attachments rendered before "Load more" (D-07). */
export const FOREIGN_LANE_CAP = 50

/**
 * Verify a foreign event's signature WITHOUT trusting any cached verification marker.
 *
 * nostr-tools memoizes a successful `verifyEvent` under an internal `verifiedSymbol` on the
 * event object and short-circuits on subsequent calls. A hostile or mutated event could
 * carry a poisoned (`true`) cached flag while bearing a forged signature — so we verify a
 * freshly reconstructed plain object built ONLY from the signature-bearing fields, never the
 * caller's possibly-marked instance (T-09-06-FORGED-COORD). nostr-tools also re-derives and
 * checks the `id` from these fields, so a tampered id/content/tags is rejected too.
 */
function verifyUntrustedEvent(event: NostrEvent): boolean {
	try {
		return verifyEvent({
			id: event.id,
			pubkey: event.pubkey,
			created_at: event.created_at,
			kind: event.kind,
			tags: event.tags,
			content: event.content,
			sig: event.sig,
		})
	} catch {
		// A malformed event (missing fields, bad hex) is untrusted → drop.
		return false
	}
}

/** Options for the foreign-lane gate. */
export interface GateForeignLaneOptions {
	/** Pubkeys (hex) the viewer has device-locally muted; their events are dropped. */
	mutedPubkeys: Set<string>
}

/** The result of gating the foreign lane. */
export interface ForeignLaneGate {
	/** The validated, sorted, capped attachments to render (≤ FOREIGN_LANE_CAP). */
	visible: NostrEvent[]
	/** Whether more validated attachments exist beyond the cap ("Load more"). */
	hasMore: boolean
}

/**
 * Gate the foreign (`c`) contribution lane (GROUP-08).
 *
 * Applies the kind → signature → mute guard to every candidate IN THAT ORDER, drops any
 * event that fails any gate (it never paints), sorts survivors newest-first by `created_at`,
 * then caps at {@link FOREIGN_LANE_CAP} returning `hasMore` for the remainder.
 *
 * The schema off/warn/strict filter (GROUP-05) is applied SEPARATELY by the consumer on the
 * already-gated survivors — it is a legibility filter (shows reason chips), NOT a trust gate.
 */
export function gateForeignLane(
	events: NostrEvent[],
	options: GateForeignLaneOptions,
): ForeignLaneGate {
	const { mutedPubkeys } = options

	const validated = events.filter((event) => {
		// 1. KIND gate — wrong-kind events are dropped before any crypto work.
		if (event.kind !== GEO_EVENT_KIND) return false
		// 2. SIGNATURE gate — forged/unsigned events are dropped (nostr-tools schnorr,
		//    cache-marker-resistant; see verifyUntrustedEvent).
		if (!verifyUntrustedEvent(event)) return false
		// 3. MUTE gate — a device-locally muted contributor is dropped app-wide.
		if (mutedPubkeys.has(event.pubkey)) return false
		return true
	})

	// Newest-first by created_at (recency-only trust-sort this phase; follows-boost is a
	// documented follow-up per RESEARCH O-01 / A1).
	validated.sort((a, b) => b.created_at - a.created_at)

	const visible = validated.slice(0, FOREIGN_LANE_CAP)
	const hasMore = validated.length > FOREIGN_LANE_CAP

	return { visible, hasMore }
}

/** A replaceable-event template (the shape `flipToClosed` returns for the owner to sign). */
export interface FlipToClosedTemplate {
	kind: number
	created_at: number
	tags: string[][]
	content: string
}

/**
 * The owner escape hatch (D-02): produce a `modify` template that flips a Group to
 * `governance: 'closed'` while PRESERVING the same `d` (no lineage fork — comments and
 * reactions stay attached, Pitfall 4 / T-09-06-LINEAGE). Re-asserts the current
 * `modelVersion` so the flipped event stays in the render set.
 *
 * Returns a template (caller signs + publishes). The view panel wires this through
 * `GroupFactory.modify(group).group({ governance:'closed' }).sign(account).publish` for the
 * full account-signed path; this helper is the pure, testable core the Wave-0 contract pins.
 */
export async function flipToClosed(group: NostrEvent): Promise<FlipToClosedTemplate> {
	let parsed: Record<string, unknown>
	try {
		parsed = JSON.parse(group.content) as Record<string, unknown>
	} catch {
		parsed = {}
	}

	const content = JSON.stringify({
		...parsed,
		governance: 'closed',
		modelVersion: MODEL_VERSION,
	})

	// Preserve EVERY existing tag (notably `d`) — never regenerate the lineage.
	return {
		kind: group.kind,
		created_at: Math.floor(Date.now() / 1000),
		tags: group.tags.map((tag) => [...tag]),
		content,
	}
}
