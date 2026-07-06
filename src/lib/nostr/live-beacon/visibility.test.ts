/**
 * Wave-0 Nyquist RED baseline — pins the PUBLIC-vs-LINK-ONLY discovery-gating
 * contract (BEACON-04, D-10, Pitfall P-6) BEFORE Plan 02 implements it.
 *
 * The privacy footgun this pins: a "link-only" beacon (shared via a copied
 * naddr, NOT broadcast on the map) MUST NOT be discoverable. The lifecycle
 * therefore branches on `visibility`:
 *   - PUBLIC   → emit the `t:'live'` discovery marker AND the `g`/`bbox` geo tags.
 *   - LINK-ONLY→ emit NEITHER `t:'live'` NOR `g`/`bbox` (so a discovery scan
 *               `{ kinds:[37521], '#t':['live'] }` cannot find it; only someone
 *               holding the naddr can fetch it directly).
 *
 * T-12-01-LINKONLY: this is the security-critical invariant pinned RED so a
 * Plan-02 regression that leaks a link-only beacon into discovery is caught.
 *
 * RED-BASELINE: `updateBeacon` does not exist yet (lands in Plan 02). The cases
 * below MUST fail now on the missing lifecycle symbol, not on syntax errors. Do
 * NOT stub the implementation to make these pass.
 */

import { describe, expect, mock, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Point } from 'geojson'

// Stub the relay publish so the lifecycle service never hits the network.
const publishSpy = mock(async (_event: NostrEvent) => {})
mock.module('@/lib/nostr', () => ({ publish: publishSpy }))

const BEACON_POINT: Point = { type: 'Point', coordinates: [16.3738, 48.2082] }
const EXPIRES_AT = 1_700_003_600

async function bareSign(e: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}): Promise<NostrEvent> {
	return {
		...e,
		created_at: e.created_at ?? 1_700_000_000,
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	} as NostrEvent
}

/** A NIP-01 client-side filter match (the discovery scan a relay would run). */
function matchesDiscoveryFilter(event: NostrEvent): boolean {
	const filter = { kinds: [37521], '#t': ['live'] }
	if (!filter.kinds.includes(event.kind)) return false
	const tValues = event.tags.filter((t) => t[0] === 't').map((t) => t[1])
	return filter['#t'].some((wanted) => tValues.includes(wanted))
}

describe('live-beacon visibility — PUBLIC beacon is discoverable (BEACON-04, D-10)', () => {
	test('a PUBLIC beacon emits t:live AND geo tags, and matches the #t:[live] discovery filter', async () => {
		const { updateBeacon } = await import('@/lib/nostr/live-beacon')
		const signed = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			bareSign,
		)

		expect(signed.tags.some((t) => t[0] === 't' && t[1] === 'live')).toBe(true)
		expect(signed.tags.some((t) => t[0] === 'g')).toBe(true)
		expect(signed.tags.some((t) => t[0] === 'bbox')).toBe(true)
		expect(matchesDiscoveryFilter(signed)).toBe(true)
	})
})

describe('live-beacon visibility — LINK-ONLY beacon is NOT discoverable (Pitfall P-6)', () => {
	test('a LINK-ONLY beacon emits NEITHER t:live NOR g/bbox, and does NOT match the discovery filter', async () => {
		const { updateBeacon } = await import('@/lib/nostr/live-beacon')
		const signed = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'link-only',
			},
			bareSign,
		)

		// No discovery marker.
		expect(signed.tags.some((t) => t[0] === 't' && t[1] === 'live')).toBe(false)
		// No coarse geo discovery tags (the footgun: leaking position into discovery).
		expect(signed.tags.some((t) => t[0] === 'g')).toBe(false)
		expect(signed.tags.some((t) => t[0] === 'bbox')).toBe(false)
		// A discovery scan cannot surface it.
		expect(matchesDiscoveryFilter(signed)).toBe(false)
	})
})
