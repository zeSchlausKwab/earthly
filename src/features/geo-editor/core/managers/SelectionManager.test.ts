import { describe, expect, test } from 'bun:test'
import type { Geometry } from 'geojson'
import type { EditorFeature } from '../types'
import { SelectionManager } from './SelectionManager'

function feature(id: string, geometry: Geometry): EditorFeature {
	return { type: 'Feature', id, properties: {}, geometry }
}

const bounds = { west: -1, east: 1, south: -1, north: 1 }

describe('SelectionManager coordinate bounds', () => {
	test.each([
		{ type: 'Point', coordinates: [1, -1, 20] },
		{
			type: 'MultiPoint',
			coordinates: [
				[9, 9],
				[0, 0],
			],
		},
		{
			type: 'LineString',
			coordinates: [
				[9, 9],
				[0, 0],
			],
		},
		{
			type: 'MultiLineString',
			coordinates: [
				[],
				[
					[9, 9],
					[0, 0],
				],
			],
		},
		{
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[4, 0],
					[0, 4],
					[0, 0],
				],
			],
		},
		{
			type: 'MultiPolygon',
			coordinates: [
				[],
				[
					[
						[0, 0],
						[4, 0],
						[0, 4],
						[0, 0],
					],
				],
			],
		},
	] satisfies Geometry[])('selects $type when a finite vertex lies within inclusive bounds', (geometry) => {
		const selection = new SelectionManager()
		expect(selection.selectInBounds([feature('inside', geometry)], bounds)).toEqual(['inside'])
		expect(selection.getSelected()).toEqual(['inside'])
	})

	test.each([
		{ type: 'Point', coordinates: [] },
		{ type: 'Point', coordinates: [0] },
		{ type: 'Point', coordinates: [Infinity, 0] },
		{ type: 'Point', coordinates: [0, NaN] },
		{ type: 'MultiPoint', coordinates: [[], [0], [9, 9]] },
		{ type: 'Polygon', coordinates: [] },
		{ type: 'Polygon', coordinates: [[]] },
		{ type: 'MultiPolygon', coordinates: [[], [[]]] },
	] satisfies Geometry[])('ignores malformed or empty $type coordinates without throwing', (geometry) => {
		const selection = new SelectionManager()
		expect(selection.selectInBounds([feature('invalid', geometry)], bounds)).toEqual([])
		expect(selection.getSelected()).toEqual([])
	})

	test('skips malformed vertices while selecting a valid coordinate in the same feature', () => {
		const selection = new SelectionManager()
		selection.select('existing')
		expect(
			selection.selectInBounds(
				[
					feature('inside', { type: 'LineString', coordinates: [[], [0], [0, 0]] }),
					feature('outside', { type: 'Point', coordinates: [2, 2] }),
				],
				bounds,
			),
		).toEqual(['inside'])
		expect(selection.getSelected()).toEqual(['existing', 'inside'])
	})
})
