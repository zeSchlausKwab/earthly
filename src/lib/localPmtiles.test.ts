import { describe, expect, spyOn, test } from 'bun:test'
import { Compression, TileType } from 'pmtiles'
import {
	classifyPmtilesTileType,
	inspectPmtiles,
	LOCAL_PMTILES_STORAGE_KEY,
	parseStoredLocalPmtiles,
	readStoredLocalPmtiles,
	writeStoredLocalPmtiles,
} from './localPmtiles'

function memoryStorage(initial?: string) {
	const values = new Map<string, string>()
	if (initial) values.set(LOCAL_PMTILES_STORAGE_KEY, initial)
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	}
}

describe('local PMTiles', () => {
	test('classifies supported vector and raster tile types', () => {
		expect(classifyPmtilesTileType(TileType.Mvt)).toBe('vector')
		expect(classifyPmtilesTileType(TileType.Mlt)).toBe('vector')
		expect(classifyPmtilesTileType(TileType.Webp)).toBe('raster')
		expect(() => classifyPmtilesTileType(TileType.Unknown)).toThrow('unsupported tile format')
	})

	test('inspects a PMTiles header without requesting tile data', async () => {
		// Minimal PMTiles v3 header plus an empty root directory. Keep this fixture
		// independent of downloaded basemaps and inspect it through the real parser.
		const bytes = new Uint8Array(128)
		bytes.set(new TextEncoder().encode('PMTiles'))
		const view = new DataView(bytes.buffer)
		view.setUint8(7, 3)
		view.setBigUint64(8, 127n, true)
		view.setBigUint64(16, 1n, true)
		view.setUint8(97, Compression.None)
		view.setUint8(98, Compression.None)
		view.setUint8(99, TileType.Png)
		view.setUint8(101, 21)
		view.setInt32(102, 1215237824, true)
		const requests: Array<[number, number]> = []
		const source = {
			getKey: () => 'synthetic-header',
			getBytes: async (offset: number, length: number) => {
				requests.push([offset, length])
				return { data: bytes.slice(offset, offset + length).buffer }
			},
		}
		const inspected = await inspectPmtiles(source)
		expect(inspected.kind).toBe('raster')
		expect(inspected.maxZoom).toBe(21)
		expect(inspected.bounds[0]).toBeCloseTo(121.5237824)
		expect(requests).toEqual([[0, 16384]])
	})

	test('persists only exact native content-addressed URLs', () => {
		const sha256 = 'a'.repeat(64)
		const selection = {
			version: 1 as const,
			sha256,
			url: `http://earthly-blob.localhost/${sha256}`,
			kind: 'raster' as const,
		}
		const storage = memoryStorage()
		writeStoredLocalPmtiles(selection, storage)
		expect(readStoredLocalPmtiles(storage)).toEqual(selection)
		expect(
			parseStoredLocalPmtiles({ ...selection, url: `https://example.com/${sha256}` }),
		).toBeNull()
		expect(
			parseStoredLocalPmtiles({
				...selection,
				url: `http://earthly-blob.localhost:8080/${sha256}`,
			}),
		).toBeNull()
		writeStoredLocalPmtiles(null, storage)
		expect(readStoredLocalPmtiles(storage)).toBeNull()
	})

	test('storage failures do not prevent the map source from changing in memory', () => {
		const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
		try {
			expect(() =>
				writeStoredLocalPmtiles(
					{
						version: 1,
						sha256: 'b'.repeat(64),
						url: `earthly-blob://localhost/${'b'.repeat(64)}`,
						kind: 'vector',
					},
					{
						setItem: () => {
							throw new Error('quota exceeded')
						},
						removeItem: () => undefined,
					},
				),
			).not.toThrow()
			expect(warning).toHaveBeenCalledTimes(1)
		} finally {
			warning.mockRestore()
		}
	})
})
