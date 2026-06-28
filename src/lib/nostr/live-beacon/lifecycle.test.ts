/**
 * Wave-0 Nyquist RED baseline — pins the LiveBeacon (kind 37521) lifecycle
 * service contract (BEACON-01 / BEACON-02, D-04 / D-09) BEFORE Plan 02 implements
 * it.
 *
 * The lifecycle service (`updateBeacon` / `stopBeacon`) is the single
 * source-of-truth publish path, cloned from `temporal-sighting/lifecycle.ts`:
 * on EVERY publish it re-derives the lossy `bbox` + `g` discovery tags from the
 * precise `content.geometry` via turf (geometry is the single source of truth —
 * the tags never drift), keeps the NIP-40 `expiration`, and — for a PUBLIC
 * beacon — emits the `t:'live'` discovery marker (D-10). It preserves the
 * session `d`-tag on every heartbeat (parameterized-replaceable, no lineage
 * fork).
 *
 * RED-BASELINE: `updateBeacon` / `stopBeacon` do not exist yet (land in Plan 02).
 * The behavior cases below MUST fail now on the missing lifecycle symbols, not on
 * syntax errors. Do NOT stub the implementations to make these pass — that
 * defeats the baseline.
 *
 * Clock discipline (T-12-01-CLOCK / Pitfall P-1): `expiration` and `created_at`
 * are epoch SECONDS (UTC), never `Date.now()` ms.
 */

import { describe, expect, mock, test } from 'bun:test'
import { bbox } from '@turf/turf'
import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Point } from 'geojson'
import { LiveBeacon } from '@/lib/nostr/live-beacon'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

// Stub the relay publish so the lifecycle service never hits the network (mirrors
// temporal-sighting/temporal-sighting.test.ts — import the lifecycle AFTER the
// module mock so it binds the stubbed `publish`).
const publishSpy = mock(async (_event: NostrEvent) => {})
mock.module('@/lib/nostr', () => ({ publish: publishSpy }))

/** A Point geometry for a Vienna beacon fixture (lon, lat). */
const BEACON_POINT: Point = { type: 'Point', coordinates: [16.3738, 48.2082] }

/** Epoch SECONDS (UTC) — never Date.now() ms. */
const EXPIRES_AT = 1_700_003_600

/** Bare sign-function (EntityFactory + lifecycle contract) — deterministic id/sig. */
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

describe('live-beacon lifecycle — updateBeacon derives geo tags + t:live (BEACON-01, D-09/D-10)', () => {
	test('a PUBLIC beacon derives bbox + g from content.geometry AND emits a t:live marker', async () => {
		const { updateBeacon } = await import('@/lib/nostr/live-beacon')
		const signed = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			bareSign,
		)

		// bbox of a Point is [lon, lat, lon, lat] — derived via turf.
		const expectedBbox = bbox(BEACON_POINT).join(',')
		expect(signed.tags.find((t) => t[0] === 'bbox')?.[1]).toBe(expectedBbox)

		// a geohash `g` tag derived from the geometry centroid is present + non-empty.
		const gTag = signed.tags.find((t) => t[0] === 'g')?.[1]
		expect(typeof gTag).toBe('string')
		expect((gTag ?? '').length).toBeGreaterThan(0)

		// the D-10 PUBLIC discovery marker.
		expect(signed.tags.some((t) => t[0] === 't' && t[1] === 'live')).toBe(true)

		// the NIP-40 expiration is preserved (epoch seconds).
		expect(signed.tags.find((t) => t[0] === 'expiration')?.[1]).toBe(String(EXPIRES_AT))
	})

	test('round-trips: castEvent(signed).beacon.status === live and .geometry deep-equals the Point', async () => {
		const { updateBeacon } = await import('@/lib/nostr/live-beacon')
		const signed = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			bareSign,
		)

		const cast = castEvent(signed, LiveBeacon, undefined as never)
		expect(cast.beacon.status).toBe('live')
		expect(cast.beacon.geometry).toEqual(BEACON_POINT)
	})
})

describe('live-beacon lifecycle — heartbeat preserves d (BEACON-01, no lineage fork)', () => {
	test('updateBeacon twice with the SAME session d preserves d and bumps created_at', async () => {
		const { updateBeacon } = await import('@/lib/nostr/live-beacon')

		const first = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			bareSign,
		)
		const dTag = first.tags.find((t) => t[0] === 'd')?.[1]
		expect(dTag).toBeDefined()

		// The second heartbeat re-publishes the SAME d-tag (the modify path), newer ts.
		const moved: Point = { type: 'Point', coordinates: [16.3748, 48.2092] }
		const second = await updateBeacon(
			{
				existing: first,
				content: { geometry: moved, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			(e) => bareSign({ ...e, created_at: (first.created_at ?? 0) + 30 }),
		)
		expect(second.tags.find((t) => t[0] === 'd')?.[1]).toBe(dTag)
		expect(second.created_at).toBeGreaterThan(first.created_at)
	})
})

describe('live-beacon lifecycle — stopBeacon ends without disappearing (BEACON-02, D-04)', () => {
	test('stopBeacon signs a final 37521 with status:ended, the SAME d, and keeps the expiration', async () => {
		const { updateBeacon, stopBeacon } = await import('@/lib/nostr/live-beacon')

		const live = await updateBeacon(
			{
				content: { geometry: BEACON_POINT, status: 'live' },
				expiration: EXPIRES_AT,
				visibility: 'public',
			},
			bareSign,
		)
		const dTag = live.tags.find((t) => t[0] === 'd')?.[1]

		const ended = await stopBeacon(live, bareSign)

		// status flips to ended in content — NOT a silent disappearance.
		const content = JSON.parse(ended.content) as { status?: string; modelVersion?: string }
		expect(content.status).toBe('ended')
		expect(content.modelVersion).toBe(MODEL_VERSION)

		// same d (no fork) and the NIP-40 expiration is retained (D-04).
		expect(ended.tags.find((t) => t[0] === 'd')?.[1]).toBe(dTag)
		expect(ended.tags.find((t) => t[0] === 'expiration')?.[1]).toBe(String(EXPIRES_AT))
	})
})
