import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { area } from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import { performGeometryOperation } from '@/features/geo-editor/api/geometryOperations'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { importCsvAsFeatureCollection } from '@/features/geo-editor/csvImport'
import { exportShapefile, importShapefile } from '@/features/geo-editor/shapefile'
import {
	EarthlyWasmUnavailableError,
	createCorridorRingWasm,
	detectVisionSupportHeuristic,
	detectVisionSupportHeuristicOrFallback,
	detectVisionSupportWasmHeuristic,
	dissolveLines,
	dissolveLinesWasm,
	encodeGeohash,
	explodeMultipart,
	explodeMultipartWasm,
	exportShapefileZipBytes,
	exportShapefileZipWasm,
	extrudeArrowRingWasm,
	getLoadedEarthlyWasm,
	isEarthlyWasmAvailable,
	loadEarthlyWasm,
	measureLineMeters,
	mergeToMultipart,
	mergeToMultipartWasm,
	parseCsvToGeoJson,
	parseCsvToGeoJsonWasm,
	parseShapefileZipBytes,
	parseShapefileZipWasm,
	preloadEarthlyWasm,
	resetEarthlyWasmCache,
	simplifyLine,
	simplifyLineWasm,
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
		await expect(preloadEarthlyWasm({ moduleUrl: missingUrl })).resolves.toBeNull()
		expect(getLoadedEarthlyWasm()).toBeNull()
		expect(detectVisionSupportWasmHeuristic('gpt-4o')).toBeNull()
		expect(
			dissolveLinesWasm(
				[
					[
						[16.36, 48.2],
						[16.37, 48.2],
					],
				],
				5,
			),
		).toBeNull()
		expect(
			mergeToMultipartWasm([
				{ type: 'Point', coordinates: [16.37, 48.2] },
				{ type: 'Point', coordinates: [16.38, 48.21] },
			]),
		).toBeNull()
		expect(
			explodeMultipartWasm({
				type: 'MultiPoint',
				coordinates: [
					[16.37, 48.2],
					[16.38, 48.21],
				],
			}),
		).toBeNull()
		expect(
			simplifyLineWasm(
				[
					[16.3, 48.2],
					[16.31, 48.2],
				],
				10,
			),
		).toBeNull()
		expect(
			createCorridorRingWasm(
				[
					[16.3, 48.2],
					[16.31, 48.2],
				],
				100,
			),
		).toBeNull()
		expect(
			extrudeArrowRingWasm(
				[
					[16.3, 48.2],
					[16.31, 48.2],
				],
				40,
				80,
			),
		).toBeNull()
		if (!hasBuiltWasmPkg) {
			expect(await detectVisionSupportHeuristicOrFallback('gpt-4o')).toBe('no-vision')
			await expect(parseCsvToGeoJsonWasm('name,lat,lon\nA,48.2,16.37\n')).resolves.toBeNull()
			await expect(
				exportShapefileZipWasm({ type: 'FeatureCollection', features: [] }),
			).resolves.toBeNull()
			await expect(parseShapefileZipWasm(new Uint8Array([1, 2, 3]))).resolves.toBeNull()
		}
	})

	it('keeps editor geometry, CSV, and shapefile callers working before WASM is preloaded', async () => {
		resetEarthlyWasmCache()
		const line: Feature<LineString> = {
			type: 'Feature',
			id: 'fallback-line',
			properties: { name: 'Fallback' },
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0.01, 0],
				],
			},
		}
		const corridor = performGeometryOperation(line, {
			kind: 'corridor',
			width: 200,
			units: 'meters',
		})
		const firstCorridor = corridor.features[0]
		expect(firstCorridor).toBeDefined()
		if (firstCorridor) {
			expect(area(firstCorridor)).toBeGreaterThan(0)
		}

		const editor = createHeadlessEditor()
		editor.setFeatures([
			{
				type: 'Feature',
				id: 'l1',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[16.36, 48.2],
						[16.37, 48.2],
					],
				},
			},
			{
				type: 'Feature',
				id: 'l2',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[16.37, 48.2],
						[16.38, 48.21],
					],
				},
			},
		])
		editor.selectFeatures(['l1', 'l2'])
		expect(editor.dissolveSelectedLines(0.00001).createdCount).toBe(1)

		editor.setFeatures([
			{
				type: 'Feature',
				id: 'p1',
				properties: {},
				geometry: { type: 'Point', coordinates: [16.37, 48.2] },
			},
			{
				type: 'Feature',
				id: 'p2',
				properties: {},
				geometry: { type: 'Point', coordinates: [16.38, 48.21] },
			},
		])
		editor.selectFeatures(['p1', 'p2'])
		expect(editor.combineSelectedFeatures()).toBe(true)
		expect(editor.getAllFeatures()[0]?.geometry.type).toBe('MultiPoint')
		expect(editor.splitSelectedFeatures()).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(2)

		const csvFile = new File(['name,lat,lon\nStephansdom,48.2082,16.3738\n'], 'vienna.csv', {
			type: 'text/csv',
		})
		const importedCsv = await importCsvAsFeatureCollection(csvFile)
		expect(importedCsv.features).toHaveLength(1)
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

	it('wires preloaded synchronous WASM helpers into GeoEditor, CSV, and Shapefile callers', async () => {
		const loaded = await preloadEarthlyWasm()
		expect(loaded).not.toBeNull()
		expect(getLoadedEarthlyWasm()).toBe(loaded)
		expect(detectVisionSupportWasmHeuristic('gpt-4o')).toBe('uncertain')
		expect(detectVisionSupportWasmHeuristic('marvel-7b')).toBe('no-vision')

		const line: Feature<LineString> = {
			type: 'Feature',
			id: 'wasm-line',
			properties: { name: 'Danube' },
			geometry: {
				type: 'LineString',
				coordinates: [
					[16.36, 48.2],
					[16.365, 48.200001],
					[16.37, 48.2],
				],
			},
		}
		const corridor = performGeometryOperation(line, {
			kind: 'corridor',
			width: 200,
			units: 'meters',
		})
		expect(corridor.features[0]?.geometry.type).toBe('Polygon')
		const firstCorridor = corridor.features[0]
		expect(firstCorridor).toBeDefined()
		if (firstCorridor) {
			expect(area(firstCorridor)).toBeGreaterThan(0)
		}

		const editor = createHeadlessEditor()
		await preloadEarthlyWasm()
		editor.setFeatures([
			{
				type: 'Feature',
				id: 'dl1',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[16.36, 48.2],
						[16.37, 48.2],
					],
				},
			},
			{
				type: 'Feature',
				id: 'dl2',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[16.37, 48.2],
						[16.38, 48.21],
					],
				},
			},
		])
		editor.selectFeatures(['dl1', 'dl2'])
		expect(editor.dissolveSelectedLines(0.00001).createdCount).toBe(1)

		editor.setFeatures([
			{
				type: 'Feature',
				id: 'mp1',
				properties: {},
				geometry: { type: 'Point', coordinates: [16.37, 48.2] },
			},
			{
				type: 'Feature',
				id: 'mp2',
				properties: {},
				geometry: { type: 'Point', coordinates: [16.38, 48.21] },
			},
		])
		editor.selectFeatures(['mp1', 'mp2'])
		expect(editor.combineSelectedFeatures()).toBe(true)
		expect(editor.getAllFeatures()[0]?.geometry.type).toBe('MultiPoint')
		expect(editor.splitSelectedFeatures()).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(2)

		const simplified = editor.transform.simplify(line as never, 0.0001)
		expect(simplified.geometry.type).toBe('LineString')
		expect((simplified.geometry as LineString).coordinates).toHaveLength(2)

		const csvFile = new File(
			['name,lat,lon,note\nStephansdom,48.2082,16.3738,Cathedral\nPrater,48.2166,16.3958,Park\n'],
			'vienna.csv',
			{ type: 'text/csv' },
		)
		const csvCollection = await importCsvAsFeatureCollection(csvFile)
		expect(csvCollection.features).toHaveLength(2)

		const exported = await exportShapefile(csvCollection, 'vienna-export')
		const reimported = await importShapefile(
			new File([exported.blob], exported.downloadName, { type: 'application/zip' }),
		)
		expect(reimported.features).toHaveLength(2)
	})
})
