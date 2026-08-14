import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	resolvePendingDiff,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import type { SafetyLevel } from '@/features/chat/safeEditing/AuthoringGate'
import { isToolError } from './errors'
import { advertise, dispatch, register, registry } from './registry'
// RED (Wave 0): these symbols do not exist yet — they land in Plans 02/04/05. The
// import itself must fail to resolve so this file is red on landing (intended W0).
import {
	BULK_EDIT_MAX_FEATURES,
	parsePredicate,
	registerBulkTools,
	resolveSelectionScope,
} from './bulk-tools'

/**
 * TOOLS-02 / TOOLS-03 / TOOLS-04 / STYLE-01 / STYLE-02 behavior contract, FIRST.
 *
 * The bulk tools — batch_edit_features, find_features, select_features, dedup_features,
 * validate_geometry, style_by_attribute — driven through the registry dispatch
 * against a headless editor (the ingest-tools.test.ts idiom), asserting against
 * useEditorStore.getState().editor?.getAllFeatures().
 *
 * Pins the security-relevant behavior these tools defend (the threat register):
 *   - host-over-all-ids: declarative batch modifies out-of-sample ids (SAFE-05 /
 *     Pitfall 1) and takes NO features/featureIds array param.
 *   - DoS cap: intelligence id→value map caps at BULK_EDIT_MAX_FEATURES with a
 *     skip-and-report message naming the remainder (mirror batch_geocode).
 *   - gate: a bulk modify snapshots once, classifies `modify`, Cancel rolls back
 *     to zero net mutation.
 *   - dedup deletes via intent:'delete' so Level-2 confirms (Pitfall 6).
 *   - find_features + validate_geometry are read-only; select_features changes
 *     transient map selection but never geometry.
 *   - style_by_attribute materializes canonical style keys; unknown key throws
 *     InvalidStyleOptionError (Pitfall 3); STYLE-02 round-trip preserves them.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pointFeature(
	id: string,
	coordinates: [number, number],
	properties: EditorFeature['properties'] = {},
): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates },
		properties,
	}
}

/** Seed the headless editor with N point features named f-0..f-(N-1). */
function seedFeatures(features: EditorFeature[]): void {
	const editor = useEditorStore.getState().editor
	if (!editor) throw new Error('no editor — call beforeEach setup first')
	editor.setFeatures(features)
}

function allFeatures(): EditorFeature[] {
	return useEditorStore.getState().editor?.getAllFeatures() ?? []
}

function setLevel(level: SafetyLevel): void {
	setSafetyLevelProvider(() => level)
}

/** The single pending diff (asserts there is exactly one), without a `!` assert. */
function onlyPendingDiff() {
	const diffs = getAllPendingDiffs().filter((d) => d.status === 'pending')
	expect(diffs).toHaveLength(1)
	const [entry] = diffs
	if (!entry) throw new Error('expected exactly one pending diff')
	return entry
}

async function waitForPendingDiff() {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const pending = getAllPendingDiffs().filter((diff) => diff.status === 'pending')
		if (pending.length > 0) return onlyPendingDiff()
		await Promise.resolve()
	}
	return onlyPendingDiff()
}

beforeEach(() => {
	const editor = createHeadlessEditor()
	useEditorStore.getState().setEditor(editor)
	registerBulkTools(register)
	clearPendingDiffs()
	setLevel(3) // trust+undo by default → immediate apply unless a test opts into confirm
})

afterEach(() => {
	useEditorStore.getState().setEditor(null)
	clearPendingDiffs()
	setSafetyLevelProvider(() => 2)
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registerBulkTools — all five tools registered + advertised', () => {
	it('registers find/select, edit, dedup, validate, and style tools', () => {
		const names = advertise().map((t) => t.function.name)
		for (const tool of [
			'batch_edit_features',
			'find_features',
			'select_features',
			'dedup_features',
			'validate_geometry',
			'style_by_attribute',
		]) {
			expect(registry.has(tool)).toBe(true)
			expect(names).toContain(tool)
		}
	})
})

// ---------------------------------------------------------------------------
// batch_edit_features — declarative mode (D-04a, host-over-all-ids)
// ---------------------------------------------------------------------------

describe('batch_edit_features declarative (D-04a / SAFE-05 host-over-all-ids)', () => {
	it('modifies ALL matching features by id, INCLUDING out-of-sample ones', async () => {
		// 120 matching features — far more than the model's ≤15-id compacted sample.
		const features = Array.from({ length: 120 }, (_, i) =>
			pointFeature(`f-${i}`, [0, i], { category: 'port' }),
		)
		seedFeatures(features)

		const result = await dispatch('batch_edit_features', {
			mode: 'declarative',
			predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
			ops: [{ kind: 'set', field: 'reviewed', value: true }],
		})
		expect(isToolError(result)).toBe(false)
		// Every matching feature got the new prop — including ids the model never saw.
		const reviewed = allFeatures().filter((f) => f.properties?.reviewed === true)
		expect(reviewed).toHaveLength(120)
		// Specifically an out-of-sample id (f-119) was modified.
		expect(allFeatures().find((f) => f.id === 'f-119')?.properties?.reviewed).toBe(true)
	})

	it('declarative schema has NO features / featureIds array param (Pitfall 1)', () => {
		const tool = advertise().find((t) => t.function.name === 'batch_edit_features')
		const serialized = JSON.stringify(tool?.function.parameters ?? {})
		expect(serialized).not.toContain('featureIds')
		// The declarative path is rule-only; the model never supplies a feature list.
		const props =
			(tool?.function.parameters as { properties?: Record<string, unknown> })?.properties ?? {}
		expect(Object.keys(props)).not.toContain('features')
	})

	it('supports set / copy / template / fillIfMissing declarative ops', async () => {
		seedFeatures([
			pointFeature('a', [0, 0], { name: 'Berlin', country: 'DE', label: 'old' }),
			pointFeature('b', [1, 1], { name: 'Paris', country: 'FR' }), // label missing
		])

		await dispatch('batch_edit_features', {
			mode: 'declarative',
			predicate: { all: [] }, // all features
			ops: [
				{ kind: 'set', field: 'reviewed', value: true },
				{ kind: 'copy', field: 'iso', source: 'country' },
				{ kind: 'template', field: 'title', template: '{name} ({country})' },
				{ kind: 'fillIfMissing', field: 'label', value: 'auto' },
			],
		})

		const a = allFeatures().find((f) => f.id === 'a')
		const b = allFeatures().find((f) => f.id === 'b')
		expect(a?.properties?.reviewed).toBe(true)
		expect(a?.properties?.iso).toBe('DE')
		expect(a?.properties?.title).toBe('Berlin (DE)')
		// fillIfMissing only fires on a missing value (A4): a already had a label.
		expect(a?.properties?.label).toBe('old')
		// b had no label → filled.
		expect(b?.properties?.label).toBe('auto')
		expect(b?.properties?.title).toBe('Paris (FR)')
	})

	it('WR-01: copy / template read SOURCES from the original props, not earlier ops in the batch', async () => {
		seedFeatures([pointFeature('a', [0, 0], { name: 'Berlin' })])
		await dispatch('batch_edit_features', {
			mode: 'declarative',
			predicate: { all: [] },
			ops: [
				{ kind: 'set', field: 'name', value: 'Renamed' }, // overwrite name first
				{ kind: 'copy', field: 'oldName', source: 'name' }, // must copy ORIGINAL name
				{ kind: 'template', field: 'tag', template: 'was {name}' }, // ORIGINAL name
			],
		})
		const a = allFeatures().find((f) => f.id === 'a')
		expect(a?.properties?.name).toBe('Renamed')
		// copy/template read the ORIGINAL 'Berlin', not the in-batch 'Renamed'.
		expect(a?.properties?.oldName).toBe('Berlin')
		expect(a?.properties?.tag).toBe('was Berlin')
	})
})

// ---------------------------------------------------------------------------
// batch_edit_features — intelligence mode (D-04b/D-05, DoS cap)
// ---------------------------------------------------------------------------

describe('batch_edit_features intelligence (D-04b/D-05 cap + skip-and-report)', () => {
	it('caps at BULK_EDIT_MAX_FEATURES and reports the remainder by count', async () => {
		const total = BULK_EDIT_MAX_FEATURES + 12
		const features = Array.from({ length: total }, (_, i) => pointFeature(`f-${i}`, [0, i], {}))
		seedFeatures(features)

		const valuesById: Record<string, string> = {}
		for (let i = 0; i < total; i++) valuesById[`f-${i}`] = `v-${i}`

		const result = await dispatch('batch_edit_features', {
			mode: 'intelligence',
			field: 'note',
			valuesById,
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { edited: number; total: number; message: string }
		expect(typed.edited).toBe(BULK_EDIT_MAX_FEATURES)
		expect(typed.total).toBe(total)
		// skip-and-report message names the remainder (mirror batch_geocode copy).
		expect(typed.message).toMatch(new RegExp(`${BULK_EDIT_MAX_FEATURES} of ${total}`))
		expect(typed.message.toLowerCase()).toContain('rerun')
		// Only the cap was applied.
		expect(allFeatures().filter((f) => typeof f.properties?.note === 'string')).toHaveLength(
			BULK_EDIT_MAX_FEATURES,
		)
	})

	it('skips unknown ids (counted, never a crash)', async () => {
		seedFeatures([pointFeature('a', [0, 0], {}), pointFeature('b', [1, 1], {})])
		const result = await dispatch('batch_edit_features', {
			mode: 'intelligence',
			field: 'note',
			valuesById: { a: 'x', 'does-not-exist': 'y' },
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { edited: number }
		expect(typed.edited).toBe(1)
		expect(allFeatures().find((f) => f.id === 'a')?.properties?.note).toBe('x')
	})
})

// ---------------------------------------------------------------------------
// Gate flow (TOOLS-02 gate) — snapshot once, classify modify, Cancel → zero
// ---------------------------------------------------------------------------

describe('batch_edit_features gate flow (TOOLS-02 gate)', () => {
	it('Level 2: a bulk modify awaits confirm; Cancel rolls back to zero net mutation', async () => {
		setLevel(2) // confirm-destructive (modify counts as destructive)
		const before = [
			pointFeature('a', [0, 0], { category: 'port', note: 'orig-a' }),
			pointFeature('b', [1, 1], { category: 'port', note: 'orig-b' }),
		]
		seedFeatures(before)
		const beforeSnapshot = JSON.stringify(allFeatures())

		const pending = dispatch('batch_edit_features', {
			mode: 'declarative',
			predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
			ops: [{ kind: 'set', field: 'note', value: 'changed' }],
		})

		// The gate emitted exactly one pending diff (one snapshot per batch, D-11).
		const entry = await waitForPendingDiff()
		expect(entry.diff.modified.length).toBe(2)
		expect(entry.diff.added).toEqual([])
		expect(entry.diff.deleted).toEqual([])

		// User cancels.
		resolvePendingDiff(entry.id, 'cancelled')
		await pending

		// Zero net editor mutation (T-05-24 analog).
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
	})
})

// ---------------------------------------------------------------------------
// parsePredicate — per-op `value` validation (CR-02 / T-06-04a)
// ---------------------------------------------------------------------------

describe('parsePredicate per-op value validation (CR-02)', () => {
	it("op:'in' with a non-array (or missing) value throws a catchable validation error, NOT a TypeError", () => {
		// Missing value entirely.
		expect(() => parsePredicate({ all: [{ field: 'category', op: 'in' }] })).toThrow(
			/op 'in' requires an array/,
		)
		// Non-array value (a string).
		expect(() => parsePredicate({ all: [{ field: 'category', op: 'in', value: 'port' }] })).toThrow(
			/op 'in' requires an array/,
		)
	})

	it('numeric ops require a numeric value; eq/neq/contains require a defined value', () => {
		expect(() => parsePredicate({ all: [{ field: 'pop', op: 'gt', value: 'lots' }] })).toThrow(
			/requires a numeric/,
		)
		expect(() => parsePredicate({ all: [{ field: 'name', op: 'eq' }] })).toThrow(/requires a/)
	})

	it('accepts a well-formed in clause and exists/missing (no value needed)', () => {
		expect(parsePredicate({ all: [{ field: 'category', op: 'in', value: ['port'] }] })).toEqual({
			all: [{ field: 'category', op: 'in', value: ['port'] }],
		})
		expect(parsePredicate({ all: [{ field: 'name', op: 'exists' }] })).toEqual({
			all: [{ field: 'name', op: 'exists' }],
		})
	})

	it('a malformed in clause routed through select_features surfaces a self-correctable ToolError, not a raw crash', async () => {
		seedFeatures([pointFeature('a', [0, 0], { category: 'port' })])
		const result = await dispatch('select_features', {
			predicate: { all: [{ field: 'category', op: 'in' }] },
		})
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.message).toMatch(/op 'in' requires an array/)
	})
})

// ---------------------------------------------------------------------------
// gate no-op guard (CR-03) — a zero-change batch leaves no phantom undo step
// ---------------------------------------------------------------------------

describe('batch_edit_features no-op (CR-03)', () => {
	it('a batch that touches ZERO features reports edited 0 and leaves NO phantom undo step', async () => {
		// A predicate matching nothing → runFixAllRule writes nothing → the post-apply
		// diff is genuinely empty. The CR-03 guard must drop the snapshot it pushed so
		// the user does not accrue an "undo AI edit" step that undoes nothing.
		setLevel(3)
		seedFeatures([pointFeature('a', [0, 0], { category: 'port' })])
		const beforeSnapshot = JSON.stringify(allFeatures())
		const result = await dispatch('batch_edit_features', {
			mode: 'declarative',
			predicate: { all: [{ field: 'category', op: 'eq', value: 'nonexistent' }] },
			ops: [{ kind: 'set', field: 'reviewed', value: true }],
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { edited: number; cancelled: boolean }
		expect(typed.edited).toBe(0)
		expect(typed.cancelled).toBe(false)
		// Dataset unchanged.
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
		// No phantom snapshot: undoLastDatasetSnapshot finds nothing to restore.
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('no editor')
		expect(editor.undoLastDatasetSnapshot()).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// find_features + select_features — honest preview vs map-selection semantics
// ---------------------------------------------------------------------------

describe('find_features + select_features (TOOLS-03)', () => {
	it('find_features previews without changing selection or geometry', async () => {
		const features = [
			pointFeature('a', [0, 0], { category: 'port' }),
			pointFeature('b', [1, 1], { category: 'port' }),
			pointFeature('c', [2, 2], { category: 'airport' }),
		]
		seedFeatures(features)
		const beforeSnapshot = JSON.stringify(allFeatures())

		const result = await dispatch('find_features', {
			predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { matchedIds: string[]; matched: number }
		expect(typed.matched).toBe(2)
		expect([...typed.matchedIds].sort()).toEqual(['a', 'b'])
		// Read-only: nothing changed in the editor.
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
		expect(useEditorStore.getState().editor?.getSelectedFeatures()).toEqual([])
	})

	it('select_features replaces the real map selection with every match', async () => {
		seedFeatures([
			pointFeature('a', [0, 0], { category: 'port' }),
			pointFeature('b', [1, 1], { category: 'port' }),
			pointFeature('c', [2, 2], { category: 'airport' }),
		])
		const result = await dispatch('select_features', {
			predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
		})
		expect(isToolError(result)).toBe(false)
		expect((result as { selected: number }).selected).toBe(2)
		expect(
			useEditorStore
				.getState()
				.editor?.getSelectedFeatures()
				.map((feature) => feature.id)
				.sort(),
		).toEqual(['a', 'b'])
		expect(allFeatures()).toHaveLength(3)
	})
})

// ---------------------------------------------------------------------------
// dedup_features (TOOLS-03 dedup) — deletes non-survivors via intent:'delete'
// ---------------------------------------------------------------------------

describe('dedup_features (TOOLS-03 dedup — keep-first, delete intent / Pitfall 6)', () => {
	it('deletes geometry-duplicate non-survivors, keeps the first (survivor)', async () => {
		setLevel(3) // trust+undo → immediate apply, no confirm needed for this assertion
		seedFeatures([
			pointFeature('a', [13.4, 52.5], { name: 'first' }),
			pointFeature('b', [13.4, 52.5], { name: 'second' }), // dup of a
			pointFeature('c', [1, 1], { name: 'unique' }),
		])

		const result = await dispatch('dedup_features', { by: 'geometry' })
		expect(isToolError(result)).toBe(false)
		const ids = allFeatures()
			.map((f) => f.id)
			.sort()
		// keep-first survivor 'a' kept, dup 'b' deleted, unique 'c' kept.
		expect(ids).toEqual(['a', 'c'])
	})

	it('routes the deletion through the gate as intent:delete so Level 2 confirms (Pitfall 6)', async () => {
		setLevel(2) // confirm-destructive — a delete MUST await
		seedFeatures([
			pointFeature('a', [13.4, 52.5], {}),
			pointFeature('b', [13.4, 52.5], {}), // dup of a
		])

		const pending = dispatch('dedup_features', { by: 'geometry' })
		const entry = await waitForPendingDiff()
		// The dropped ids classify as DELETIONS (intent:'delete'), so Level 2 confirms.
		expect(entry.diff.deleted.map((f) => f.id)).toEqual(['b'])

		resolvePendingDiff(entry.id, 'cancelled')
		await pending
		// Cancel → both features still present (zero net mutation).
		expect(
			allFeatures()
				.map((f) => f.id)
				.sort(),
		).toEqual(['a', 'b'])
	})

	it("WR-04: dedup by 'attributes' without keys is REJECTED (no catastrophic mass delete)", async () => {
		setLevel(3)
		seedFeatures([
			pointFeature('a', [0, 0], { code: 'x' }),
			pointFeature('b', [1, 1], { code: 'y' }),
			pointFeature('c', [2, 2], { code: 'z' }),
		])
		const result = await dispatch('dedup_features', { by: 'attributes' })
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.message).toMatch(/requires a non-empty `keys`/)
		// Nothing was deleted — all three features remain.
		expect(allFeatures()).toHaveLength(3)
	})

	it('WR-03: a non-string `keys` entry is rejected, not silently dropped', async () => {
		setLevel(3)
		seedFeatures([pointFeature('a', [0, 0], { code: 'x' })])
		const result = await dispatch('dedup_features', { by: 'attributes', keys: ['code', 123] })
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.message).toMatch(/`keys` must be an array of strings/)
	})
})

// ---------------------------------------------------------------------------
// validate_geometry (TOOLS-04) — read-only report
// ---------------------------------------------------------------------------

describe('validate_geometry (TOOLS-04 — read-only report)', () => {
	it('returns the validation report and performs NO editor mutation', async () => {
		const bowtie: EditorFeature = {
			type: 'Feature',
			id: 'x',
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[1, 1],
						[1, 0],
						[0, 1],
						[0, 0],
					],
				],
			},
			properties: {},
		}
		seedFeatures([bowtie])
		const beforeSnapshot = JSON.stringify(allFeatures())

		const result = await dispatch('validate_geometry', {})
		expect(isToolError(result)).toBe(false)
		const typed = result as { checked: number; withSelfIntersections: number }
		expect(typed.checked).toBe(1)
		expect(typed.withSelfIntersections).toBe(1)
		// Read-only.
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
	})
})

// ---------------------------------------------------------------------------
// style_by_attribute (STYLE-01) + STYLE-02 round-trip
// ---------------------------------------------------------------------------

describe('style_by_attribute (STYLE-01 — materialize canonical style keys per bucket)', () => {
	it('materializes style props on matched buckets; unmatched untouched (no fallback)', async () => {
		setLevel(3)
		seedFeatures([
			pointFeature('p', [0, 0], { category: 'port' }),
			pointFeature('air', [1, 1], { category: 'airport' }),
			pointFeature('rail', [2, 2], { category: 'rail' }), // no bucket, no fallback
		])

		const result = await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: { fillColor: '#0000ff' },
				},
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'airport' }] },
					style: { fillColor: '#ff0000' },
				},
			],
		})
		expect(isToolError(result)).toBe(false)
		expect(allFeatures().find((f) => f.id === 'p')?.properties?.fillColor).toBe('#0000ff')
		expect(allFeatures().find((f) => f.id === 'air')?.properties?.fillColor).toBe('#ff0000')
		// Unmatched + no fallback → untouched (smallest diff, D-03).
		expect(allFeatures().find((f) => f.id === 'rail')?.properties?.fillColor).toBeUndefined()
	})

	it('treats fillColor as a Point icon backing-disc color instead of leaving it inert', async () => {
		setLevel(3)
		seedFeatures([pointFeature('p', [0, 0], { category: 'port', color: '#1e40af' })])

		const result = await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: {
						displayIcon: 'lucide:anchor',
						fillColor: '#dbeafe',
						strokeColor: '#1e40af',
					},
				},
			],
		})

		expect(isToolError(result)).toBe(false)
		const point = allFeatures().find((feature) => feature.id === 'p')
		expect(point?.properties?.color).toBe('#dbeafe')
		expect(point?.properties?.strokeColor).toBe('#1e40af')
		expect(point?.properties?.displayIcon).toBe('lucide:anchor')
	})

	it('applies fallback style ONLY when supplied (D-03)', async () => {
		setLevel(3)
		seedFeatures([
			pointFeature('p', [0, 0], { category: 'port' }),
			pointFeature('rail', [2, 2], { category: 'rail' }),
		])
		await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: { fillColor: '#0000ff' },
				},
			],
			fallback: { style: { fillColor: '#cccccc' } },
		})
		expect(allFeatures().find((f) => f.id === 'p')?.properties?.fillColor).toBe('#0000ff')
		// Unmatched feature now gets the fallback.
		expect(allFeatures().find((f) => f.id === 'rail')?.properties?.fillColor).toBe('#cccccc')
	})

	it('an unknown style key surfaces InvalidStyleOptionError (Pitfall 3)', async () => {
		setLevel(3)
		seedFeatures([pointFeature('p', [0, 0], { category: 'port' })])
		const result = await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: { notARealStyleKey: 'boom' },
				},
			],
		})
		// The unknown-key rejection propagates as a ToolError to the model loop.
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
	})

	it('CR-01: an unknown style key with ≥2 matching features leaves ZERO partial mutation', async () => {
		// ≥2 matching features is what exposes the partial-apply / dangling-snapshot bug:
		// a per-feature throw mid-batch would restyle the first feature then abort. The
		// fix validates style keys UP FRONT (no mutation) AND wraps the gated apply so a
		// throw rolls the snapshot back to zero net mutation.
		setLevel(3)
		seedFeatures([
			pointFeature('p1', [0, 0], { category: 'port' }),
			pointFeature('p2', [1, 1], { category: 'port' }),
		])
		const beforeSnapshot = JSON.stringify(allFeatures())

		const result = await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: { notARealStyleKey: 'boom' },
				},
			],
		})
		expect(isToolError(result)).toBe(true)
		// Zero net mutation — neither feature was restyled (no partial apply).
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
		// And the snapshot stack carries no phantom undo step: an undo restores nothing
		// new (the dataset is already in its pre-call state).
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('no editor')
		expect(editor.undoLastDatasetSnapshot()).toBe(false)
	})

	it('STYLE-02: materialized style props survive JSON.stringify → re-parse round-trip', async () => {
		setLevel(3)
		seedFeatures([pointFeature('p', [0, 0], { category: 'port' })])
		await dispatch('style_by_attribute', {
			buckets: [
				{
					predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
					style: { fillColor: '#0000ff', fillOpacity: 0.5 },
				},
			],
		})
		const collection = {
			type: 'FeatureCollection' as const,
			features: allFeatures(),
		}
		const roundTripped = JSON.parse(JSON.stringify(collection)) as {
			features: EditorFeature[]
		}
		const p = roundTripped.features.find((f) => f.id === 'p')
		expect(p?.properties?.fillColor).toBe('#0000ff')
		expect(p?.properties?.fillOpacity).toBe(0.5)
	})
})

describe('resolveSelectionScope ($selected predicate field)', () => {
	const feature = (id: string, props: Record<string, unknown> = {}) =>
		({ id, geometry: { type: 'Point', coordinates: [0, 0] }, properties: props }) as never

	it('scopes to the current selection with eq:true', () => {
		useEditorStore.setState({ selectedFeatureIds: ['a', 'b'] })
		const scope = resolveSelectionScope({ all: [{ field: '$selected', op: 'eq', value: true }] })
		const out = scope.filter([feature('a'), feature('b'), feature('c')])
		expect(out.map((f: { id: string }) => f.id)).toEqual(['a', 'b'])
	})

	it('inverts with eq:false and combines with property clauses', () => {
		useEditorStore.setState({ selectedFeatureIds: ['a'] })
		const scope = resolveSelectionScope({
			all: [
				{ field: '$selected', op: 'eq', value: false },
				{ field: 'kind', op: 'eq', value: 'tree' },
			],
		})
		const out = scope.filter([
			feature('a', { kind: 'tree' }),
			feature('b', { kind: 'tree' }),
			feature('c', { kind: 'rock' }),
		])
		expect(out.map((f: { id: string }) => f.id)).toEqual(['b'])
	})

	it('rejects unsupported ops on $selected', () => {
		expect(() =>
			resolveSelectionScope({ all: [{ field: '$selected', op: 'contains', value: 'x' }] }),
		).toThrow()
	})

	it('without $selected behaves like a plain predicate', () => {
		useEditorStore.setState({ selectedFeatureIds: ['a'] })
		const scope = resolveSelectionScope({ all: [{ field: 'kind', op: 'eq', value: 'tree' }] })
		const out = scope.filter([feature('a', { kind: 'rock' }), feature('b', { kind: 'tree' })])
		expect(out.map((f: { id: string }) => f.id)).toEqual(['b'])
	})
})
