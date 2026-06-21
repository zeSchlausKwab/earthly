import { describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { runFixAllRule } from './fixAll'

/**
 * fixAll proofs (SAFE-05 / Pitfall 2 / A3 / T-05-16).
 *
 * "Fix all" must evaluate the rule HOST-SIDE over the FULL id-keyed set
 * (`editor.getAllFeatures()`), never over the model's compacted view
 * (`summarizeFeaturesForPrompt` sends only `sampleNames`/`sampleIds`, capped at
 * 6 ids). The model supplies the RULE (a predicate + a transform); the HOST
 * supplies the LIST. A feature the model never "saw" (outside the sample) MUST
 * still be modified — otherwise a "fix all" silently skips out-of-context data.
 *
 * Modifications route through the Plan-01 `modifyFeature` facade verb (so they
 * flow through runInterceptors and are gate-/snapshot-aware when invoked under
 * the AuthoringGate). The runner takes NO `features` argument (A3 guard).
 */

function makePoint(id: string, category: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [13.4, 52.5] },
		properties: { meta: 'feature', featureId: id, name: id, category },
	}
}

describe('runFixAllRule — SAFE-05', () => {
	// (a) The rule applies to ALL matching features in getAllFeatures(), INCLUDING
	// ids that were NOT in the simulated model sample (out-of-context features).
	test('applies the rule to features outside the model sample', () => {
		const editor = createHeadlessEditor()

		// Seed 12 features — MORE than any compacted model view carries (sampleIds is
		// capped at 6). Half are 'park', half are 'other'.
		const features: EditorFeature[] = []
		for (let i = 0; i < 12; i++) {
			features.push(makePoint(`f${i}`, i % 2 === 0 ? 'park' : 'other'))
		}
		editor.setFeatures(features)

		// The model only "saw" a sample of ≤6 ids (f0..f5). f6, f8, f10 are 'park'
		// features OUTSIDE that sample — they must still be fixed.
		const result = runFixAllRule(editor, {
			predicate: (f) => f.properties?.category === 'park',
			transform: (f) => ({
				...f,
				properties: { ...f.properties, category: 'green-space' },
			}),
		})

		// All 6 'park' features (f0,f2,f4,f6,f8,f10) were retagged.
		expect(result.matched).toBe(6)
		expect(result.modified).toBe(6)

		// Out-of-sample features (f6, f8, f10) were modified — the SAFE-05 guarantee.
		expect(editor.getFeature('f6')?.properties?.category).toBe('green-space')
		expect(editor.getFeature('f8')?.properties?.category).toBe('green-space')
		expect(editor.getFeature('f10')?.properties?.category).toBe('green-space')

		// A non-matching feature is untouched.
		expect(editor.getFeature('f1')?.properties?.category).toBe('other')
	})

	// (b) Reports the count it touched over the FULL set.
	test('reports matched/modified counts over the full set', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([
			makePoint('a', 'x'),
			makePoint('b', 'x'),
			makePoint('c', 'y'),
		])

		const result = runFixAllRule(editor, {
			predicate: (f) => f.properties?.category === 'x',
			transform: (f) => ({ ...f, properties: { ...f.properties, category: 'X' } }),
		})

		expect(result.matched).toBe(2)
		expect(result.modified).toBe(2)
		expect(editor.getFeature('a')?.properties?.category).toBe('X')
		expect(editor.getFeature('b')?.properties?.category).toBe('X')
		expect(editor.getFeature('c')?.properties?.category).toBe('y')
	})

	// (c) The runner derives the set from getAllFeatures(), not from any passed-in
	// list — its signature takes a predicate/transform, never a `features` array.
	test('derives the set from getAllFeatures(), ignoring any caller-supplied list', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('only', 'match')])

		// Even if a caller wanted to scope to a stale list, the runner has no such
		// parameter — it always reads the live editor set. We assert the live feature
		// is modified (proving the source is getAllFeatures()).
		const result = runFixAllRule(editor, {
			predicate: (f) => f.properties?.category === 'match',
			transform: (f) => ({ ...f, properties: { ...f.properties, category: 'done' } }),
		})

		expect(result.matched).toBe(1)
		expect(editor.getFeature('only')?.properties?.category).toBe('done')
	})

	// (d) A no-match predicate touches zero features without error.
	test('a no-match predicate touches zero features without error', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('a', 'x'), makePoint('b', 'y')])

		const result = runFixAllRule(editor, {
			predicate: () => false,
			transform: (f) => f,
		})

		expect(result.matched).toBe(0)
		expect(result.modified).toBe(0)
		// Editor is unchanged.
		expect(editor.getFeature('a')?.properties?.category).toBe('x')
		expect(editor.getFeature('b')?.properties?.category).toBe('y')
	})

	// Empty editor is a clean no-op.
	test('an empty dataset is a clean no-op', () => {
		const editor = createHeadlessEditor()
		const result = runFixAllRule(editor, {
			predicate: () => true,
			transform: (f) => f,
		})
		expect(result.matched).toBe(0)
		expect(result.modified).toBe(0)
	})
})
