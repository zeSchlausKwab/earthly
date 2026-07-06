/**
 * buildBubbleEntries — the pure gate deciding which sightings/beacons get a
 * pin bubble (SPEC §5.1/§6.1): sightings need a primary image + unexpired +
 * coordinates; beacons need a point and a non-ended state.
 */

import { describe, expect, test } from 'bun:test'
import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { LiveBeacon, LiveBeaconFactory } from '@/lib/nostr/live-beacon'
import { TemporalSighting, TemporalSightingFactory } from '@/lib/nostr/temporal-sighting'
import { buildBubbleEntries } from './pinBubbleEntries'

const NOW = 1_800_000_000
const store = new EventStore()

const sign =
	(pubkey: string) =>
	async (e: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> => ({
		...e,
		id: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
		pubkey,
		sig: 'c'.repeat(128),
	})

async function makeSighting(opts: { image?: string; expiration?: number; point?: boolean }) {
	let factory = TemporalSightingFactory.create({
		title: 'Fox',
		geometry: opts.point === false ? undefined : { type: 'Point', coordinates: [16.37, 48.2] },
	})
	if (opts.image) factory = factory.images([{ url: opts.image }])
	if (opts.expiration) factory = factory.expiration(opts.expiration)
	const event = await factory.sign(sign('a'.repeat(64)))
	return new TemporalSighting(event, store)
}

async function makeBeacon(opts: { status?: 'live' | 'ended'; expiration?: number }) {
	const event = await LiveBeaconFactory.create({
		label: 'Here',
		status: opts.status ?? 'live',
		geometry: { type: 'Point', coordinates: [16.38, 48.21] },
	})
		.expiration(opts.expiration ?? NOW + 3600)
		.sign(sign('b'.repeat(64)))
	return new LiveBeacon(event, store)
}

describe('buildBubbleEntries', () => {
	test('sighting with primary image and point gets a bubble with that image', async () => {
		const sighting = await makeSighting({ image: 'https://x.example/a.jpg', expiration: NOW + 60 })
		const entries = buildBubbleEntries([sighting], [], NOW)
		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({
			kind: 'sighting',
			imageUrl: 'https://x.example/a.jpg',
			coordinates: [16.37, 48.2],
		})
	})

	test('sightings without an image or expired get no bubble', async () => {
		const noImage = await makeSighting({ expiration: NOW + 60 })
		const expired = await makeSighting({ image: 'https://x.example/a.jpg', expiration: NOW - 1 })
		expect(buildBubbleEntries([noImage, expired], [], NOW)).toHaveLength(0)
	})

	test('live beacon gets an avatar bubble; ended beacon does not', async () => {
		const live = await makeBeacon({ status: 'live' })
		const ended = await makeBeacon({ status: 'ended' })
		const entries = buildBubbleEntries([], [live, ended], NOW)
		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({ kind: 'beacon', coordinates: [16.38, 48.21] })
	})
})
