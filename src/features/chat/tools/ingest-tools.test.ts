import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { putDataset, evictDataset } from '@/features/chat/ingest/ingestStore'
import type { ParsedDataset } from '@/features/chat/ingest/datasetTypes'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { isToolError } from './errors'
import {
	BATCH_GEOCODE_MAX_ROWS,
	BATCH_GEOCODE_MIN_INTERVAL_MS,
	type BatchGeocodeOptions,
	batchGeocode,
	registerIngestTools,
	resetGeocodeThrottle,
} from './ingest-tools'
import { advertise, dispatch, register, registry } from './registry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ParsedDataset (sans handle/createdAt) from a row list + schema. */
function makeDataset(
	rows: Record<string, unknown>[],
	overrides: Partial<Omit<ParsedDataset, 'handleId' | 'createdAt' | 'fullRows'>> = {},
): Omit<ParsedDataset, 'handleId' | 'createdAt'> {
	const columns = rows.length > 0 ? Object.keys(rows[0]) : []
	return {
		fileName: 'test.csv',
		type: 'csv',
		schema: columns.map((name) => ({ name, type: 'string' as const })),
		rowCount: rows.length,
		columnCount: columns.length,
		fullRows: rows,
		coordinateColumns: {},
		bytes: 0,
		...overrides,
	}
}

/** N rows with valid lat/lon, named row-0..row-(N-1). */
function gridRows(n: number): Record<string, unknown>[] {
	return Array.from({ length: n }, (_, i) => ({
		name: `row-${i}`,
		lat: 52 + i * 0.001,
		lon: 13 + i * 0.001,
		note: `note-${i}`,
	}))
}

let createdHandles: string[] = []

function put(rows: Record<string, unknown>[], overrides = {}): string {
	const handle = putDataset(makeDataset(rows, overrides))
	createdHandles.push(handle)
	return handle
}

describe('place_dataset_features (INGEST-06 / D-05)', () => {
	beforeEach(() => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
	})

	afterEach(() => {
		for (const h of createdHandles) evictDataset(h)
		createdHandles = []
		useEditorStore.getState().setEditor(null)
	})

	it('registers with kind host-builtin and is advertised', () => {
		expect(registry.get('place_dataset_features')?.kind).toBe('host-builtin')
		const names = advertise().map((t) => t.function.name)
		expect(names).toContain('place_dataset_features')
	})

	it('places ALL rows (fullRows), not just the sample (D-05)', async () => {
		// 200 rows — far more than the ≤15-row summary sample. If placement used the
		// sample, the count would be ≤15.
		const handle = put(gridRows(200))
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { lat: 'lat', lon: 'lon', name: 'name', description: 'note' },
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { importedCount: number }
		expect(typed.importedCount).toBe(200)
		// The Authoring API actually wrote all 200 to the editor.
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(200)
	})

	it('writes through the Authoring API (editor.getAllFeatures), not the store', async () => {
		const handle = put(gridRows(3))
		await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { lat: 'lat', lon: 'lon', name: 'name' },
		})
		const features = useEditorStore.getState().editor?.getAllFeatures() ?? []
		expect(features).toHaveLength(3)
		expect(features[0]?.geometry.type).toBe('Point')
		// name maps to a feature property
		expect(features.map((f) => f.properties?.name).sort()).toEqual(['row-0', 'row-1', 'row-2'])
	})

	it('range-validates coordinates (V5): out-of-range lat/lon are skipped, not written', async () => {
		const rows = [
			{ name: 'ok', lat: 10, lon: 20 },
			{ name: 'bad-lat', lat: 91, lon: 20 },
			{ name: 'bad-lon', lat: 10, lon: 181 },
			{ name: 'bad-neg', lat: -91, lon: -181 },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { lat: 'lat', lon: 'lon', name: 'name' },
		})
		const typed = result as { importedCount: number; skippedInvalid: number }
		expect(typed.importedCount).toBe(1)
		expect(typed.skippedInvalid).toBe(3)
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(1)
	})

	it('unknown handleId → handler_error ToolError, not a crash (D-16)', async () => {
		const result = await dispatch('place_dataset_features', {
			handleId: 'does-not-exist',
			mapping: { lat: 'lat', lon: 'lon' },
		})
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
		expect(result.toolName).toBe('place_dataset_features')
	})

	it('builds geometry from a WKT column', async () => {
		const rows = [
			{ name: 'p', geom: 'POINT(13.4 52.5)' },
			{ name: 'l', geom: 'LINESTRING(13.4 52.5, 13.5 52.6)' },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { wkt: 'geom', name: 'name' },
		})
		expect(isToolError(result)).toBe(false)
		const features = useEditorStore.getState().editor?.getAllFeatures() ?? []
		const types = features.map((f) => f.geometry.type).sort()
		expect(types).toEqual(['LineString', 'Point'])
	})

	it('range-validates WKT coordinates (V5 / CR-03): out-of-range WKT is skipped', async () => {
		const rows = [
			{ name: 'ok', geom: 'POINT(13.4 52.5)' },
			{ name: 'bad-point', geom: 'POINT(9999 9999)' },
			{ name: 'bad-line', geom: 'LINESTRING(0 0, 500 500)' },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { wkt: 'geom', name: 'name' },
		})
		const typed = result as { importedCount: number; skippedInvalid: number }
		expect(typed.importedCount).toBe(1)
		expect(typed.skippedInvalid).toBe(2)
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(1)
	})

	it('range-validates geometry-cell coordinates (V5 / CR-03): out-of-range geometry is skipped', async () => {
		const rows = [
			{ name: 'ok', geometry: { type: 'Point', coordinates: [13.4, 52.5] } },
			{ name: 'bad', geometry: { type: 'Point', coordinates: [5000, 5000] } },
			{
				name: 'bad-str',
				geometry: JSON.stringify({ type: 'Point', coordinates: [200, 95] }),
			},
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { geometry: 'geometry', name: 'name' },
		})
		const typed = result as { importedCount: number; skippedInvalid: number }
		expect(typed.importedCount).toBe(1)
		expect(typed.skippedInvalid).toBe(2)
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(1)
	})

	it('rejects an invalid geometry type / malformed coordinates (CR-03 hardening)', async () => {
		const rows = [
			{ name: 'ok', geometry: { type: 'Point', coordinates: [13.4, 52.5] } },
			{ name: 'bad-type', geometry: { type: 'Banana', coordinates: [13.4, 52.5] } },
			{ name: 'bad-coords', geometry: { type: 'Point', coordinates: 'oops' } },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { geometry: 'geometry', name: 'name' },
		})
		const typed = result as { importedCount: number; skippedInvalid: number }
		expect(typed.importedCount).toBe(1)
		expect(typed.skippedInvalid).toBe(2)
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(1)
	})

	it('WKT POLYGON: closed ring placed, degenerate ring skipped (CR-03 ring closure)', async () => {
		const rows = [
			// Explicitly-closed triangle (first == last).
			{ name: 'closed', geom: 'POLYGON((0 0, 1 0, 1 1, 0 0))' },
			// Unclosed but ≥3 distinct positions → auto-closed and placed.
			{ name: 'unclosed', geom: 'POLYGON((2 2, 3 2, 3 3))' },
			// Degenerate single-point "ring" → rejected.
			{ name: 'degenerate', geom: 'POLYGON((5 5))' },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { wkt: 'geom', name: 'name' },
		})
		const typed = result as { importedCount: number; skippedInvalid: number }
		expect(typed.importedCount).toBe(2)
		expect(typed.skippedInvalid).toBe(1)
		const features = useEditorStore.getState().editor?.getAllFeatures() ?? []
		expect(features.every((f) => f.geometry.type === 'Polygon')).toBe(true)
	})

	it('builds geometry from a GeoJSON-geometry column (object or JSON string)', async () => {
		const rows = [
			{ name: 'obj', geometry: { type: 'Point', coordinates: [13.4, 52.5] } },
			{ name: 'str', geometry: JSON.stringify({ type: 'Point', coordinates: [13.5, 52.6] }) },
		]
		const handle = put(rows)
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { geometry: 'geometry', name: 'name' },
		})
		expect(isToolError(result)).toBe(false)
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(2)
	})

	it('returns counts only — never echoes fullRows back to the model (T-03-18)', async () => {
		const handle = put(gridRows(5))
		const result = await dispatch('place_dataset_features', {
			handleId: handle,
			mapping: { lat: 'lat', lon: 'lon', name: 'name' },
		})
		const serialized = JSON.stringify(result)
		expect(serialized).not.toContain('fullRows')
		expect(serialized).not.toContain('note-4')
		expect(result).toHaveProperty('importedCount')
	})
})

// ---------------------------------------------------------------------------
// batch_geocode (D-06): bounded + throttled + de-duped + skip-and-report
// ---------------------------------------------------------------------------

/** A SearchLocation mock + a fake clock that records throttle delays. */
function makeGeoHarness(resolver: (name: string) => [number, number] | null): {
	options: BatchGeocodeOptions
	calls: string[]
	delays: number[]
} {
	const calls: string[] = []
	const delays: number[] = []
	const client = {
		SearchLocation: async (query: string) => {
			calls.push(query)
			const coord = resolver(query)
			if (!coord) return { result: { query, count: 0, results: [] } }
			return {
				result: {
					query,
					count: 1,
					results: [{ coordinates: { lon: coord[0], lat: coord[1] } }],
				},
			}
		},
	}
	// Virtual clock: `delay` advances it (no real sleep) so the shared throttle
	// (WR-03) is fully deterministic regardless of wall-clock jitter.
	let clock = 0
	const delay = async (ms: number) => {
		delays.push(ms)
		clock += ms
	}
	const now = () => clock
	return {
		options: { client, delay, now, minIntervalMs: BATCH_GEOCODE_MIN_INTERVAL_MS },
		calls,
		delays,
	}
}

describe('batchGeocode (D-06 — bounded, throttled, de-duped, skip-and-report)', () => {
	beforeEach(() => {
		resetGeocodeThrottle()
	})

	it('de-dupes identical names before calling the geo client (call count == unique)', async () => {
		const h = makeGeoHarness((n) => (n === 'Berlin' ? [13.4, 52.5] : [2.3, 48.8]))
		const names = ['Berlin', 'Paris', 'Berlin', 'Berlin', 'Paris']
		const result = await batchGeocode(names, h.options)
		expect(h.calls.sort()).toEqual(['Berlin', 'Paris']) // 2 calls, not 5
		expect(result.total).toBe(2)
		expect(result.located).toBe(2)
		expect(result.failed).toBe(0)
	})

	it('caps to BATCH_GEOCODE_MAX_ROWS — never fires more than the bound', async () => {
		const h = makeGeoHarness(() => [0, 0])
		const names = Array.from({ length: 120 }, (_, i) => `place-${i}`) // 120 unique
		const result = await batchGeocode(names, h.options)
		expect(h.calls.length).toBeLessThanOrEqual(BATCH_GEOCODE_MAX_ROWS)
		expect(h.calls.length).toBe(BATCH_GEOCODE_MAX_ROWS)
		expect(result.total).toBe(BATCH_GEOCODE_MAX_ROWS)
	})

	it('throttles successive lookups to >= BATCH_GEOCODE_MIN_INTERVAL_MS (fake clock)', async () => {
		const h = makeGeoHarness(() => [1, 1])
		await batchGeocode(['a', 'b', 'c'], h.options)
		// 3 unique names → 2 inter-lookup delays, each >= the throttle interval.
		expect(h.delays.length).toBe(2)
		for (const d of h.delays) {
			expect(d).toBeGreaterThanOrEqual(BATCH_GEOCODE_MIN_INTERVAL_MS)
		}
	})

	it('skip-and-report: failed names are reported (located/total/failed), not invented', async () => {
		const h = makeGeoHarness((n) => (n === 'RealCity' ? [10, 20] : null))
		const result = await batchGeocode(['RealCity', 'NowhereLand', 'Atlantis'], h.options)
		expect(result.total).toBe(3)
		expect(result.located).toBe(1)
		expect(result.failed).toBe(2)
		expect(result.coordsByName.get('RealCity')).toEqual([10, 20])
		expect(result.coordsByName.has('NowhereLand')).toBe(false)
	})

	it('a geo-client throw counts as a failure, not a crash', async () => {
		const client = {
			SearchLocation: async () => {
				throw new Error('rate limited')
			},
		}
		const result = await batchGeocode(['x'], { client, delay: async () => {}, minIntervalMs: 0 })
		expect(result.located).toBe(0)
		expect(result.failed).toBe(1)
	})

	it('throttle holds ACROSS back-to-back calls (WR-03): the second call still spaces its first lookup', async () => {
		const h = makeGeoHarness(() => [1, 1])
		// First call: 1 lookup, no leading delay (fresh clock).
		await batchGeocode(['a'], h.options)
		expect(h.delays.length).toBe(0)
		// Second call, immediately after: its first lookup must wait for the shared
		// clock — without the module-level throttle this would fire with no delay.
		await batchGeocode(['b'], h.options)
		expect(h.delays.length).toBe(1)
		expect(h.delays[0]).toBeGreaterThanOrEqual(BATCH_GEOCODE_MIN_INTERVAL_MS)
	})
})

describe('batch_geocode tool (dispatch — places located rows via Authoring API)', () => {
	const TOOL = 'batch_geocode'

	beforeEach(() => {
		resetGeocodeThrottle()
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
	})

	afterEach(() => {
		for (const h of createdHandles) evictDataset(h)
		createdHandles = []
		useEditorStore.getState().setEditor(null)
		// Restore the production registration (no injected mock).
		registerIngestTools(register)
	})

	it('registers with kind remote-mcp and is advertised', () => {
		expect(registry.get(TOOL)?.kind).toBe('remote-mcp')
		expect(advertise().map((t) => t.function.name)).toContain(TOOL)
	})

	it('geocodes a place-name column over the FULL dataset and places located rows, skip-and-report', async () => {
		const h = makeGeoHarness((n) =>
			n === 'Berlin' ? [13.4, 52.5] : n === 'Paris' ? [2.3, 48.8] : null,
		)
		// Re-register the tool with the injected mock client + fake clock.
		registerIngestTools(register, h.options)

		const rows = [
			{ city: 'Berlin', label: 'a' },
			{ city: 'Paris', label: 'b' },
			{ city: 'Berlin', label: 'c' }, // duplicate name, distinct row
			{ city: 'Nowhereville', label: 'd' }, // fails to geocode
		]
		const handle = put(rows)
		const result = await dispatch(TOOL, {
			handleId: handle,
			placeNameColumn: 'city',
			mapping: { name: 'label' },
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as {
			located: number
			total: number
			failed: number
			importedCount: number
			message: string
		}
		// 4 rows have a name; 3 geocode (two Berlin rows + one Paris), 1 fails.
		expect(typed.total).toBe(4)
		expect(typed.located).toBe(3)
		expect(typed.failed).toBe(1)
		// De-dupe: 3 UNIQUE names looked up (the two Berlin rows collapse to one call).
		expect(h.calls.sort()).toEqual(['Berlin', 'Nowhereville', 'Paris'])
		expect(h.calls.filter((n) => n === 'Berlin')).toHaveLength(1)
		// Located rows actually written to the editor via the Authoring API.
		expect(useEditorStore.getState().editor?.getAllFeatures()).toHaveLength(3)
		expect(typed.message).toContain("couldn't be geocoded")
	})

	it('unknown handleId → handler_error ToolError (D-16)', async () => {
		const result = await dispatch(TOOL, { handleId: 'nope', placeNameColumn: 'city' })
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
	})
})
