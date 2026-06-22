import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
// RED (Wave 0): these symbols do not exist yet — they land in Plan 02. The import
// itself must fail to resolve so this file is red on landing (intended W0 state).
import { type Predicate, type PredicateOp, matchesPredicate, selectByPredicate } from './predicate'

/**
 * TOOLS-02 (D-06) + TOOLS-03 (select) acceptance contract, written FIRST.
 *
 * `matchesPredicate(feature, predicate)` evaluates a flat AND-list of operator
 * clauses against `feature.properties.*` only. `selectByPredicate(features, p)`
 * returns ALL matching features (the full set — TOOLS-03 select is not capped).
 *
 * Operator set (06-RESEARCH Pattern 1): eq, neq, exists, missing, contains
 * (substring on string props), in (value-in-set), and the numeric comparisons
 * lt/lte/gt/gte. "missing" semantics (A4, inclusive default): an absent key OR
 * null OR '' OR a whitespace-only string ALL count as missing; a present
 * non-empty value counts as exists.
 *
 * Idiom copied from diff.test.ts: a local pointFeature(id, coords, props) helper,
 * no editor instance needed (the predicate engine is pure / AI-free, D-07).
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

/** Build a single-clause predicate (flat AND of one op). */
function p(op: PredicateOp): Predicate {
	return { all: [op] }
}

describe('matchesPredicate — eq / neq (TOOLS-02 D-06)', () => {
	it('eq matches when the property equals the value', () => {
		const f = pointFeature('a', [0, 0], { category: 'port' })
		expect(matchesPredicate(f, p({ field: 'category', op: 'eq', value: 'port' }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'category', op: 'eq', value: 'airport' }))).toBe(false)
	})

	it('eq matches numeric and boolean values', () => {
		const f = pointFeature('a', [0, 0], { rank: 3, active: true })
		expect(matchesPredicate(f, p({ field: 'rank', op: 'eq', value: 3 }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'active', op: 'eq', value: true }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'active', op: 'eq', value: false }))).toBe(false)
	})

	it('neq is the inverse of eq', () => {
		const f = pointFeature('a', [0, 0], { category: 'port' })
		expect(matchesPredicate(f, p({ field: 'category', op: 'neq', value: 'airport' }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'category', op: 'neq', value: 'port' }))).toBe(false)
	})
})

describe('matchesPredicate — exists / missing (A4 inclusive semantics)', () => {
	it('exists is true only for a present, non-empty value', () => {
		expect(
			matchesPredicate(
				pointFeature('a', [0, 0], { name: 'Berlin' }),
				p({ field: 'name', op: 'exists' }),
			),
		).toBe(true)
	})

	it('exists is false for an absent key, null, empty string, or whitespace-only string', () => {
		const exists = p({ field: 'name', op: 'exists' })
		expect(matchesPredicate(pointFeature('a', [0, 0], {}), exists)).toBe(false)
		expect(matchesPredicate(pointFeature('b', [0, 0], { name: null }), exists)).toBe(false)
		expect(matchesPredicate(pointFeature('c', [0, 0], { name: '' }), exists)).toBe(false)
		expect(matchesPredicate(pointFeature('d', [0, 0], { name: '   ' }), exists)).toBe(false)
	})

	it('missing is the inverse: true for absent / null / empty / whitespace-only', () => {
		const missing = p({ field: 'name', op: 'missing' })
		expect(matchesPredicate(pointFeature('a', [0, 0], {}), missing)).toBe(true)
		expect(matchesPredicate(pointFeature('b', [0, 0], { name: null }), missing)).toBe(true)
		expect(matchesPredicate(pointFeature('c', [0, 0], { name: '' }), missing)).toBe(true)
		expect(matchesPredicate(pointFeature('d', [0, 0], { name: '\t  ' }), missing)).toBe(true)
		expect(matchesPredicate(pointFeature('e', [0, 0], { name: 'Berlin' }), missing)).toBe(false)
	})
})

describe('matchesPredicate — contains (substring on string props)', () => {
	it('contains matches a substring of a string property', () => {
		const f = pointFeature('a', [0, 0], { name: 'Port of Hamburg' })
		expect(matchesPredicate(f, p({ field: 'name', op: 'contains', value: 'Hamburg' }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'name', op: 'contains', value: 'Berlin' }))).toBe(false)
	})

	it('contains is false for a non-string / absent property (no crash)', () => {
		expect(
			matchesPredicate(
				pointFeature('a', [0, 0], { rank: 5 }),
				p({ field: 'rank', op: 'contains', value: '5' }),
			),
		).toBe(false)
		expect(
			matchesPredicate(
				pointFeature('b', [0, 0], {}),
				p({ field: 'name', op: 'contains', value: 'x' }),
			),
		).toBe(false)
	})
})

describe('matchesPredicate — in (value-in-set)', () => {
	it('in matches when the property value is one of the set', () => {
		const f = pointFeature('a', [0, 0], { category: 'port' })
		expect(
			matchesPredicate(f, p({ field: 'category', op: 'in', value: ['port', 'airport'] })),
		).toBe(true)
		expect(
			matchesPredicate(f, p({ field: 'category', op: 'in', value: ['airport', 'rail'] })),
		).toBe(false)
	})

	it('in matches numeric set membership', () => {
		const f = pointFeature('a', [0, 0], { rank: 2 })
		expect(matchesPredicate(f, p({ field: 'rank', op: 'in', value: [1, 2, 3] }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'rank', op: 'in', value: [4, 5] }))).toBe(false)
	})

	it('CR-02: a non-array `value` never throws — the matcher returns false (defensive layer)', () => {
		const f = pointFeature('a', [0, 0], { category: 'port' })
		// The tool layer rejects these up front, but the engine must NEVER throw on bad
		// input. A non-array `value` (cast through unknown) yields no match, not a crash.
		const bad = { field: 'category', op: 'in', value: undefined } as unknown as PredicateOp
		expect(() => matchesPredicate(f, p(bad))).not.toThrow()
		expect(matchesPredicate(f, p(bad))).toBe(false)
	})
})

describe('matchesPredicate — numeric comparisons lt / lte / gt / gte', () => {
	const f = pointFeature('a', [0, 0], { pop: 100 })

	it('lt', () => {
		expect(matchesPredicate(f, p({ field: 'pop', op: 'lt', value: 101 }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'pop', op: 'lt', value: 100 }))).toBe(false)
	})

	it('lte', () => {
		expect(matchesPredicate(f, p({ field: 'pop', op: 'lte', value: 100 }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'pop', op: 'lte', value: 99 }))).toBe(false)
	})

	it('gt', () => {
		expect(matchesPredicate(f, p({ field: 'pop', op: 'gt', value: 99 }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'pop', op: 'gt', value: 100 }))).toBe(false)
	})

	it('gte', () => {
		expect(matchesPredicate(f, p({ field: 'pop', op: 'gte', value: 100 }))).toBe(true)
		expect(matchesPredicate(f, p({ field: 'pop', op: 'gte', value: 101 }))).toBe(false)
	})

	it('a non-numeric / absent property never satisfies a numeric comparison', () => {
		expect(
			matchesPredicate(
				pointFeature('b', [0, 0], { pop: 'lots' }),
				p({ field: 'pop', op: 'gt', value: 0 }),
			),
		).toBe(false)
		expect(
			matchesPredicate(pointFeature('c', [0, 0], {}), p({ field: 'pop', op: 'lt', value: 1000 })),
		).toBe(false)
	})
})

describe('matchesPredicate — flat AND-list (all clauses must pass)', () => {
	it('passes only when EVERY clause matches', () => {
		const f = pointFeature('a', [0, 0], { category: 'port', pop: 500 })
		const both: Predicate = {
			all: [
				{ field: 'category', op: 'eq', value: 'port' },
				{ field: 'pop', op: 'gte', value: 100 },
			],
		}
		expect(matchesPredicate(f, both)).toBe(true)
	})

	it('fails when any single clause fails', () => {
		const f = pointFeature('a', [0, 0], { category: 'port', pop: 50 })
		const both: Predicate = {
			all: [
				{ field: 'category', op: 'eq', value: 'port' },
				{ field: 'pop', op: 'gte', value: 100 },
			],
		}
		expect(matchesPredicate(f, both)).toBe(false)
	})

	it('an empty AND-list matches every feature (vacuous truth)', () => {
		expect(matchesPredicate(pointFeature('a', [0, 0], {}), { all: [] })).toBe(true)
	})
})

describe('selectByPredicate (TOOLS-03 select — returns the FULL matching set)', () => {
	it('returns ALL matching features, not a capped subset', () => {
		// 250 matching features — far more than any model-facing sample cap (≤15).
		const features = Array.from({ length: 250 }, (_, i) =>
			pointFeature(`f-${i}`, [0, i], { category: 'port' }),
		)
		// Plus some non-matches interleaved.
		features.push(pointFeature('air-1', [1, 1], { category: 'airport' }))
		features.push(pointFeature('air-2', [2, 2], { category: 'airport' }))

		const selected = selectByPredicate(features, p({ field: 'category', op: 'eq', value: 'port' }))
		expect(selected).toHaveLength(250)
		expect(selected.every((f) => f.properties?.category === 'port')).toBe(true)
	})

	it('returns an empty array when nothing matches', () => {
		const features = [pointFeature('a', [0, 0], { category: 'rail' })]
		expect(selectByPredicate(features, p({ field: 'category', op: 'eq', value: 'port' }))).toEqual(
			[],
		)
	})

	it('is pure — does not mutate the input list or features', () => {
		const features = [pointFeature('a', [0, 0], { category: 'port' })]
		const snapshot = JSON.stringify(features)
		selectByPredicate(features, p({ field: 'category', op: 'eq', value: 'port' }))
		expect(JSON.stringify(features)).toBe(snapshot)
	})
})
