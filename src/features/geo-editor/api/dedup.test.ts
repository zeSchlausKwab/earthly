import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
// RED (Wave 0): these symbols do not exist yet — they land in Plan 03. The import
// itself must fail to resolve so this file is red on landing (intended W0 state).
import { type DedupBy, type DuplicateGroup, findDuplicateGroups } from './dedup'

/**
 * TOOLS-03 (dedup) acceptance contract, written FIRST.
 *
 * `findDuplicateGroups(features, { by, keys? })` is PURE — it groups features
 * that are duplicates by geometry, by chosen attribute `keys`, or by both, and
 * returns each group's survivor (keep-first: the first in input order) plus the
 * non-survivor ids to delete. It mutates NOTHING and holds NO editor reference
 * (06-RESEARCH §TOOLS-03 dedup; the gate-routed delete lives in the tool layer).
 *
 * Idiom copied from diff.test.ts: a local feature builder, no editor instance.
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

describe("findDuplicateGroups — by: 'geometry' (keep-first survivor)", () => {
	it('groups features with identical geometry; survivor is first in input order', () => {
		const features = [
			pointFeature('a', [13.4, 52.5], { name: 'first' }),
			pointFeature('b', [13.4, 52.5], { name: 'second' }), // same geometry as a
			pointFeature('c', [1, 1], { name: 'unique' }),
			pointFeature('d', [13.4, 52.5], { name: 'third' }), // same geometry as a
		]
		const groups: DuplicateGroup[] = findDuplicateGroups(features, { by: 'geometry' })
		expect(groups).toHaveLength(1)
		expect(groups[0]?.survivorId).toBe('a') // keep-first
		expect([...(groups[0]?.duplicateIds ?? [])].sort()).toEqual(['b', 'd'])
	})

	it('differing geometry is NOT a duplicate', () => {
		const features = [pointFeature('a', [0, 0]), pointFeature('b', [1, 1])]
		expect(findDuplicateGroups(features, { by: 'geometry' })).toHaveLength(0)
	})
})

describe("findDuplicateGroups — by: 'attributes' (chosen key tuple)", () => {
	it('groups features whose chosen attribute keys are identical', () => {
		const features = [
			pointFeature('a', [0, 0], { code: 'X', region: 'north' }),
			pointFeature('b', [9, 9], { code: 'X', region: 'north' }), // same code+region, diff geometry
			pointFeature('c', [0, 0], { code: 'Y', region: 'north' }),
		]
		const groups = findDuplicateGroups(features, { by: 'attributes', keys: ['code', 'region'] })
		expect(groups).toHaveLength(1)
		expect(groups[0]?.survivorId).toBe('a')
		expect(groups[0]?.duplicateIds).toEqual(['b'])
	})

	it('a difference in any chosen key breaks the group', () => {
		const features = [
			pointFeature('a', [0, 0], { code: 'X', region: 'north' }),
			pointFeature('b', [0, 0], { code: 'X', region: 'south' }),
		]
		expect(
			findDuplicateGroups(features, { by: 'attributes', keys: ['code', 'region'] }),
		).toHaveLength(0)
	})
})

describe("findDuplicateGroups — by: 'both' (geometry AND attributes)", () => {
	it('groups only when BOTH geometry and chosen keys match', () => {
		const features = [
			pointFeature('a', [13.4, 52.5], { code: 'X' }),
			pointFeature('b', [13.4, 52.5], { code: 'X' }), // same geom + same code → dup of a
			pointFeature('c', [13.4, 52.5], { code: 'Y' }), // same geom, diff code → NOT a dup
		]
		const groups = findDuplicateGroups(features, { by: 'both', keys: ['code'] })
		expect(groups).toHaveLength(1)
		expect(groups[0]?.survivorId).toBe('a')
		expect(groups[0]?.duplicateIds).toEqual(['b'])
	})
})

describe('findDuplicateGroups — no duplicates and purity', () => {
	it('returns zero groups when there are no duplicates', () => {
		const features = [
			pointFeature('a', [0, 0], { code: 'X' }),
			pointFeature('b', [1, 1], { code: 'Y' }),
		]
		const by: DedupBy = 'geometry'
		expect(findDuplicateGroups(features, { by })).toEqual([])
	})

	it('is PURE — returns groups/ids only and mutates neither the list nor the features', () => {
		const features = [
			pointFeature('a', [0, 0], { code: 'X' }),
			pointFeature('b', [0, 0], { code: 'X' }),
		]
		const snapshot = JSON.stringify(features)
		const groups = findDuplicateGroups(features, { by: 'geometry' })
		// Input untouched (no editor reference, no in-place mutation).
		expect(JSON.stringify(features)).toBe(snapshot)
		// The function reports the survivor + non-survivor ids; it does not delete.
		expect(groups[0]?.survivorId).toBe('a')
		expect(groups[0]?.duplicateIds).toEqual(['b'])
	})
})
