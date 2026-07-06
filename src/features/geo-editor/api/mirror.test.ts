/**
 * D-09 read-mirror integrity (Plan 03 Task 1).
 *
 * The Zustand store is a strict one-way DOWNSTREAM read-mirror of the GeoEditor:
 * editor mutation → editor event → store.setFeatures(editor.getAllFeatures()).
 * No caller writes the store directly. This suite proves the mirror reflects the
 * editor after every Authoring-API op — crucially including BULK REPLACE
 * (editor.setFeatures), which emitted nothing before this plan (the stale-sidebar
 * gap) and now emits 'features.replace'.
 *
 * The reverse-sync loop guard itself lives in the React layer (Editor.tsx ref flag)
 * and is exercised there; here we wire the exact same mirror subscription the
 * component installs (create/update/delete/features.replace → setFeatures) and assert
 * (a) store === editor after each op and (b) no duplicate mirror emissions per op.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '../core/test-harness'
import type { GeoEditor } from '../core/GeoEditor'
import { useEditorStore } from '../store'
import { singlePointCollection } from '@/lib/test-fixtures/geo'
import { createAuthoring } from './authoring'

type Unsub = () => void

/**
 * Install the production mirror subscription (mirrors Editor.tsx:65-68) and return
 * both an unsubscribe and a per-op emission counter so we can assert no duplicate
 * mirror writes occur for a single Authoring-API op.
 */
function installMirror(editor: GeoEditor): { unsub: Unsub; emissions: () => number } {
	let emissions = 0
	const updateFeatures = () => {
		emissions += 1
		useEditorStore.getState().setFeatures(editor.getAllFeatures())
	}
	editor.on('create', updateFeatures)
	editor.on('update', updateFeatures)
	editor.on('delete', updateFeatures)
	editor.on('features.replace', updateFeatures)
	return {
		unsub: () => {
			editor.off('create', updateFeatures)
			editor.off('update', updateFeatures)
			editor.off('delete', updateFeatures)
			editor.off('features.replace', updateFeatures)
		},
		emissions: () => emissions,
	}
}

function secondPointFeature(): GeoJSON.Feature {
	return {
		type: 'Feature',
		id: 'test-point-2',
		geometry: { type: 'Point', coordinates: [10, 20] },
		properties: { name: 'second' },
	}
}

describe('store read-mirror integrity (D-09)', () => {
	let editor: GeoEditor
	let mirror: { unsub: Unsub; emissions: () => number }

	beforeEach(() => {
		// Reset the singleton store to a clean baseline before each test.
		useEditorStore.setState({ editor: null, features: [], selectedFeatureIds: [] })
		editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		mirror = installMirror(editor)
	})

	afterEach(() => {
		mirror.unsub()
		editor.destroy()
		useEditorStore.setState({ editor: null, features: [] })
	})

	it('mirrors after authoring.addFeature (append, single create event)', () => {
		const before = mirror.emissions()
		const result = createAuthoring(editor).addFeature(singlePointCollection.features[0])

		expect(result.ok).toBe(true)
		// Exactly one mirror emission for one add (no duplicate create).
		expect(mirror.emissions() - before).toBe(1)
		// Store reflects the editor exactly.
		expect(useEditorStore.getState().features).toEqual(editor.getAllFeatures())
		expect(useEditorStore.getState().features.map((f) => f.id)).toEqual(['test-point-1'])
	})

	it('mirrors after authoring.writeGeoJSON bulk REPLACE (the closed gap)', () => {
		// Seed an existing feature so we can prove replace drops the prior set.
		createAuthoring(editor).addFeature(singlePointCollection.features[0])
		const before = mirror.emissions()

		const result = createAuthoring(editor).writeGeoJSON([secondPointFeature()], { replace: true })

		expect(result.ok).toBe(true)
		// Bulk replace fires exactly one 'features.replace' mirror emission.
		expect(mirror.emissions() - before).toBe(1)
		// Store mirrors the replaced set — no stale sidebar (old test-point-1 gone).
		expect(useEditorStore.getState().features).toEqual(editor.getAllFeatures())
		expect(useEditorStore.getState().features.map((f) => f.id)).toEqual(['test-point-2'])
	})

	it('mirrors after authoring.writeGeoJSON APPEND with dedup', () => {
		createAuthoring(editor).addFeature(singlePointCollection.features[0])
		const before = mirror.emissions()

		// One new id + one duplicate of the existing id → one add, one skip.
		const result = createAuthoring(editor).writeGeoJSON(
			[secondPointFeature(), singlePointCollection.features[0]],
			{ replace: false },
		)

		expect(result.ok).toBe(true)
		expect(result.counts.skippedDuplicates).toBe(1)
		// Only the single genuine add emits — the skipped duplicate emits nothing.
		expect(mirror.emissions() - before).toBe(1)
		expect(useEditorStore.getState().features).toEqual(editor.getAllFeatures())
		expect(useEditorStore.getState().features.map((f) => f.id).sort()).toEqual([
			'test-point-1',
			'test-point-2',
		])
	})

	it('store never diverges from editor across a mixed op sequence', () => {
		const authoring = createAuthoring(editor)
		authoring.addFeature(singlePointCollection.features[0])
		authoring.writeGeoJSON([secondPointFeature()], { replace: false })
		authoring.writeGeoJSON([singlePointCollection.features[0]], { replace: true })

		expect(useEditorStore.getState().features).toEqual(editor.getAllFeatures())
	})
})
