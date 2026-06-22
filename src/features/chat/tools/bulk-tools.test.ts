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
import { BULK_EDIT_MAX_FEATURES, registerBulkTools } from './bulk-tools'

/**
 * TOOLS-02 / TOOLS-03 / TOOLS-04 / STYLE-01 / STYLE-02 behavior contract, FIRST.
 *
 * The five bulk tools — batch_edit_features, select_features, dedup_features,
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
 *   - select_features + validate_geometry are read-only (no editor mutation).
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
	it('registers batch_edit_features, select_features, dedup_features, validate_geometry, style_by_attribute', () => {
		const names = advertise().map((t) => t.function.name)
		for (const tool of [
			'batch_edit_features',
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
		await Promise.resolve()
		const entry = onlyPendingDiff()
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
// select_features (TOOLS-03 select) — read-only
// ---------------------------------------------------------------------------

describe('select_features (TOOLS-03 select — read-only full-set)', () => {
	it('returns matched ids/summary and performs NO editor mutation', async () => {
		const features = [
			pointFeature('a', [0, 0], { category: 'port' }),
			pointFeature('b', [1, 1], { category: 'port' }),
			pointFeature('c', [2, 2], { category: 'airport' }),
		]
		seedFeatures(features)
		const beforeSnapshot = JSON.stringify(allFeatures())

		const result = await dispatch('select_features', {
			predicate: { all: [{ field: 'category', op: 'eq', value: 'port' }] },
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { matchedIds: string[]; matched: number }
		expect(typed.matched).toBe(2)
		expect([...typed.matchedIds].sort()).toEqual(['a', 'b'])
		// Read-only: nothing changed in the editor.
		expect(JSON.stringify(allFeatures())).toBe(beforeSnapshot)
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
		await Promise.resolve()
		const entry = onlyPendingDiff()
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
