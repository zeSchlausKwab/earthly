/**
 * D-01 read snapshot proofs (Task 1):
 *  - ingest rows by handle (full rows, NOT the model summary) — T-04-10 privacy seam,
 *  - current editor features as PLAIN GeoJSON (not live EditorFeature instances) — T-04-08,
 *  - frozen / fail-closed `structuredClone` (a non-clonable leak throws, never a partial snapshot).
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { evictDataset, putDataset } from '@/features/chat/ingest/ingestStore'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { buildReadSnapshot } from './readSnapshot'

const seededHandles: string[] = []

afterEach(() => {
	for (const h of seededHandles) evictDataset(h)
	seededHandles.length = 0
})

function seedDataset(rows: Record<string, unknown>[]): string {
	const handle = putDataset({
		fileName: 'overfly-fees.csv',
		type: 'csv',
		schema: [
			{ name: 'country', type: 'string' },
			{ name: 'eurPerKm', type: 'number' },
		],
		rowCount: rows.length,
		columnCount: 2,
		fullRows: rows,
		coordinateColumns: {},
		bytes: 128,
	})
	seededHandles.push(handle)
	return handle
}

function makePointFeature(id: string, lon: number, lat: number): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [lon, lat] },
		properties: { name: id },
	} as EditorFeature
}

describe('buildReadSnapshot (D-01)', () => {
	it('Test 1 — exposes the FULL ingest rows by handle; unknown handle → null', () => {
		const rows = [
			{ country: 'AT', eurPerKm: 1.2 },
			{ country: 'SI', eurPerKm: 0.9 },
		]
		const handle = seedDataset(rows)
		const editor = createHeadlessEditor()

		const snapshot = buildReadSnapshot([handle, 'does-not-exist'], editor)

		expect(snapshot.datasets[handle]).toEqual(rows)
		expect(snapshot.datasets['does-not-exist']).toBeNull()
	})

	it('Test 2 — current features become plain GeoJSON, decoupled from the editor', () => {
		const editor = createHeadlessEditor()
		editor.addFeature(makePointFeature('a', 1, 1))
		editor.addFeature(makePointFeature('b', 2, 2))
		editor.addFeature(makePointFeature('c', 3, 3))

		const snapshot = buildReadSnapshot([], editor)

		expect(snapshot.features).toHaveLength(3)
		for (const f of snapshot.features) {
			expect(f.type).toBe('Feature')
			expect(f.geometry).toBeDefined()
		}

		// Mutating a returned feature must NOT mutate the live editor.
		const cloned = snapshot.features[0]
		;(cloned.geometry as GeoJSON.Point).coordinates = [999, 999]
		const live = editor.getFeature(String(cloned.id)) as EditorFeature
		expect((live.geometry as GeoJSON.Point).coordinates).not.toEqual([999, 999])
	})

	it('Test 3 — fail-closed: a non-clonable property throws (no partial silent snapshot)', () => {
		const editor = createHeadlessEditor()
		const poisoned = makePointFeature('poison', 5, 5)
		// A function is not structured-clonable → structuredClone must throw (Pitfall 5).
		;(poisoned.properties as Record<string, unknown>).evil = () => 42
		editor.addFeature(poisoned)

		expect(() => buildReadSnapshot([], editor)).toThrow()
	})
})
