/**
 * Wave-0 Nyquist baseline — pins SIGHT-04: a kind-37517 comment can root on a
 * Temporal Sighting (kind 37522) with NO allowlist change.
 *
 * `GeoCommentFactory.root(content, { kind, address, authorPubkey })` takes the
 * root kind as a RUNTIME param and emits NIP-22 `K`/`k` root-kind tags = String(kind).
 * Because there is no kind allowlist, rooting on 37522 already works — this test
 * pins that contract so a later regression (e.g. someone adds an allowlist) is caught.
 *
 * This asserts a shipped seam (GeoCommentFactory is GREEN), so the cases PASS and
 * pin the SIGHT-04 root-kind contract for Plans 02–04.
 */

import { describe, expect, test } from 'bun:test'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import { GeoCommentFactory } from '@/lib/nostr/geo-comment/factory'

const COMMENTER = 'e'.repeat(64)

/** A real applesauce-compatible signer (getPublicKey + signEvent), deterministic. */
const mockSigner: EventSigner = {
	getPublicKey: () => COMMENTER,
	signEvent: (draft) =>
		({
			...draft,
			pubkey: COMMENTER,
			id: 'a'.repeat(64),
			sig: 'c'.repeat(128),
		}) as NostrEvent,
}

const SIGHTING_PUBKEY = 'd'.repeat(64)
const SIGHTING_ADDRESS = `${TEMPORAL_SIGHTING_KIND}:${SIGHTING_PUBKEY}:sighting-dtag`

describe('GeoCommentFactory.root — SIGHT-04 rootKind = 37522', () => {
	test("emits K/k root-kind tags equal to '37522'", async () => {
		const tpl = await GeoCommentFactory.root(
			{ text: 'Saw it too!' },
			{
				kind: TEMPORAL_SIGHTING_KIND,
				address: SIGHTING_ADDRESS,
				authorPubkey: SIGHTING_PUBKEY,
			},
		).sign(mockSigner)

		expect(tpl.tags.find((t) => t[0] === 'K')?.[1]).toBe('37522')
		expect(tpl.tags.find((t) => t[0] === 'k')?.[1]).toBe('37522')
	})

	test('roots A/a/P/p on the sighting coordinate + author (no allowlist gate)', async () => {
		const tpl = await GeoCommentFactory.root(
			{ text: 'Nice spot.' },
			{
				kind: TEMPORAL_SIGHTING_KIND,
				address: SIGHTING_ADDRESS,
				authorPubkey: SIGHTING_PUBKEY,
			},
		).sign(mockSigner)

		expect(tpl.tags.find((t) => t[0] === 'A')?.[1]).toBe(SIGHTING_ADDRESS)
		expect(tpl.tags.find((t) => t[0] === 'a')?.[1]).toBe(SIGHTING_ADDRESS)
		expect(tpl.tags.find((t) => t[0] === 'P')?.[1]).toBe(SIGHTING_PUBKEY)
		expect(tpl.tags.find((t) => t[0] === 'p')?.[1]).toBe(SIGHTING_PUBKEY)
	})
})
