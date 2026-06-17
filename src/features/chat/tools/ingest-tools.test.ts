import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { putDataset, evictDataset } from '@/features/chat/ingest/ingestStore'
import type { ParsedDataset } from '@/features/chat/ingest/datasetTypes'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { isToolError } from './errors'
import { advertise, dispatch, registry } from './registry'

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
