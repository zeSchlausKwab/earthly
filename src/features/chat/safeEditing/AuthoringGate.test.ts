import { describe, expect, mock, test } from 'bun:test'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { type GateProposal, createAuthoringGate } from './AuthoringGate'

/**
 * AuthoringGate proofs (SAFE-03 / SAFE-04 / D-07 / D-11 / D-12).
 *
 * The gate is the AI-proposal → editor-apply trust boundary. It is driven
 * HEADLESSLY here: the safety level is injected via `getSafetyLevel`, the
 * Apply/Cancel decision via `requestConfirm` (resolving to 'apply' | 'cancel'),
 * and the inline diff render via `emitDiffBlock`. No React.
 *
 * The gate's contract:
 *   - dry-runs the proposal against a CLONE (never the real editor) → classifies
 *     add/modify/delete via classifyMutation;
 *   - pure-add OR Level 3 → apply immediately (still snapshot + emit diff);
 *   - Level 1 (any change incl. adds) OR Level 2 with modify/delete present →
 *     buffer, emit the diff, await requestConfirm, commit on Apply / discard on Cancel;
 *   - the real apply always routes through createAuthoring (interceptor-routed).
 */

function makePoint(id: string, props: Record<string, unknown> = {}): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [13.4, 52.5] },
		properties: { meta: 'feature', featureId: id, name: id, ...props },
	}
}

/** A proposal that ADDS the given features (appends to the current set). */
function addProposal(toAdd: EditorFeature[]): GateProposal {
	return {
		intent: 'add',
		label: 'add features',
		computeProposed: (current) => [...current, ...toAdd],
		commit: (authoring) => {
			for (const f of toAdd) authoring.addFeature(f)
		},
	}
}

/** A proposal that MODIFIES an existing feature by id (changes its color). */
function modifyProposal(id: string, color: string): GateProposal {
	return {
		intent: 'modify',
		label: 'recolor feature',
		computeProposed: (current) =>
			current.map((f) => (f.id === id ? { ...f, properties: { ...f.properties, color } } : f)),
		commit: (authoring, current) => {
			const target = current.find((f) => f.id === id)
			if (!target) return
			authoring.modifyFeature(id, {
				type: 'Feature',
				geometry: target.geometry,
				properties: { ...target.properties, color },
			})
		},
	}
}

function getColor(editor: GeoEditor, id: string): unknown {
	return editor.getFeature(id)?.properties?.color
}

describe('createAuthoringGate — SAFE-03 / SAFE-04', () => {
	// (a) A PURE-ADD batch applies immediately regardless of level, diff still emitted.
	test('pure-add applies immediately at any level and still emits a diff', async () => {
		for (const level of [1, 2, 3] as const) {
			const editor = createHeadlessEditor()
			const emitDiffBlock = mock((_diff: DatasetDiff) => {})
			// requestConfirm should NOT be awaited for a Level 2/3 pure-add; for Level 1
			// it IS awaited (confirm-all) — resolve 'apply' so the add still lands.
			const requestConfirm = mock(async () => 'apply' as const)
			const gate = createAuthoringGate(editor, {
				getSafetyLevel: () => level,
				emitDiffBlock,
				requestConfirm,
			})

			const result = await gate.review(addProposal([makePoint('a1')]))

			expect(result.status).toBe('applied')
			// The add landed in the real editor.
			expect(editor.getFeature('a1')).toBeDefined()
			// A diff was emitted (preview/record) regardless of level.
			expect(emitDiffBlock).toHaveBeenCalledTimes(1)
			const diff = emitDiffBlock.mock.calls[0]?.[0] as DatasetDiff
			expect(diff.added.map((f) => f.id)).toContain('a1')
			// Level 2/3 pure-add does NOT await confirm; Level 1 does (confirm-all).
			if (level === 1) expect(requestConfirm).toHaveBeenCalledTimes(1)
			else expect(requestConfirm).toHaveBeenCalledTimes(0)
		}
	})

	// (b) Level 2 (default) + modify/delete: buffer → Apply commits + snapshot pushed.
	test('Level 2 + modify buffers, then Apply commits and pushes a snapshot', async () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('m1', { color: '#000000' })])
		const snapshotSpy = mock(editor.pushDatasetSnapshot.bind(editor))
		editor.pushDatasetSnapshot = snapshotSpy as typeof editor.pushDatasetSnapshot

		const emitDiffBlock = mock((_diff: DatasetDiff) => {})
		const requestConfirm = mock(async () => 'apply' as const)
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 2,
			emitDiffBlock,
			requestConfirm,
		})

		const result = await gate.review(modifyProposal('m1', '#ff0000'))

		expect(result.status).toBe('applied')
		// Buffered → awaited confirmation (a modify under Level 2 is destructive).
		expect(requestConfirm).toHaveBeenCalledTimes(1)
		// Apply committed the modify through the facade.
		expect(getColor(editor, 'm1')).toBe('#ff0000')
		// A snapshot was pushed before apply (SAFE-06 undo).
		expect(snapshotSpy).toHaveBeenCalledTimes(1)
		// The diff classified it as a modify, not an add.
		const diff = emitDiffBlock.mock.calls[0]?.[0] as DatasetDiff
		expect(diff.modified).toHaveLength(1)
		expect(diff.added).toHaveLength(0)
	})

	// (b cont.) Level 2 + modify: Cancel leaves the editor UNCHANGED, returns cancelled.
	test('Level 2 + modify: Cancel performs zero editor mutation and reports cancelled', async () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('m1', { color: '#000000' })])
		const before = editor.getAllFeatures()
		const beforeRef = editor.getFeature('m1')

		const requestConfirm = mock(async () => 'cancel' as const)
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 2,
			emitDiffBlock: () => {},
			requestConfirm,
		})

		const result = await gate.review(modifyProposal('m1', '#ff0000'))

		expect(result.status).toBe('cancelled')
		expect(requestConfirm).toHaveBeenCalledTimes(1)
		// Editor is byte-for-byte unchanged: same count, same color, same object identity.
		expect(editor.getAllFeatures()).toHaveLength(before.length)
		expect(getColor(editor, 'm1')).toBe('#000000')
		expect(editor.getFeature('m1')).toBe(beforeRef)
	})

	// (c) Level 1 + pure-add ALSO awaits confirmation (Level 1 confirms everything).
	test('Level 1 + pure-add awaits confirmation (confirm-all)', async () => {
		const editor = createHeadlessEditor()
		const requestConfirm = mock(async () => 'apply' as const)
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 1,
			emitDiffBlock: () => {},
			requestConfirm,
		})

		const result = await gate.review(addProposal([makePoint('a1')]))

		expect(requestConfirm).toHaveBeenCalledTimes(1)
		expect(result.status).toBe('applied')
		expect(editor.getFeature('a1')).toBeDefined()
	})

	test('Level 1 + pure-add: Cancel leaves the editor unchanged', async () => {
		const editor = createHeadlessEditor()
		const requestConfirm = mock(async () => 'cancel' as const)
		const ensureBinding = mock(async () => {})
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 1,
			emitDiffBlock: () => {},
			requestConfirm,
			ensureBinding,
		})

		const result = await gate.review(addProposal([makePoint('a1')]))

		expect(result.status).toBe('cancelled')
		expect(editor.getFeature('a1')).toBeUndefined()
		expect(editor.getAllFeatures()).toHaveLength(0)
		expect(ensureBinding).toHaveBeenCalledTimes(0)
	})

	test('creates a missing binding only after the mutation is approved', async () => {
		const editor = createHeadlessEditor()
		let approved = false
		const requestConfirm = mock(async () => {
			approved = true
			return 'apply' as const
		})
		const ensureBinding = mock(async () => {
			expect(approved).toBe(true)
		})
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 1,
			emitDiffBlock: () => {},
			requestConfirm,
			ensureBinding,
		})

		const result = await gate.review(addProposal([makePoint('a1')]))

		expect(result.status).toBe('applied')
		expect(ensureBinding).toHaveBeenCalledTimes(1)
		expect(editor.getFeature('a1')).toBeDefined()
	})

	// (d) Level 3 + modify/delete applies WITHOUT awaiting confirm but STILL snapshots + emits diff.
	test('Level 3 + modify applies without confirm but snapshots and emits the diff (D-12)', async () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('m1', { color: '#000000' })])
		const snapshotSpy = mock(editor.pushDatasetSnapshot.bind(editor))
		editor.pushDatasetSnapshot = snapshotSpy as typeof editor.pushDatasetSnapshot

		const emitDiffBlock = mock((_diff: DatasetDiff) => {})
		const requestConfirm = mock(async () => 'apply' as const)
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 3,
			emitDiffBlock,
			requestConfirm,
		})

		const result = await gate.review(modifyProposal('m1', '#ff0000'))

		expect(result.status).toBe('applied')
		// Level 3 never awaits the confirm decision (D-12 trust+undo).
		expect(requestConfirm).toHaveBeenCalledTimes(0)
		// But it STILL snapshots and emits the diff so the action is visible + reversible.
		expect(snapshotSpy).toHaveBeenCalledTimes(1)
		expect(emitDiffBlock).toHaveBeenCalledTimes(1)
		expect(getColor(editor, 'm1')).toBe('#ff0000')
	})

	// (e) "Destructive" = modify+delete only (D-07): a pure add never triggers the
	// Level-2 confirm path.
	test('pure add never triggers the Level-2 destructive-confirm path (D-07)', async () => {
		const editor = createHeadlessEditor()
		const requestConfirm = mock(async () => 'apply' as const)
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 2,
			emitDiffBlock: () => {},
			requestConfirm,
		})

		const result = await gate.review(addProposal([makePoint('a1'), makePoint('a2')]))

		expect(result.status).toBe('applied')
		// Level 2 pure-add applies WITHOUT confirmation (only modify/delete are destructive).
		expect(requestConfirm).toHaveBeenCalledTimes(0)
		expect(editor.getFeature('a1')).toBeDefined()
		expect(editor.getFeature('a2')).toBeDefined()
	})

	// The dry-run classification runs against a CLONE — Cancel never mutates the editor,
	// and even the dry-run for an Apply path does not double-apply.
	test('the dry-run never mutates the editor before the apply decision', async () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('m1', { color: '#000000' })])

		let confirmCalledWhileEditorUnchanged = false
		const requestConfirm = mock(async () => {
			// At the moment confirmation is requested, the editor must still be untouched.
			confirmCalledWhileEditorUnchanged = getColor(editor, 'm1') === '#000000'
			return 'apply' as const
		})
		const gate = createAuthoringGate(editor, {
			getSafetyLevel: () => 2,
			emitDiffBlock: () => {},
			requestConfirm,
		})

		await gate.review(modifyProposal('m1', '#ff0000'))

		expect(confirmCalledWhileEditorUnchanged).toBe(true)
		// After apply the change is present (committed once, not doubled).
		expect(getColor(editor, 'm1')).toBe('#ff0000')
	})
})
