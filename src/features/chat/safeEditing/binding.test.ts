import { describe, expect, test } from 'bun:test'
import { resolveBinding } from './binding'

// SAFE-01 / D-01 / D-02 / D-03: the binding resolver is a PURE function over editor-store
// identity fields. It never mounts React, never subscribes to the store, and never refuses a
// mutation — when nothing is bound it signals auto-create-and-bind (D-02), the chip + gate
// (Plan 04/05) consume its output.

function meta(name: string) {
	return { name, description: '', color: '#3b82f6', customProperties: {} }
}

describe('resolveBinding — SAFE-01', () => {
	// (a) An open draft auto-binds (D-01): identity reflects the open target.
	test('auto-binds to the open draft and reflects its identity (D-01)', () => {
		const result = resolveBinding({
			collectionMeta: meta('Vienna districts'),
			featureCount: 7,
			activeGeoEditDraftId: 'draft-abc',
			isDirty: false,
		})

		expect(result.name).toBe('Vienna districts')
		expect(result.unsaved).toBe(true)
		expect(result.featureCount).toBe(7)
		expect(result.needsAutoCreate).toBe(false)
	})

	// (b) Empty collection name falls back to 'Untitled draft' (D-03).
	test("falls back to 'Untitled draft' when collectionMeta.name is empty", () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 3,
			activeGeoEditDraftId: 'draft-xyz',
			isDirty: false,
		})

		expect(result.name).toBe('Untitled draft')
	})

	test("falls back to 'Untitled draft' when collectionMeta.name is whitespace only", () => {
		const result = resolveBinding({
			collectionMeta: meta('   '),
			featureCount: 1,
			activeGeoEditDraftId: 'draft-xyz',
			isDirty: false,
		})

		expect(result.name).toBe('Untitled draft')
	})

	// (c) unsaved is true for an open draft OR a dirty dataset.
	test('marks unsaved when there is an open draft or the dataset is dirty', () => {
		// open draft, not dirty → unsaved
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				activeGeoEditDraftId: 'draft-1',
				isDirty: false,
			}).unsaved,
		).toBe(true)

		// no draft, but dirty → unsaved
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				activeGeoEditDraftId: null,
				isDirty: true,
			}).unsaved,
		).toBe(true)

		// no draft, clean, but has features (a loaded/saved dataset) → not unsaved
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 2,
				activeGeoEditDraftId: null,
				isDirty: false,
			}).unsaved,
		).toBe(false)
	})

	// (d) featureCount mirrors the features length.
	test('featureCount equals the supplied features length', () => {
		expect(
			resolveBinding({
				collectionMeta: meta('A'),
				featureCount: 42,
				activeGeoEditDraftId: 'd',
				isDirty: false,
			}).featureCount,
		).toBe(42)
	})

	// (e) Nothing bound (no draft, no features, clean) → auto-create-and-bind signal (D-02),
	// NOT a refuse/throw.
	test('signals needsAutoCreate when nothing is bound (D-02, not a refusal)', () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 0,
			activeGeoEditDraftId: null,
			isDirty: false,
		})

		expect(result.needsAutoCreate).toBe(true)
		// Still a shown target identity, never a refuse state.
		expect(result.name).toBe('Untitled draft')
		expect(result.featureCount).toBe(0)
	})

	// A clean, empty, but explicitly-open draft is a bound target — NOT auto-create.
	test('does not signal needsAutoCreate when a draft is open even with zero features', () => {
		const result = resolveBinding({
			collectionMeta: meta(''),
			featureCount: 0,
			activeGeoEditDraftId: 'draft-empty',
			isDirty: false,
		})

		expect(result.needsAutoCreate).toBe(false)
		expect(result.unsaved).toBe(true)
	})

	// Features present (a loaded dataset) is a bound target even with no draft id.
	test('does not signal needsAutoCreate when features are present', () => {
		const result = resolveBinding({
			collectionMeta: meta('Loaded set'),
			featureCount: 5,
			activeGeoEditDraftId: null,
			isDirty: false,
		})

		expect(result.needsAutoCreate).toBe(false)
	})

	test('does not bind a new conversation to another conversations active workspace', () => {
		const result = resolveBinding({
			collectionMeta: meta('Existing map'),
			featureCount: 9,
			activeGeoEditDraftId: 'draft-old',
			isDirty: true,
			activeChatId: 'chat-new',
			workspaceChatSessionId: 'chat-old',
		})

		expect(result.needsAutoCreate).toBe(true)
		expect(result.featureCount).toBe(0)
	})

	test('binds the workspace owned by the active conversation', () => {
		const result = resolveBinding({
			collectionMeta: meta('Conversation map'),
			featureCount: 4,
			activeGeoEditDraftId: 'draft-chat',
			isDirty: true,
			activeChatId: 'chat-active',
			workspaceChatSessionId: 'chat-active',
		})

		expect(result.needsAutoCreate).toBe(false)
		expect(result.featureCount).toBe(4)
	})
})
