/**
 * Wave-0 Nyquist baseline — pins the LiveBeacon (kind 37521) scaffold contract.
 *
 * SPEC-02 (per-kind guard + factory + cast) plus the NIP-40 expiry surface:
 *   - isLiveBeacon() accepts a well-formed 37521 (has `d` tag + `modelVersion`
 *     content), rejects a wrong-kind event.
 *   - LiveBeaconFactory.create() emits a `d` tag + `modelVersion` content.
 *   - the LiveBeacon cast exposes `dTag` AND `expiresAt` (NIP-40 expiration ts).
 *
 * Symbol names per RESEARCH Pattern 1: `isLiveBeacon` / `LiveBeaconFactory` / `LiveBeacon`.
 * RED-BASELINE: `@/lib/nostr/live-beacon` does not exist yet (lands in Plan 04).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import {
	LIVE_BEACON_KIND,
	LiveBeacon,
	LiveBeaconFactory,
	isLiveBeacon,
} from '@/lib/nostr/live-beacon'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

const EXPIRES_AT = 1_700_003_600

function makeBeaconEvent(): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind: LIVE_BEACON_KIND,
		tags: [
			['d', 'beacon-1'],
			['expiration', String(EXPIRES_AT)],
		],
		content: JSON.stringify({ modelVersion: MODEL_VERSION, label: 'here' }),
		sig: 'c'.repeat(128),
	}
}

function makeWrongKindEvent(): NostrEvent {
	return { ...makeBeaconEvent(), kind: 1 }
}

describe('live-beacon — SPEC-02 isLiveBeacon guard', () => {
	test('accepts a well-formed 37521 event', () => {
		expect(isLiveBeacon(makeBeaconEvent())).toBe(true)
	})

	test('rejects a wrong-kind event', () => {
		expect(isLiveBeacon(makeWrongKindEvent())).toBe(false)
	})
})

describe('live-beacon — SPEC-02 LiveBeaconFactory.create()', () => {
	test('emits a d tag and modelVersion content', async () => {
		const tpl = await LiveBeaconFactory.create().sign(async (e) => ({
			...e,
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
		}))
		expect(tpl.tags.some((t) => t[0] === 'd' && !!t[1])).toBe(true)
		expect(JSON.parse(tpl.content).modelVersion).toBe(MODEL_VERSION)
	})
})

describe('live-beacon — SPEC-02 LiveBeacon cast', () => {
	test('exposes dTag and the NIP-40 expiresAt timestamp', () => {
		const beacon = new LiveBeacon(makeBeaconEvent(), undefined as never)
		expect(beacon.dTag).toBe('beacon-1')
		expect(beacon.expiresAt).toBe(EXPIRES_AT)
	})
})
