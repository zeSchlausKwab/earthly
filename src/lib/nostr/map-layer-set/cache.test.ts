import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { MAP_LAYER_SET_KIND } from '../kinds'
import {
	CACHED_MAP_LAYER_SET_STORAGE_KEY,
	getCachedMapLayerSetInvalidationRevision,
	invalidateCachedMapLayerSetForDeletion,
	parseCachedMapLayerSet,
	readCachedMapLayerSet,
	subscribeCachedMapLayerSetInvalidation,
	writeCachedMapLayerSet,
} from './cache'

function signedAnnouncementFor(secretKey: Uint8Array) {
	return finalizeEvent(
		{
			kind: MAP_LAYER_SET_KIND,
			created_at: 1_700_000_000,
			tags: [
				['d', 'map-source'],
				['name', 'Offline fixture'],
			],
			content: JSON.stringify({
				version: 1,
				layers: [
					{
						id: 'world',
						title: 'World',
						kind: 'chunked-vector',
						blossomServers: ['https://blossom.example'],
						announcement: {
							u4pruy: {
								bbox: [-1, 51, 0, 52],
								file: `${'a'.repeat(64)}.pmtiles`,
								maxZoom: 14,
							},
						},
					},
				],
			}),
		},
		secretKey,
	)
}

function signedAnnouncement() {
	return signedAnnouncementFor(generateSecretKey())
}

describe('trusted map-layer-set cache', () => {
	test('round-trips a signed announcement from the configured trusted publisher', () => {
		const event = signedAnnouncement()
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		}
		writeCachedMapLayerSet(event, [event.pubkey], storage)
		expect(readCachedMapLayerSet([event.pubkey], storage)).toEqual(event)
		expect(values.has(CACHED_MAP_LAYER_SET_STORAGE_KEY)).toBe(true)
	})

	test('rejects a valid event when its publisher is no longer trusted', () => {
		const event = signedAnnouncement()
		expect(parseCachedMapLayerSet(event, ['b'.repeat(64)])).toBeNull()
	})

	test('rejects local tampering even when the pubkey remains trusted', () => {
		const event = signedAnnouncement()
		expect(
			parseCachedMapLayerSet({ ...event, content: event.content.replace('World', 'Forged') }, [
				event.pubkey,
			]),
		).toBeNull()
	})

	test('reactively removes a cached announcement after a verified e-only tombstone', () => {
		const secretKey = generateSecretKey()
		const announcement = signedAnnouncementFor(secretKey)
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: announcement.created_at + 1,
				tags: [['e', announcement.id]],
				content: 'deleted',
			},
			secretKey,
		)
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		}
		writeCachedMapLayerSet(announcement, [announcement.pubkey], storage)
		const before = getCachedMapLayerSetInvalidationRevision()
		let notifications = 0
		const unsubscribe = subscribeCachedMapLayerSetInvalidation(() => {
			notifications += 1
		})

		try {
			expect(invalidateCachedMapLayerSetForDeletion(deletion, [announcement.pubkey], storage)).toBe(
				true,
			)
			expect(readCachedMapLayerSet([announcement.pubkey], storage)).toBeNull()
			expect(getCachedMapLayerSetInvalidationRevision()).toBe(before + 1)
			expect(notifications).toBe(1)
			writeCachedMapLayerSet(announcement, [announcement.pubkey], storage)
			expect(values.has(CACHED_MAP_LAYER_SET_STORAGE_KEY)).toBe(false)
		} finally {
			unsubscribe()
		}
	})

	test('removes an address-deleted announcement but ignores a forged deletion', () => {
		const ownerKey = generateSecretKey()
		const announcement = signedAnnouncementFor(ownerKey)
		const address = `${announcement.kind}:${announcement.pubkey}:map-source`
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: announcement.created_at + 1,
				tags: [['a', address]],
				content: 'deleted',
			},
			ownerKey,
		)
		const forged = { ...deletion, sig: '0'.repeat(128) }
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		}
		writeCachedMapLayerSet(announcement, [announcement.pubkey], storage)

		expect(invalidateCachedMapLayerSetForDeletion(forged, [announcement.pubkey], storage)).toBe(
			false,
		)
		expect(readCachedMapLayerSet([announcement.pubkey], storage)?.id).toBe(announcement.id)
		expect(invalidateCachedMapLayerSetForDeletion(deletion, [announcement.pubkey], storage)).toBe(
			true,
		)
		expect(readCachedMapLayerSet([announcement.pubkey], storage)).toBeNull()
	})
})
