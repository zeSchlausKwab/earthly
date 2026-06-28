/**
 * Wave-0 Nyquist RED baseline — pins the Live Beacon OG-fetch contract
 * (BEACON-04, D-11) BEFORE Plan 05 implements `fetchBeaconOGData`.
 *
 * `fetchBeaconOGData(naddr, relayUrl)` is the server-side OG read path for a
 * shared beacon link — a near-verbatim clone of `fetchSightingOGData`
 * (`src/lib/og/fetchEvent.ts:307-364`). The naddr encodes a THROWAWAY pubkey
 * (D-05: a beacon session signs with a per-session key), so the fetch resolves
 * `{ kinds:[37521], authors:[throwawayPubkey], '#d':[d] }`.
 *
 * Three invariants pinned:
 *   1. Round-trip: a throwaway-pubkey naddr decodes + fetches the latest beacon and
 *      returns its title/description.
 *   2. Expiry guard (SIGHT-03/P-1, the easy-miss raw read path): an expired beacon
 *      returns null — the OG card never renders a dead beacon.
 *   3. Kind gate: a non-37521 naddr returns null.
 *
 * The raw relay fetch is mocked via `mock.module` on the WebSocket-backed helper
 * (mirrors how the OG read path is exercised). Clock discipline: the expiry check
 * compares epoch SECONDS against a fixed `now`.
 *
 * RED-BASELINE: `fetchBeaconOGData` does not exist yet (lands in Plan 05). The
 * cases below MUST fail now on the missing symbol. Do NOT implement it.
 */

import { afterAll, beforeAll, describe, expect, mock, setSystemTime, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'

const THROWAWAY_PUBKEY = 'd'.repeat(64)
const BEACON_D = 'beacon-session-1'
const NOW_SECONDS = 1_700_000_000

// The expiry guard (`isOGEventExpired`) compares the NIP-40 `expiration` against
// the real wall clock (epoch seconds). Freeze the clock to the fixed `NOW_SECONDS`
// the fixtures are authored around so the live/expired cases below are
// deterministic regardless of the real date the suite runs on.
beforeAll(() => {
	setSystemTime(new Date(NOW_SECONDS * 1000))
})
afterAll(() => {
	setSystemTime()
})

/** Encode a parameterized-replaceable coordinate as an naddr (the share link). */
function encodeBeaconNaddr(kind: number, pubkey: string, identifier: string): string {
	return nip19.naddrEncode({ kind, pubkey, identifier, relays: ['ws://localhost:3334'] })
}

/**
 * Mock the WebSocket-backed relay fetch the OG path uses. The returned event is
 * the "latest by created_at" the relay would serve for the d-coordinate. Tests
 * swap `nextEvent` to drive the round-trip / expiry / kind cases.
 */
let nextEvent: {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
} | null = null

mock.module('@/lib/og/relayFetch', () => ({
	fetchEventFromRelay: mock(async () => nextEvent),
}))

describe('fetchBeaconOGData — throwaway-pubkey naddr round-trip (BEACON-04, D-11)', () => {
	test('decodes a throwaway-pubkey naddr and returns the beacon title/description', async () => {
		const { fetchBeaconOGData } = await import('@/lib/og/fetchBeacon')

		nextEvent = {
			id: 'a'.repeat(64),
			pubkey: THROWAWAY_PUBKEY,
			created_at: NOW_SECONDS,
			kind: LIVE_BEACON_KIND,
			tags: [
				['d', BEACON_D],
				['expiration', String(NOW_SECONDS + 3600)],
			],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				label: 'Bike courier — live',
				status: 'live',
			}),
			sig: 'c'.repeat(128),
		}

		const naddr = encodeBeaconNaddr(LIVE_BEACON_KIND, THROWAWAY_PUBKEY, BEACON_D)
		const og = await fetchBeaconOGData(naddr, 'ws://localhost:3334')

		expect(og).not.toBeNull()
		// the throwaway-key decode succeeded (the fetch resolved an event) and the
		// label/title surfaced into the OG card.
		expect(JSON.stringify(og)).toContain('Bike courier — live')
	})
})

describe('fetchBeaconOGData — expiry guard returns null (SIGHT-03 / Pitfall P-1)', () => {
	test('an expired beacon returns null (never renders a dead beacon into a card)', async () => {
		const { fetchBeaconOGData } = await import('@/lib/og/fetchBeacon')

		nextEvent = {
			id: 'a'.repeat(64),
			pubkey: THROWAWAY_PUBKEY,
			created_at: NOW_SECONDS - 7200,
			kind: LIVE_BEACON_KIND,
			tags: [
				['d', BEACON_D],
				['expiration', String(NOW_SECONDS - 3600)], // already in the past
			],
			content: JSON.stringify({ modelVersion: 'earthly/2', label: 'expired', status: 'live' }),
			sig: 'c'.repeat(128),
		}

		const naddr = encodeBeaconNaddr(LIVE_BEACON_KIND, THROWAWAY_PUBKEY, BEACON_D)
		const og = await fetchBeaconOGData(naddr, 'ws://localhost:3334')
		expect(og).toBeNull()
	})
})

describe('fetchBeaconOGData — kind gate returns null for a non-37521 naddr', () => {
	test('a naddr for a non-beacon kind returns null without fetching', async () => {
		const { fetchBeaconOGData } = await import('@/lib/og/fetchBeacon')

		const wrongKindNaddr = encodeBeaconNaddr(37520 /* Story */, THROWAWAY_PUBKEY, 'story-1')
		const og = await fetchBeaconOGData(wrongKindNaddr, 'ws://localhost:3334')
		expect(og).toBeNull()
	})
})
