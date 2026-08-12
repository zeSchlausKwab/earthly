import { describe, expect, test } from 'bun:test'
import {
	moveGeometryId,
	reorderGeometryIds,
	resolveGeometryRowSelection,
} from './geometryListInteractions'

const ids = ['a', 'b', 'c', 'd', 'e']

describe('resolveGeometryRowSelection', () => {
	test('click replaces selection and establishes the anchor', () => {
		expect(
			resolveGeometryRowSelection(ids, ['a', 'd'], 'a', 'c', {
				additive: false,
				range: false,
			}),
		).toEqual({ selectedIds: ['c'], anchorId: 'c' })
	})

	test('shift click selects the inclusive range in either direction', () => {
		expect(
			resolveGeometryRowSelection(ids, ['d'], 'd', 'b', { additive: false, range: true }),
		).toEqual({ selectedIds: ['b', 'c', 'd'], anchorId: 'd' })
	})

	test('command shift click adds the range to the existing selection', () => {
		expect(
			resolveGeometryRowSelection(ids, ['a'], 'c', 'e', { additive: true, range: true }),
		).toEqual({ selectedIds: ['a', 'c', 'd', 'e'], anchorId: 'c' })
	})

	test('command click toggles one row and moves the anchor', () => {
		expect(
			resolveGeometryRowSelection(ids, ['a', 'c'], 'a', 'c', {
				additive: true,
				range: false,
			}),
		).toEqual({ selectedIds: ['a'], anchorId: 'c' })
	})

	test('shift click without an anchor falls back to a normal click', () => {
		expect(
			resolveGeometryRowSelection(ids, ['a'], null, 'd', { additive: false, range: true }),
		).toEqual({ selectedIds: ['d'], anchorId: 'd' })
	})
})

describe('geometry ordering', () => {
	test('drops before or after the target row', () => {
		expect(reorderGeometryIds(ids, 'a', 'd', 'before')).toEqual(['b', 'c', 'a', 'd', 'e'])
		expect(reorderGeometryIds(ids, 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a', 'e'])
	})

	test('moves one keyboard step while respecting list bounds', () => {
		expect(moveGeometryId(ids, 'c', -1)).toEqual(['a', 'c', 'b', 'd', 'e'])
		expect(moveGeometryId(ids, 'a', -1)).toEqual(ids)
		expect(moveGeometryId(ids, 'e', 1)).toEqual(ids)
	})
})
