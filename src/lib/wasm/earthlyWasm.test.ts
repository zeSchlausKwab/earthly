import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	EarthlyWasmUnavailableError,
	detectVisionSupportHeuristic,
	detectVisionSupportHeuristicOrFallback,
	dissolveLines,
	encodeGeohash,
	explodeMultipart,
	exportShapefileZipBytes,
	isEarthlyWasmAvailable,
	loadEarthlyWasm,
	measureLineMeters,
	mergeToMultipart,
	parseCsvToGeoJson,
	parseShapefileZipBytes,
	resetEarthlyWasmCache,
	simplifyLine,
	tryLoadEarthlyWasm,
	validateGeoJson,
} from './earthlyWasm'

const builtPkgJsPath = resolve(import.meta.dir, 'pkg/earthly_wasm.js')
const builtPkgWasmPath = resolve(import.meta.dir, 'pkg/earthly_wasm_bg.wasm')
const hasBuiltWasmPkg = existsSync(builtPkgJsPath) && existsSync(builtPkgWasmPath)

afterEach(() => {
	resetEarthlyWasmCache()
})

describe('earthlyWasm loader fallback', () => {
	it('returns null from tryLoadEarthlyWasm when package path does not exist', async () => {
		const missingUrl = new URL('./pkg-nonexistent/earthly_wasm.js', import.meta.url).href
		const mod = await tryLoadEarthlyWasm({ moduleUrl: missingUrl })
		expect(mod).toBeNull()
		expect(await isEarthlyWasmAvailable({ moduleUrl: missingUrl })).toBe(false)
	})

	it('throws EarthlyWasmUnavailableError with build instructions when missing', async () => {
		const missingUrl = new URL('./pkg-nonexistent/earthly_wasm.js', import.meta.url).href
		await expect(loadEarthlyWasm({ moduleUrl: missingUrl })).rejects.toBeInstanceOf(
			EarthlyWasmUnavailableError,
		)
		await expect(loadEarthlyWasm({ moduleUrl: missingUrl })).rejects.toThrow(
			'./scripts/build-earthly-wasm.sh',
		)
	})

	it('falls back to no-vision safely when WASM package is unavailable', async () => {
		const missingUrl = new URL('./pkg-nonexistent/earthly_wasm.js', import.meta.url).href
		await expect(tryLoadEarthlyWasm({ moduleUrl: missingUrl })).resolves.toBeNull()
		if (!hasBuiltWasmPkg) {
			expect(await detectVisionSupportHeuristicOrFallback('gpt-4o')).toBe('no-vision')
		}
	})
})

describe.skipIf(!hasBuiltWasmPkg)('earthlyWasm compiled WASM integration', () => {
	it('memoizes the WASM module load across calls', async () => {
		const first = await loadEarthlyWasm()
		const second = await loadEarthlyWasm()
		expect(first).toBe(second)
		expect(await isEarthlyWasmAvailable()).toBe(true)
	})

	it('dissolves connected line segments and deduplicates overlaps', async () => {
		const dissolved = await dissolveLines(
			[
				[
					[16.36, 48.2],
					[16.37, 48.2],
				],
				[
					[16.37, 48.2],
					[16.36, 48.2],
				],
				[
					[16.37, 48.2],
					[16.38, 48.21],
				],
			],
			5.0,
		)
		expect(dissolved).toHaveLength(1)
		expect(dissolved[0]).toHaveLength(3)
	})

	it('merges homogeneous geometries to multipart and explodes back to single-part', async () => {
		const merged = await mergeToMultipart([
			{ type: 'Point', coordinates: [16.37, 48.2] },
			{ type: 'Point', coordinates: [16.38, 48.21] },
		])
		expect(merged.type).toBe('MultiPoint')

		const exploded = await explodeMultipart(merged)
		expect(exploded).toHaveLength(2)
		expect(exploded[0]?.type).toBe('Point')
		expect(exploded[1]?.type).toBe('Point')

		await expect(
			mergeToMultipart([
				{ type: 'Point', coordinates: [16.37, 48.2] },
				{
					type: 'LineString',
					coordinates: [
						[16.36, 48.2],
						[16.37, 48.2],
					],
				},
			]),
		).rejects.toThrow()
	})

	it('parses CSV to GeoJSON and round-trips through Shapefile ZIP bytes', async () => {
		const csv = [
			'name,lat,lon,note',
			'Stephansdom,48.2082,16.3738,Cathedral',
			'Prater,48.2166,16.3958,Park',
		].join('\n')

		const csvResult = await parseCsvToGeoJson(csv, 'vienna.csv')
		expect(csvResult.format).toBe('csv')
		expect(csvResult.featureCount).toBe(2)
		expect(csvResult.geojson.features).toHaveLength(2)

		const zipBytes = await exportShapefileZipBytes(csvResult.geojson, 'Vienna CSV')
		expect(zipBytes).toBeInstanceOf(Uint8Array)
		expect(zipBytes.length).toBeGreaterThan(100)
		// ZIP local file header PK\x03\x04
		expect(zipBytes[0]).toBe(0x50)
		expect(zipBytes[1]).toBe(0x4b)

		const shpResult = await parseShapefileZipBytes(zipBytes, 'vienna_csv.zip')
		expect(shpResult.format).toBe('shp')
		expect(shpResult.featureCount).toBe(2)
	})

	it('detects vision support heuristic with token boundaries', async () => {
		expect(await detectVisionSupportHeuristic('gpt-4o')).toBe('uncertain')
		expect(await detectVisionSupportHeuristic('qwen2.5-vl-7b')).toBe('uncertain')
		expect(await detectVisionSupportHeuristic('marvel-7b')).toBe('no-vision')
		expect(await detectVisionSupportHeuristic('vllm-llama3')).toBe('no-vision')
		expect(await detectVisionSupportHeuristicOrFallback('gpt-4o')).toBe('uncertain')
	})

	it('runs existing core geo and geohash WASM exports cleanly', async () => {
		const geohash = await encodeGeohash(16.3738, 48.2082, 6)
		expect(geohash).toBe('u2edk8')

		const lengthMeters = await measureLineMeters([
			[16.36, 48.2],
			[16.37, 48.2],
		])
		expect(lengthMeters).toBeGreaterThan(700)
		expect(lengthMeters).toBeLessThan(800)

		const simplified = await simplifyLine(
			[
				[16.3, 48.2],
				[16.305, 48.20001],
				[16.31, 48.2],
			],
			20.0,
		)
		expect(simplified).toHaveLength(2)

		const summary = await validateGeoJson({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [16.3738, 48.2082] },
					properties: { name: 'Stephansdom' },
				},
			],
		})
		expect(summary.featureCount).toBe(1)
	})
})
