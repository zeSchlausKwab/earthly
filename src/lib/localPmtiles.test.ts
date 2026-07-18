import { describe, expect, spyOn, test } from 'bun:test'
import { FileSource, TileType } from 'pmtiles'
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

	test('inspects the repository PMTiles fixture without loading the whole archive', async () => {
		const source = new FileSource(Bun.file('base-assets/flowers.pmtiles') as unknown as File)
		const inspected = await inspectPmtiles(source)
		expect(inspected.kind).toBe('raster')
		expect(inspected.maxZoom).toBe(21)
		expect(inspected.bounds[0]).toBeCloseTo(121.5237824)
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
