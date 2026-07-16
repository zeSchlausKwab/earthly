import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { MAP_LAYER_SET_KIND } from '../kinds'
import {
	CACHED_MAP_LAYER_SET_STORAGE_KEY,
	parseCachedMapLayerSet,
	readCachedMapLayerSet,
	writeCachedMapLayerSet,
} from './cache'

function signedAnnouncement() {
	return finalizeEvent(
		{
			kind: MAP_LAYER_SET_KIND,
			created_at: 1_700_000_000,
			tags: [['name', 'Offline fixture']],
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
		generateSecretKey(),
	)
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
})
