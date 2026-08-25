import { describe, expect, test } from 'bun:test'
import { resolveBinding } from './binding'

// SAFE-01: the binding resolver is pure over one explicitly selected edit target.
// Visible editor state is never supplied as an implicit fallback.

function meta(name: string) {
	return { name, description: '', color: '#3b82f6', customProperties: {} }
}

describe('resolveBinding — SAFE-01', () => {
	test('reflects the explicitly selected target draft', () => {
		const result = resolveBinding({
			collectionMeta: meta('Vienna districts'),
			featureCount: 7,
			targetDraftId: 'draft-abc',
		})

		expect(result.name).toBe('Vienna districts')
		expect(result.unsaved).toBe(true)
		expect(result.featureCount).toBe(7)
		expect(result.targetRequired).toBe(false)
	})

	// (b) Empty collection name falls back to 'Untitled draft' (D-03).
	test("falls back to 'Untitled draft' when collectionMeta.name is empty", () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 3,
			targetDraftId: 'draft-xyz',
		})

		expect(result.name).toBe('Untitled draft')
	})

	test("falls back to 'Untitled draft' when collectionMeta.name is whitespace only", () => {
		const result = resolveBinding({
			collectionMeta: meta('   '),
			featureCount: 1,
			targetDraftId: 'draft-xyz',
		})

		expect(result.name).toBe('Untitled draft')
	})

	// (c) Unsaved state belongs to the selected target, never the merely visible editor.
	test('does not leak visible dirty state into a conversation without a target', () => {
		// open draft, not dirty → unsaved
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				targetDraftId: 'draft-1',
			}).unsaved,
		).toBe(true)

		// no selected target draft, but visible editor is dirty → not this Chat's state
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				targetDraftId: null,
			}).unsaved,
		).toBe(false)

		// no draft, clean, but has features (a loaded/saved dataset) → not unsaved
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				targetDraftId: null,
			}).unsaved,
		).toBe(false)
	})

	// (d) featureCount mirrors the features length.
	test('featureCount equals the supplied features length', () => {
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 42,
				targetDraftId: 'd',
			}).featureCount,
		).toBe(42)
	})

	// Nothing selected is an explicit target-required state, never a creation signal.
	test('requires an explicit editing target when no draft is selected', () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 0,
			targetDraftId: null,
		})

		expect(result.targetRequired).toBe(true)
		// The presentation remains total even though sending is refused.
		expect(result.name).toBe('Untitled draft')
		expect(result.featureCount).toBe(0)
	})

	// A clean, empty, explicitly selected draft is a valid target.
	test('accepts an explicitly selected empty draft as an editing target', () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 0,
			targetDraftId: 'draft-empty',
		})

		expect(result.targetRequired).toBe(false)
		expect(result.unsaved).toBe(true)
	})

	// A visible loaded Dataset is reference context, not a persistent edit target.
	test('requires an editing target when visible features have no draft', () => {
		const result = resolveBinding({
			collectionMeta: meta('Loaded set'),
			featureCount: 5,
			targetDraftId: null,
		})

		expect(result.targetRequired).toBe(true)
		expect(result.featureCount).toBe(0)
	})
})
