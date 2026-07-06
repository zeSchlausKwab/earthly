import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
import { classifyMutation } from './diff'
// RED (Wave 0): `classifyModifyKind` does not exist yet — it lands in Plan 04/05
// (STYLE-01 diff headline). We reach it through a NAMESPACE import so the module
// still LOADS (a missing named import would be a hard ESM load error that takes
// the whole file down, including the green classifyMutation tests). With the
// namespace, `diffModule.classifyModifyKind` is `undefined` and only the new
// describe block below is red — the existing classifyMutation tests stay green.
import * as diffModule from './diff'

const classifyModifyKind = (before: EditorFeature, after: EditorFeature) =>
	(
		diffModule as { classifyModifyKind?: (b: EditorFeature, a: EditorFeature) => unknown }
	).classifyModifyKind?.(before, after)

/**
 * SAFE-02 classification proof: `classifyMutation(current, proposed, intent)`
 * buckets a proposed feature set into add / modify / delete by feature id against
 * the current bound set (D-06). A same-id pair is `modified` only when its
 * geometry, a canonical style key, or `properties` differs — identical pairs are
 * not. `deleted` is populated ONLY when intent === 'delete'.
 */

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

describe('classifyMutation (SAFE-02 / D-06)', () => {
	it('(a) a proposed id absent from current → added', () => {
		const current = [pointFeature('a', [0, 0])]
		const proposed = [pointFeature('a', [0, 0]), pointFeature('b', [1, 1])]

		const diff = classifyMutation(current, proposed, 'add')

		expect(diff.added.map((f) => f.id)).toEqual(['b'])
		expect(diff.modified).toEqual([])
		expect(diff.deleted).toEqual([])
	})

	it('(b) a same-id pair with changed geometry → modified (with before + after)', () => {
		const before = pointFeature('a', [0, 0])
		const after = pointFeature('a', [9, 9])
		const current = [before]
		const proposed = [after]

		const diff = classifyMutation(current, proposed, 'modify')

		expect(diff.added).toEqual([])
		expect(diff.modified).toHaveLength(1)
		expect(diff.modified[0]?.before).toBe(before)
		expect(diff.modified[0]?.after).toBe(after)
	})

	it('(c) a same-id pair with a changed canonical style key (fillColor) → modified', () => {
		const before = pointFeature('a', [0, 0], { fillColor: '#ff0000' })
		const after = pointFeature('a', [0, 0], { fillColor: '#00ff00' })

		const diff = classifyMutation([before], [after], 'modify')

		expect(diff.modified).toHaveLength(1)
		expect(diff.modified[0]?.after.properties?.fillColor).toBe('#00ff00')
	})

	it('(d) a same-id pair with changed properties → modified', () => {
		const before = pointFeature('a', [0, 0], { name: 'Old' })
		const after = pointFeature('a', [0, 0], { name: 'New' })

		const diff = classifyMutation([before], [after], 'modify')

		expect(diff.modified).toHaveLength(1)
		expect(diff.modified[0]?.after.properties?.name).toBe('New')
	})

	it('(e) an identical same-id pair → NOT in any bucket', () => {
		const before = pointFeature('a', [0, 0], { name: 'Same', fillColor: '#abcabc' })
		const after = pointFeature('a', [0, 0], { name: 'Same', fillColor: '#abcabc' })

		const diff = classifyMutation([before], [after], 'modify')

		expect(diff.added).toEqual([])
		expect(diff.modified).toEqual([])
		expect(diff.deleted).toEqual([])
	})

	it('(f) intent:delete with a current id absent from proposed → deleted', () => {
		const a = pointFeature('a', [0, 0])
		const b = pointFeature('b', [1, 1])
		const current = [a, b]
		const proposed = [a]

		const diff = classifyMutation(current, proposed, 'delete')

		expect(diff.deleted.map((f) => f.id)).toEqual(['b'])
		expect(diff.added).toEqual([])
		expect(diff.modified).toEqual([])
	})

	it('(g) intent:add with a colliding id → NOT a modify, and deleted stays empty', () => {
		// An add-intent write with a colliding id is the append-path skippedDuplicate
		// (05-RESEARCH line 216), not a modify. A current id absent from proposed is
		// NOT deleted because intent !== 'delete'.
		const before = pointFeature('a', [0, 0], { name: 'Old' })
		const colliding = pointFeature('a', [9, 9], { name: 'New' })
		const orphan = pointFeature('b', [1, 1])
		const current = [before, orphan]
		const proposed = [colliding]

		const diff = classifyMutation(current, proposed, 'add')

		// 'a' collides → not added; intent is 'add' → not modified.
		expect(diff.added).toEqual([])
		expect(diff.modified).toEqual([])
		// 'b' is absent from proposed but intent is not 'delete' → not deleted.
		expect(diff.deleted).toEqual([])
	})
})

/**
 * STYLE-01 (diff headline) acceptance contract, written FIRST (RED — Wave 0).
 *
 * `classifyModifyKind(before, after)` discriminates a `{before, after}` modified
 * pair into 'geometry' | 'style' | 'properties' so `buildDatasetDiffSummary` can
 * special-case a style-only bulk modify → headline `~N restyled` (06-RESEARCH
 * Pattern 5). Geometry wins; otherwise style-only iff every differing property
 * key is in CANONICAL_STYLE_KEYS; anything else is 'properties'.
 *
 * Additive — the classifyMutation describe block above is untouched (Open Q3).
 */
describe('classifyModifyKind (STYLE-01 diff headline)', () => {
	it('a changed geometry → "geometry" (geometry wins over any style/property change)', () => {
		const before = pointFeature('a', [0, 0], { fillColor: '#ff0000', name: 'X' })
		const after = pointFeature('a', [9, 9], { fillColor: '#00ff00', name: 'Y' })
		expect(classifyModifyKind(before, after)).toBe('geometry')
	})

	it('only-CANONICAL_STYLE_KEYS differ → "style"', () => {
		const before = pointFeature('a', [0, 0], { fillColor: '#ff0000', fillOpacity: 1 })
		const after = pointFeature('a', [0, 0], { fillColor: '#00ff00', fillOpacity: 0.5 })
		expect(classifyModifyKind(before, after)).toBe('style')
	})

	it('a non-style property change → "properties"', () => {
		const before = pointFeature('a', [0, 0], { name: 'Old' })
		const after = pointFeature('a', [0, 0], { name: 'New' })
		expect(classifyModifyKind(before, after)).toBe('properties')
	})

	it('a mix of a style key AND a non-style property change → "properties" (not style-only)', () => {
		const before = pointFeature('a', [0, 0], { fillColor: '#ff0000', name: 'Old' })
		const after = pointFeature('a', [0, 0], { fillColor: '#00ff00', name: 'New' })
		expect(classifyModifyKind(before, after)).toBe('properties')
	})
})
