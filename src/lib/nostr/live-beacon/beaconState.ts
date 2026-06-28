/**
 * Live Beacon staleness/lifecycle derivation (kind 37521) — D-07 / D-08.
 *
 * Three clocks stay disjoint (12-RESEARCH § "Three clocks"):
 *   - `created_at`         → staleness (last-seen)
 *   - NIP-40 `expiration`  → removal
 *   - the content `status` → the explicit terminal 'ended' marker (D-04)
 *
 * `beaconState(cast, now)` resolves them with the precedence
 *   removed > ended > stale > live
 * against an EXPLICIT epoch-seconds `now` (T-12-02-CLOCK / Pitfall P-1 — never
 * `Date.now()` ms). Crucially a past-threshold beacon whose content still CLAIMS
 * status:'live' resolves to 'stale' (Pitfall P-3 — a frozen tab is stale even if
 * its last event lies; a failed ended-publish still degrades honestly).
 *
 * The cadence constants are NAMED and derived from the heartbeat so the staleness
 * threshold stays in sync with the publish cadence (D-08).
 */

import type { NostrEvent } from 'applesauce-core/helpers/event'
import { isExpired } from '@/lib/nostr/expiry'
import type { LiveBeacon } from './cast'
import { getLiveBeaconContent } from './helpers'

/** Time floor / heartbeat interval (ms). Re-publish at least this often (D-02). */
export const BEACON_HEARTBEAT_MS = 30_000

/** Distance floor (metres) — re-publish when moved at least this far. */
export const BEACON_DISTANCE_FLOOR_M = 25

/** Staleness factor — a beacon is stale after this many missed heartbeats (D-08). */
export const BEACON_STALE_FACTOR = 4

/**
 * Staleness threshold (epoch SECONDS) — derived from the heartbeat so it never
 * drifts from the publish cadence (= 120s = 4× the 30s heartbeat, D-08). NOT a
 * magic literal.
 */
export const BEACON_STALE_THRESHOLD_S = (BEACON_HEARTBEAT_MS / 1000) * BEACON_STALE_FACTOR

/** The visual lifecycle state a beacon marker resolves to (D-07). */
export type BeaconState = 'removed' | 'ended' | 'stale' | 'live'

/**
 * Derive a beacon's visual state at `now` (epoch seconds, UTC). Accepts either a
 * `LiveBeacon` cast or a raw 37521 `NostrEvent` (the map layer passes a cast; the
 * read-path selector passes raw events). Precedence: removed (expired — never
 * rendered) > ended (terminal status) > stale (past-threshold regardless of
 * status — P-3) > live.
 */
export function beaconState(beacon: LiveBeacon | NostrEvent, now: number): BeaconState {
	const event = 'rawEvent' in beacon ? beacon.rawEvent() : beacon
	const status = 'status' in beacon ? beacon.status : (getLiveBeaconContent(event).status ?? 'live')

	if (isExpired(event, now)) return 'removed'
	if (status === 'ended') return 'ended'
	if (now - event.created_at >= BEACON_STALE_THRESHOLD_S) return 'stale'
	return 'live'
}
