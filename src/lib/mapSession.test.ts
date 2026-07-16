import { describe, expect, spyOn, test } from 'bun:test'
import {
	MAP_SOURCE_PREFERENCE_STORAGE_KEY,
	MAP_VIEWPORT_STORAGE_KEY,
	parseStoredMapSourcePreference,
	parseStoredMapViewport,
	readStoredMapSourcePreference,
	readStoredMapViewport,
	writeStoredMapSourcePreference,
	writeStoredMapViewport,
} from './mapSession'

function memoryStorage() {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		values,
	}
}

describe('map session persistence', () => {
	test('round-trips the durable map source choices', () => {
		const storage = memoryStorage()
		writeStoredMapSourcePreference({ version: 1, type: 'blossom' }, storage)
		expect(readStoredMapSourcePreference(storage)).toEqual({ version: 1, type: 'blossom' })
		expect(parseStoredMapSourcePreference({ version: 1, type: 'pmtiles' })).toBeNull()
		expect(storage.values.has(MAP_SOURCE_PREFERENCE_STORAGE_KEY)).toBe(true)
	})

	test('round-trips a bounded map viewport and rejects unsafe values', () => {
		const storage = memoryStorage()
		const viewport = {
			version: 1 as const,
			center: [15.6464, 78.2232] as [number, number],
			zoom: 12,
			bearing: 0,
			pitch: 0,
		}
		writeStoredMapViewport(viewport, storage)
		expect(readStoredMapViewport(storage)).toEqual(viewport)
		expect(parseStoredMapViewport({ ...viewport, center: [181, 0] })).toBeNull()
		expect(parseStoredMapViewport({ ...viewport, zoom: Number.NaN })).toBeNull()
		expect(storage.values.has(MAP_VIEWPORT_STORAGE_KEY)).toBe(true)
	})

	test('storage failures do not interrupt map interactions', () => {
		const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
		try {
			expect(() =>
				writeStoredMapViewport(
					{ version: 1, center: [0, 0], zoom: 2, bearing: 0, pitch: 0 },
					{
						setItem: () => {
							throw new Error('quota exceeded')
						},
					},
				),
			).not.toThrow()
			expect(warning).toHaveBeenCalledTimes(1)
		} finally {
			warning.mockRestore()
		}
	})
})
