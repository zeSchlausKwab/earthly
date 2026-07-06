/**
 * Wave-0 Nyquist RED baseline — pins the NO-MOD MINIMUM foreign-lane gate (GROUP-08).
 * Every `c`-coordinate is kind- and signature-validated before render, locally-muted
 * contributors are dropped, the lane is capped + "load more", sorted newest-first, and the
 * owner can flip to `closed` (escape hatch, D-02) preserving the same `d`.
 *
 * RED-BASELINE: `@/lib/group/noModMinimum` does not exist yet (lands in a later Plan).
 *
 *   - GATE ORDER + outcomes: kind !== 37515 dropped; bad-sig (forged) dropped; muted-pubkey
 *     dropped.
 *   - CAP: 51 valid events → 50 returned + hasMore true.
 *   - SORT: newest-first by created_at.
 *   - ESCAPE HATCH: flip-to-closed yields a modify template with governance:'closed' and the
 *     SAME `d`.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { gateForeignLane } from '@/lib/group/noModMinimum'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'

const COORD = '37518:owner:my-group'

/** A real, signed 37515 attachment carrying the group `c` tag. */
function signedAttachment(sk: Uint8Array, createdAt: number, dTag: string): NostrEvent {
	return finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: createdAt,
			tags: [
				['d', dTag],
				['c', COORD],
			],
			content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
		},
		sk,
	) as NostrEvent
}

describe('noModMinimum — GROUP-08 kind/sig/mute gate order', () => {
	test('an event whose kind !== 37515 is dropped before render', () => {
		const sk = generateSecretKey()
		const good = signedAttachment(sk, 1000, 'good')
		const wrongKind = finalizeEvent(
			{ kind: MAP_CONTEXT_KIND, created_at: 1001, tags: [['c', COORD]], content: '{}' },
			sk,
		) as NostrEvent
		const { visible } = gateForeignLane([good, wrongKind], { mutedPubkeys: new Set() })
		expect(visible.map((e) => e.id)).toContain(good.id)
		expect(visible.map((e) => e.id)).not.toContain(wrongKind.id)
	})

	test('an event with a corrupted signature is dropped', () => {
		const sk = generateSecretKey()
		const good = signedAttachment(sk, 1000, 'good')
		const forged = signedAttachment(sk, 1001, 'forged')
		// Hand-corrupt the signature so verifyEvent fails.
		const tampered: NostrEvent = { ...forged, sig: `${'0'.repeat(127)}1` }
		const { visible } = gateForeignLane([good, tampered], { mutedPubkeys: new Set() })
		expect(visible.map((e) => e.id)).toContain(good.id)
		expect(visible.map((e) => e.id)).not.toContain(tampered.id)
	})

	test('an event whose pubkey is muted is dropped', () => {
		const skKeep = generateSecretKey()
		const skMute = generateSecretKey()
		const keep = signedAttachment(skKeep, 1000, 'keep')
		const muted = signedAttachment(skMute, 1001, 'muted')
		const { visible } = gateForeignLane([keep, muted], {
			mutedPubkeys: new Set([getPublicKey(skMute)]),
		})
		expect(visible.map((e) => e.id)).toContain(keep.id)
		expect(visible.map((e) => e.id)).not.toContain(muted.id)
	})
})

describe('noModMinimum — GROUP-08 cap + load-more + sort', () => {
	test('51 valid events return 50 + hasMore true', () => {
		const sk = generateSecretKey()
		const events = Array.from({ length: 51 }, (_, i) => signedAttachment(sk, 1000 + i, `d-${i}`))
		const { visible, hasMore } = gateForeignLane(events, { mutedPubkeys: new Set() })
		expect(visible.length).toBe(50)
		expect(hasMore).toBe(true)
	})

	test('the lane is sorted newest-first by created_at', () => {
		const sk = generateSecretKey()
		const older = signedAttachment(sk, 1000, 'older')
		const newer = signedAttachment(sk, 2000, 'newer')
		const { visible } = gateForeignLane([older, newer], { mutedPubkeys: new Set() })
		expect(visible[0]?.id).toBe(newer.id)
		expect(visible[1]?.id).toBe(older.id)
	})
})

describe('noModMinimum — GROUP-08 flip-to-closed escape hatch (D-02)', () => {
	test('flip-to-closed produces a modify template with governance:closed and the same d', async () => {
		const sk = generateSecretKey()
		const ownerGroup = finalizeEvent(
			{
				kind: MAP_CONTEXT_KIND,
				created_at: 1000,
				tags: [['d', 'my-group']],
				content: JSON.stringify({ modelVersion: 'earthly/2', name: 'G', governance: 'open' }),
			},
			sk,
		) as NostrEvent

		const { flipToClosed } = await import('@/lib/group/noModMinimum')
		const tpl = await flipToClosed(ownerGroup)
		const content = JSON.parse(tpl.content) as { governance?: string }
		expect(content.governance).toBe('closed')
		expect(tpl.tags.find((t) => t[0] === 'd')?.[1]).toBe('my-group')
	})
})
