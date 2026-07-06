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
		const editor = createHeadlessEditor()
		const mgr = new DatasetSnapshotManager()
		editor.setFeatures([makePoint('f1')])
		mgr.push(editor.getAllFeatures(), meta('Snap'), 'apply')

		const snap = mgr.undo()
		const snapped = snap?.features[0]
		const stored = editor.getAllFeatures()[0]
		expect(snapped).not.toBe(stored)
		expect(snapped?.geometry).toBe(stored?.geometry)
	})
})

describe('GeoEditor.undo — snapshot-first dataset undo (SAFE-06 / D-10, Cmd+Z wiring)', () => {
	/** Install an in-memory metadata bridge so the headless editor can capture + restore meta. */
	function bridgeMeta(editor: ReturnType<typeof createHeadlessEditor>, initial: CollectionMeta) {
		const box = { meta: initial }
		editor.setMetadataBridge(
			() => box.meta,
			(m) => {
				box.meta = m
			},
		)
		return box
	}

	test('Cmd+Z (undo) reverts the most-recent AI apply as one step incl. metadata + style', () => {
		const editor = createHeadlessEditor()
		const box = bridgeMeta(editor, meta('Original', '#ff0000'))
		editor.setFeatures([makePoint('f1', '#ff0000')])

		// Gate captures the pre-apply state, then the apply mutates geometry + metadata.
		editor.pushDatasetSnapshot('AI apply')
		editor.setFeatures([makePoint('f1', '#00ff00'), makePoint('f2', '#00ff00')])
		box.meta = meta('Renamed', '#00ff00')

		// One undo reverts BOTH geometry (back to one red feature) AND metadata.
		editor.undo()
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(editor.getAllFeatures()[0]?.properties?.color).toBe('#ff0000')
		expect(box.meta.name).toBe('Original')
		expect(box.meta.color).toBe('#ff0000')
	})

	test('chat-callable undoLastDatasetSnapshot shares the same mechanism as Cmd+Z', () => {
		const editor = createHeadlessEditor()
		const box = bridgeMeta(editor, meta('Before'))
		editor.setFeatures([makePoint('a')])
		editor.pushDatasetSnapshot('AI apply')
		editor.setFeatures([makePoint('a'), makePoint('b')])
		box.meta = meta('After')

		const consumed = editor.undoLastDatasetSnapshot()
		expect(consumed).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(box.meta.name).toBe('Before')
		// Stack now empty — a second call is a safe no-op.
		expect(editor.undoLastDatasetSnapshot()).toBe(false)
	})

	test('interleave: manual geometry edit BETWEEN two AI applies undoes in timeline order', async () => {
		const editor = createHeadlessEditor()
		bridgeMeta(editor, meta('Start'))

		// AI apply 1: snapshot pre-state (empty), then apply adds f1.
		editor.pushDatasetSnapshot('AI apply 1')
		editor.setFeatures([makePoint('f1')])

		// Manual geometry edit BETWEEN applies: add f-manual via the geometry path
		// (records a HistoryManager 'create' action). A small delay guarantees a
		// strictly-later timestamp than apply 1's snapshot.
		await new Promise((r) => setTimeout(r, 2))
		editor.addFeature(makePoint('f-manual'))
		expect(
			editor
				.getAllFeatures()
				.map((f) => f.id)
				.sort(),
		).toEqual(['f-manual', 'f1'])

		// AI apply 2: snapshot pre-state (f1 + f-manual), then apply adds f2.
		await new Promise((r) => setTimeout(r, 2))
		editor.pushDatasetSnapshot('AI apply 2')
		editor.setFeatures([makePoint('f1'), makePoint('f-manual'), makePoint('f2')])

		// Undo #1: most-recent event is AI apply 2 → snapshot restores to {f1, f-manual}.
		editor.undo()
		expect(
			editor
				.getAllFeatures()
				.map((f) => f.id)
				.sort(),
		).toEqual(['f-manual', 'f1'])

		// Undo #2: next-most-recent event is the MANUAL geometry edit → HistoryManager
		// undo removes f-manual, leaving {f1}. Proves the two stacks compose on one
		// timeline without corrupting each other.
		editor.undo()
		expect(
			editor
				.getAllFeatures()
				.map((f) => f.id)
				.sort(),
		).toEqual(['f1'])

		// Undo #3: the oldest event is AI apply 1 → snapshot restores the empty pre-state.
		editor.undo()
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	test('undo with neither stack populated is a safe no-op', () => {
		const editor = createHeadlessEditor()
		bridgeMeta(editor, meta('Empty'))
		expect(() => editor.undo()).not.toThrow()
	})
})
