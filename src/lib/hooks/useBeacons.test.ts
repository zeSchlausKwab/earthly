/**
 * Wave-0 Nyquist RED baseline — pins the `useBeacons` browse seam + the
 * `beaconState` map-marker derivation (BEACON-03, D-07 / D-08) BEFORE Plans
 * 02/04 implement them.
 *
 * Three invariants pinned, each against an EXPLICIT epoch-seconds `now`
 * (T-12-01-CLOCK / Pitfall P-1 — never `Date.now()` ms):
 *
 *   1. beaconState precedence: removed > ended > stale > live. Crucially a
 *      past-threshold beacon whose content still CLAIMS status:'live' resolves to
 *      'stale' (Pitfall P-3 — a frozen tab is stale even if its last event lies).
 *      The staleness threshold is `BEACON_STALE_THRESHOLD_S` (120s = 4× the 30s
 *      heartbeat) and is asserted at the exact boundary.
 *
 *   2. filter-before-cast (Pitfall P-2): a legacy/forged 37521 lacking the current
 *      modelVersion is dropped by `isLiveBeacon` BEFORE the `LiveBeacon` cast ctor
 *      is reached (the ctor THROWS on a non-conforming event — casting an
 *      unfiltered timeline would crash the whole map).
 *
 *   3. dropExpired at the subscription read path: an expired beacon is removed at a
 *      fixed `now` even with no new event arriving (the ticking-clock re-derivation).
 *
 * RED-BASELINE: `beaconState` + the `BEACON_*` constants do not exist yet (land in
 * Plan 02/04). The cases below MUST fail now on the missing symbols, not on syntax
 * errors. Do NOT implement them to make these pass.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { isExpired } from '@/lib/nostr/expiry'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { isLiveBeacon } from '@/lib/nostr/live-beacon'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

/** A FIXED clock — every assertion compares against this (epoch seconds, UTC). */
const NOW = 1_700_000_000

/** Build a 37521 beacon event with a controllable created_at / status / expiration. */
function makeBeacon(opts: {
	createdAt: number
	status?: 'live' | 'ended'
	expiration?: number
	modelVersion?: string
	d?: string
}): NostrEvent {
	const tags: string[][] = [['d', opts.d ?? 'beacon-1']]
	if (opts.expiration !== undefined) tags.push(['expiration', String(opts.expiration)])
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: opts.createdAt,
		kind: LIVE_BEACON_KIND,
		tags,
		content: JSON.stringify({
			modelVersion: opts.modelVersion ?? MODEL_VERSION,
			status: opts.status ?? 'live',
		}),
		sig: 'c'.repeat(64 * 2),
	}
}

describe('useBeacons — beaconState precedence at a fixed epoch-seconds now (BEACON-03, D-07/D-08)', () => {
	test('removed > ended > stale > live, and a past-threshold status:live beacon is STALE (P-3)', async () => {
		const { beaconState, BEACON_STALE_THRESHOLD_S } = await import('@/lib/hooks/useBeacons')

		// The threshold is the documented multiple of the heartbeat (120s).
		expect(BEACON_STALE_THRESHOLD_S).toBe(120)

		// removed: expired wins over everything (never rendered).
		const removed = makeBeacon({ createdAt: NOW, status: 'live', expiration: NOW - 1 })
		expect(beaconState(removed, NOW)).toBe('removed')

		// ended: status ended, not expired.
		const ended = makeBeacon({ createdAt: NOW, status: 'ended' })
		expect(beaconState(ended, NOW)).toBe('ended')

		// stale: status STILL claims live but created_at is past the threshold (P-3).
		const stale = makeBeacon({ createdAt: NOW - BEACON_STALE_THRESHOLD_S, status: 'live' })
		expect(beaconState(stale, NOW)).toBe('stale')

		// live: fresh, status live.
		const live = makeBeacon({ createdAt: NOW - 1, status: 'live' })
		expect(beaconState(live, NOW)).toBe('live')
	})

	test('the stale boundary is inclusive at exactly BEACON_STALE_THRESHOLD_S', async () => {
		const { beaconState, BEACON_STALE_THRESHOLD_S } = await import('@/lib/hooks/useBeacons')

		// one second BEFORE the threshold ⇒ still live.
		const justLive = makeBeacon({ createdAt: NOW - (BEACON_STALE_THRESHOLD_S - 1), status: 'live' })
		expect(beaconState(justLive, NOW)).toBe('live')

		// exactly AT the threshold ⇒ stale (>= comparison).
		const atBoundary = makeBeacon({ createdAt: NOW - BEACON_STALE_THRESHOLD_S, status: 'live' })
		expect(beaconState(atBoundary, NOW)).toBe('stale')
	})
})

describe('useBeacons — filter-before-cast drops legacy/forged 37521 (Pitfall P-2)', () => {
	test('isLiveBeacon excludes a legacy 37521 (no current modelVersion) BEFORE any cast', () => {
		const legacy = makeBeacon({ createdAt: NOW, modelVersion: 'earthly/1' })
		// The defensive guard rejects it WITHOUT throwing; the cast ctor is never reached.
		expect(isLiveBeacon(legacy)).toBe(false)

		// A well-formed beacon survives the same filter.
		const valid = makeBeacon({ createdAt: NOW })
		expect(isLiveBeacon(valid)).toBe(true)

		// Simulate the useMemo's filter-before-cast: only the valid event remains.
		const timeline = [legacy, valid]
		expect(timeline.filter(isLiveBeacon)).toEqual([valid])
	})
})

describe('useBeacons — dropExpired at the read path against a fixed now (P-1)', () => {
	test('an expired beacon is removed even with no new event arriving', async () => {
		const { selectVisibleBeacons } = await import('@/lib/hooks/useBeacons')

		const expired = makeBeacon({ createdAt: NOW - 200, expiration: NOW - 60, d: 'gone' })
		const live = makeBeacon({ createdAt: NOW - 1, d: 'here' })

		// The pure read-path selector (filter-before-cast + dropExpired) at fixed now.
		const visible = selectVisibleBeacons([expired, live], NOW)
		const dTags = visible.map((b) => b.dTag)
		expect(dTags).toContain('here')
		expect(dTags).not.toContain('gone')

		// Sanity: the expiry predicate agrees at the same clock.
		expect(isExpired(expired, NOW)).toBe(true)
		expect(isExpired(live, NOW)).toBe(false)
	})
})
