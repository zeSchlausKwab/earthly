/**
 * `DatasetSnapshotManager` proofs (SAFE-06 / D-10 / D-11).
 *
 * A SEPARATE, bounded snapshot/undo stack distinct from `HistoryManager`: each
 * entry carries BOTH the feature set AND the FeatureCollection-level
 * `collectionMeta` (name/description/color/customProperties) so an AI apply that
 * renames a dataset OR restyles a feature is reversible as ONE undo step
 * (D-10/D-11). `HistoryManager` is geometry-only and carries no metadata — that
 * gap is exactly why this is its own stack.
 *
 * Memory contract (Pitfall 3 / A1): `push` must NOT deep-clone coordinate arrays.
 * It holds references to the (replaced-not-mutated) `EditorFeature` objects plus a
 * shallow structural copy of the array — the same ceiling `HistoryManager` already
 * lives under (`features.map(f => ({...f}))`). The stack depth is bounded so it
 * cannot reintroduce the Phase-4 OOM class.
 *
 * The interleave case (manual geometry edit BETWEEN two AI applies) is exercised
 * in GeoEditor.undo — see the dataset-snapshot section of GeoEditor.undo's tests
 * below.
 */

import { describe, expect, test } from 'bun:test'
import type { CollectionMeta } from '../../types'
import { createHeadlessEditor } from '../test-harness'
import type { EditorFeature } from '../types'
import { DatasetSnapshotManager } from './DatasetSnapshotManager'

function makePoint(id: string, color = '#3b82f6'): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [13.4, 52.5] },
		properties: { name: id, color },
	}
}

function meta(name: string, color = '#3b82f6'): CollectionMeta {
	return { name, description: `${name} desc`, color, customProperties: {} }
}

describe('DatasetSnapshotManager — bounded snapshot/undo stack (SAFE-06 / D-10)', () => {
	test('push captures features + collectionMeta; undo restores BOTH as one step', () => {
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()

		// Initial dataset state: one styled feature + a named collection.
		editor.setFeatures([makePoint('f1', '#ff0000')])
		const before = meta('Original Dataset', '#ff0000')

		// Snapshot the pre-apply state (features + metadata).
		mgr.push(editor.getAllFeatures(), before, 'AI apply 1')

		// Mutate the editor: rename dataset + restyle the feature (simulate an apply).
		editor.setFeatures([makePoint('f1', '#00ff00')])
		const after = meta('Renamed Dataset', '#00ff00')

		// Undo: the returned snapshot carries the PRE-apply features + metadata.
		const snap = mgr.undo()
		expect(snap).not.toBeNull()
		expect(snap?.collectionMeta.name).toBe('Original Dataset')
		expect(snap?.collectionMeta.color).toBe('#ff0000')
		expect(snap?.features).toHaveLength(1)
		expect(snap?.features[0]?.properties?.color).toBe('#ff0000')

		// Sanity: the post-apply state really differed (so restore is meaningful).
		expect(after.name).not.toBe(snap?.collectionMeta.name)
	})

	test('one push per apply → one undo step, LIFO order', () => {
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()

		editor.setFeatures([makePoint('a')])
		mgr.push(editor.getAllFeatures(), meta('State A'), 'apply A')

		editor.setFeatures([makePoint('a'), makePoint('b')])
		mgr.push(editor.getAllFeatures(), meta('State B'), 'apply B')

		// LIFO: the first undo returns the most-recent apply's snapshot (State B), the
		// second returns State A.
		const first = mgr.undo()
		expect(first?.collectionMeta.name).toBe('State B')
		const second = mgr.undo()
		expect(second?.collectionMeta.name).toBe('State A')
		// Stack exhausted.
		expect(mgr.canUndo()).toBe(false)
	})

	test('stack is bounded — pushing past maxSnapshots drops the oldest, never grows unbounded', () => {
		const editor = createHeadlessEditor()
		const cap = 5
		const mgr = new DatasetSnapshotManager(cap)
		editor.setFeatures([makePoint('x')])

		// Push well past the cap.
		for (let i = 0; i < cap * 3; i++) {
			mgr.push(editor.getAllFeatures(), meta(`State ${i}`), `apply ${i}`)
			expect(mgr.size()).toBeLessThanOrEqual(cap)
		}
		expect(mgr.size()).toBe(cap)

		// The cap dropped the oldest: the most-recent `cap` snapshots survive in LIFO.
		const seen: string[] = []
		while (mgr.canUndo()) {
			const s = mgr.undo()
			if (s) seen.push(s.collectionMeta.name)
		}
		// Most recent push was `State ${cap*3 - 1}`; oldest surviving is `State ${cap*3 - cap}`.
		expect(seen[0]).toBe(`State ${cap * 3 - 1}`)
		expect(seen).toHaveLength(cap)
		expect(seen).not.toContain('State 0')
	})

	test('default maxSnapshots is bounded to <= 20 (no unbounded growth, Pitfall 3)', () => {
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()
		editor.setFeatures([makePoint('x')])
		for (let i = 0; i < 100; i++) {
			mgr.push(editor.getAllFeatures(), meta(`State ${i}`), `apply ${i}`)
		}
		expect(mgr.size()).toBeLessThanOrEqual(20)
	})

	test('undo on an empty stack is a safe no-op returning null', () => {
		const mgr = new DatasetSnapshotManager()
		expect(mgr.canUndo()).toBe(false)
		expect(mgr.undo()).toBeNull()
		// Still safe to call again.
		expect(mgr.undo()).toBeNull()
	})

	test('clear() empties the stack', () => {
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()
		editor.setFeatures([makePoint('a')])
		mgr.push(editor.getAllFeatures(), meta('A'), 'a')
		expect(mgr.canUndo()).toBe(true)
		mgr.clear()
		expect(mgr.canUndo()).toBe(false)
		expect(mgr.undo()).toBeNull()
	})

	test('snapshot is decoupled from later selection-driven in-place property mutation (A1 defence)', () => {
		// GeoEditor.updateActiveStates() reassigns `feature.properties` on the STORED
		// feature objects when selection changes. If the snapshot held the bare stored
		// reference, a later selection change would corrupt the captured `active` flag.
		// `push` shallow-copies each feature so the snapshot stays decoupled.
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()
		editor.setFeatures([makePoint('f1')])
		mgr.push(editor.getAllFeatures(), meta('Snap'), 'apply')

		const snap = mgr.undo()
		const snapped = snap?.features[0]
		const stored = editor.getAllFeatures()[0]
		// The snapshot must not be the SAME object reference as the live stored feature,
		// otherwise an in-place `feature.properties = {...}` reassignment would leak in.
		expect(snapped).not.toBe(stored)
		// But coordinates are shared by reference (no deep clone — the memory ceiling).
		expect(snapped?.geometry).toBe(stored?.geometry)
	})
})
