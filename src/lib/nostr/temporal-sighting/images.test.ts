/**
 * SPEC §5.1/§6.1/§7.3 — NIP-92 imeta media attachments on sightings and beacons.
 *
 * Round-trips through the shared tags.ts seam (setImages / getImages) via the
 * per-kind factories and helpers. First imeta tag = primary image.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { LiveBeaconFactory, getLiveBeaconImages } from '@/lib/nostr/live-beacon'
import {
	TemporalSightingFactory,
	getTemporalSightingImages,
	getTemporalSightingPrimaryImage,
} from '@/lib/nostr/temporal-sighting'
import { setImages } from '@/lib/nostr/tags'

const sign = async (e: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
	...e,
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	sig: 'c'.repeat(128),
})

const IMAGE_A = {
	url: 'https://blossom.earthly.city/aa11',
	type: 'image/jpeg',
	sha256: 'f'.repeat(64),
	dimensions: '1200x800',
}
const IMAGE_B = { url: 'https://blossom.earthly.city/bb22', type: 'image/png' }

describe('temporal sighting images (SPEC §6.1)', () => {
	test('factory round-trips imeta tags; first attachment is primary', async () => {
		const event = await TemporalSightingFactory.create({ title: 'Fox' })
			.images([IMAGE_A, IMAGE_B])
			.sign(sign)

		const images = getTemporalSightingImages(event)
		expect(images).toHaveLength(2)
		expect(images[0]).toMatchObject({
			url: IMAGE_A.url,
			type: 'image/jpeg',
			sha256: IMAGE_A.sha256,
			dimensions: '1200x800',
		})
		expect(getTemporalSightingPrimaryImage(event)?.url).toBe(IMAGE_A.url)
	})

	test('re-ordering changes the primary; empty array strips all imeta tags', async () => {
		const event = await TemporalSightingFactory.create({ title: 'Fox' })
			.images([IMAGE_A, IMAGE_B])
			.images([IMAGE_B, IMAGE_A])
			.sign(sign)
		expect(getTemporalSightingPrimaryImage(event)?.url).toBe(IMAGE_B.url)

		const stripped = await TemporalSightingFactory.create({ title: 'Fox' })
			.images([IMAGE_A])
			.images([])
			.sign(sign)
		expect(getTemporalSightingImages(stripped)).toHaveLength(0)
	})

	test('setImages refuses attachments without a url', () => {
		expect(() => setImages([], [{ type: 'image/jpeg' }])).toThrow('needs a url')
	})
})

describe('live beacon images (SPEC §5.1)', () => {
	test('factory round-trips imeta tags', async () => {
		const event = await LiveBeaconFactory.create({ label: 'Here' }).images([IMAGE_A]).sign(sign)
		const images = getLiveBeaconImages(event)
		expect(images).toHaveLength(1)
		expect(images[0]?.url).toBe(IMAGE_A.url)
	})
})
