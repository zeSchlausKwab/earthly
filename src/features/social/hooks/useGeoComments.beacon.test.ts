/**
 * XCUT-01 / D-06 / D-11 — pins that the widened `useGeoComments` target union
 * roots a comment at the beacon coordinate `37521:<pubkey>:<dTag>`.
 *
 * The comment stack has been kind-generic since Phase 8: `useGeoComments` builds
 * the `#A` filter address as `${target.kind}:${target.pubkey}:${target.dTag}`
 * (useGeoComments.ts L57-62), reading only `.kind`/`.pubkey`/`.dTag`. This plan's
 * only change is widening the `UseGeoCommentsOptions.target` union to accept
 * `LiveBeacon` (kind 37521) — the last unwired kind (Story/Group/Sighting already
 * wired). This test pins that a real `LiveBeacon` cast flows through that generic
 * derivation to the correct 37521 root address, and that the defensive
 * null-on-missing-dTag path is unchanged.
 *
 * `deriveCommentFilterAddress` below is BYTE-FOR-BYTE the derivation inside the
 * hook's `filters` useMemo (useGeoComments.ts L56-62), typed with the real
 * `UseGeoCommentsOptions['target']` union — so if `LiveBeacon` were ever dropped
 * from that union, this file would stop type-checking (a compile-time regression
 * guard), and the runtime assertions prove the address it yields.
 */

import { describe, expect, test } from 'bun:test'
import { EventStore } from 'applesauce-core'
import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { GEO_COMMENT_KIND, LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { LiveBeacon } from '@/lib/nostr/live-beacon'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import type { UseGeoCommentsOptions } from './useGeoComments'

const BEACON_PUBKEY = 'b'.repeat(64)
const BEACON_DTAG = 'beacon-session-1'

/** Build a well-formed 37521 event with a controllable `d` tag. */
function makeBeaconEvent(dTag?: string): NostrEvent {
	const tags: string[][] = []
	if (dTag !== undefined) tags.push(['d', dTag])
	return {
		id: 'a'.repeat(64),
		pubkey: BEACON_PUBKEY,
		created_at: 1_700_000_000,
		kind: LIVE_BEACON_KIND,
		tags,
		content: JSON.stringify({ modelVersion: MODEL_VERSION, status: 'live' }),
		sig: 'c'.repeat(128),
	}
}

/**
 * The exact `#A` filter-address derivation from useGeoComments.ts L56-62,
 * typed against the SHIPPED target union — proves the widened union member
 * satisfies the already-generic filter with no branching.
 */
function deriveCommentFilterAddress(
	target: UseGeoCommentsOptions['target'],
): { kinds: number[]; '#A': string[] }[] | null {
	if (!target) return null
	const targetKind = target.kind
	const targetPubkey = target.pubkey
	const targetDTag = target.dTag
	if (!targetKind || !targetPubkey || !targetDTag) return null
	const address = `${targetKind}:${targetPubkey}:${targetDTag}`
	return [{ kinds: [GEO_COMMENT_KIND], '#A': [address] }]
}

describe('useGeoComments — LiveBeacon roots comments at the 37521 coordinate (XCUT-01, D-06)', () => {
	test('a LiveBeacon target yields the #A address 37521:<pubkey>:<dTag>', () => {
		const store = new EventStore()
		const beacon = castEvent(makeBeaconEvent(BEACON_DTAG), LiveBeacon, store)

		// The widened union member (LiveBeacon) flows through the generic filter.
		const filters = deriveCommentFilterAddress(beacon)

		expect(filters).not.toBeNull()
		expect(filters?.[0]?.kinds).toEqual([GEO_COMMENT_KIND])
		expect(filters?.[0]?.['#A']).toEqual([`${LIVE_BEACON_KIND}:${BEACON_PUBKEY}:${BEACON_DTAG}`])
	})

	test('a LiveBeacon-shaped target with a missing dTag yields a null filter (defensive path unchanged)', () => {
		// A beacon that fails the `d`-tag requirement — the isLiveBeacon guard
		// would reject it at cast time, so we assert the derivation directly on a
		// bare beacon-shaped target with dTag: undefined.
		const noDTagTarget = {
			kind: LIVE_BEACON_KIND,
			pubkey: BEACON_PUBKEY,
			dTag: undefined,
		} as unknown as UseGeoCommentsOptions['target']

		expect(deriveCommentFilterAddress(noDTagTarget)).toBeNull()
	})
})
