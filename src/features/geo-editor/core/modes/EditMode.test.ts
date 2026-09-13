import { describe, expect, test } from 'bun:test'
import type { Geometry, Position } from 'geojson'
import type { EditorFeature } from '../types'
import { EditMode } from './EditMode'

const square: Position[] = [
	[0, 0],
	[4, 0],
	[4, 4],
	[0, 4],
	[0, 0],
]

function feature(geometry: Geometry): EditorFeature {
	return structuredClone({ type: 'Feature', id: 'test', properties: {}, geometry })
}

describe('EditMode geometry invariants', () => {
	test.each([
		{ type: 'Polygon', coordinates: [square] },
		{ type: 'MultiPolygon', coordinates: [[square]] },
	] satisfies Geometry[])('preserves $type closure when any corner moves', (geometry) => {
		const mode = new EditMode()
		const original = feature(geometry)
		const prefix = geometry.type === 'Polygon' ? [0] : [0, 0]
		const positions = (value: EditorFeature) =>
			mode.extractVerticesWithPaths(value).map((v) => v.position)

		// Moving the last unique vertex must leave the ring's first/closing vertex alone.
		const movedLast = mode.updateVertexPosition(original, [...prefix, 3], [-1, 4])
		expect(positions(movedLast)).toEqual([
			[0, 0],
			[4, 0],
			[4, 4],
			[-1, 4],
		])
		expect(mode.extractMidpoints(movedLast).at(-1)?.position).toEqual([-0.5, 2])

		const movedFirst = mode.updateVertexPosition(original, [...prefix, 0], [-2, -2])
		expect(positions(movedFirst)).toEqual([
			[-2, -2],
			[4, 0],
			[4, 4],
			[0, 4],
		])
		expect(mode.extractMidpoints(movedFirst).at(-1)?.position).toEqual([-1, 1])
		// A direct path to the duplicate closing vertex must update both endpoints too.
		expect(mode.updateVertexPosition(original, [...prefix, 4], [-2, -2])).toEqual(movedFirst)
		expect(original).toEqual(feature(geometry))
	})

	test('edits and inserts only in the addressed multipart polygon hole', () => {
		const mode = new EditMode()
		const original = feature({ type: 'MultiPolygon', coordinates: [[square], [square, square]] })
		const edited = mode.updateVertexPosition(original, [1, 1, 2], [3, 3])
		const inserted = mode.insertVertex(edited, [1, 1, 3, 4], [0, 2])
		expect(inserted.geometry).toEqual({
			type: 'MultiPolygon',
			coordinates: [
				[square],
				[
					square,
					[
						[0, 0],
						[4, 0],
						[3, 3],
						[0, 4],
						[0, 2],
						[0, 0],
					],
				],
			],
		})
		expect(original.geometry).toEqual({
			type: 'MultiPolygon',
			coordinates: [[square], [square, square]],
		})
	})

	test('removes a first or duplicate closing vertex and closes around the next vertex', () => {
		const mode = new EditMode()
		const original = feature({ type: 'Polygon', coordinates: [square] })
		const removed = mode.removeVertex(original, [0, 0])
		expect(removed?.geometry).toEqual({
			type: 'Polygon',
			coordinates: [
				[
					[4, 0],
					[4, 4],
					[0, 4],
					[4, 0],
				],
			],
		})
		expect(mode.removeVertex(original, [0, 4])).toEqual(removed)
		if (!removed) throw new Error('Expected a triangle')
		expect(mode.removeVertex(removed, [0, 1])).toBeNull()
		expect(original.geometry).toEqual({ type: 'Polygon', coordinates: [square] })
	})

	test.each([
		{ geometry: { type: 'Point', coordinates: [0, 0] }, path: [] },
		{ geometry: { type: 'MultiPoint', coordinates: [[0, 0]] }, path: [0] },
		{
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[2, 2],
				],
			},
			path: [0],
		},
		{
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[0, 0],
						[2, 2],
					],
				],
			},
			path: [0, 0],
		},
		{
			geometry: {
				type: 'MultiPolygon',
				coordinates: [
					[
						[
							[0, 0],
							[2, 0],
							[0, 2],
							[0, 0],
						],
					],
				],
			},
			path: [0, 0, 0],
		},
	] satisfies Array<{
		geometry: Geometry
		path: number[]
	}>)('keeps the minimum vertices for $geometry.type', ({ geometry, path }) => {
		expect(new EditMode().removeVertex(feature(geometry), path)).toBeNull()
	})

	test.each([
		{ type: 'Point', coordinates: [0, 0] },
		{ type: 'MultiPoint', coordinates: square },
		{ type: 'LineString', coordinates: square },
		{ type: 'MultiLineString', coordinates: [square] },
		{ type: 'Polygon', coordinates: [square] },
		{ type: 'MultiPolygon', coordinates: [[square]] },
	] satisfies Geometry[])('rejects stale or malformed paths for $type without changing geometry', (geometry) => {
		const mode = new EditMode()
		const original = feature(geometry)
		for (const path of [[99], [0, 99], [0, 0, 99], [-1], [0.5], [0, -1], [0, 0, 0, 0]]) {
			expect(mode.updateVertexPosition(original, path, [7, 8])).toBe(original)
			expect(mode.removeVertex(original, path)).toBe(original)
		}
		expect(original).toEqual(feature(geometry))
	})

	test('rejects midpoint paths that no longer identify adjacent, existing endpoints', () => {
		const mode = new EditMode()
		const original = feature({ type: 'Polygon', coordinates: [square] })
		for (const path of [[], [0], [0, 0], [0, 0, 3], [0, 4, 5], [99, 0, 1], [0, 0, 0.5]]) {
			expect(mode.insertVertex(original, path, [2, 2])).toBe(original)
		}
	})

	test('skips malformed handles and segments without bridging across missing coordinates', () => {
		const mode = new EditMode()
		const original = feature({
			type: 'LineString',
			coordinates: [[], [8], [0, 0], [2, 4], [Infinity, 3], [6, 8]],
		})
		expect(mode.extractVerticesWithPaths(original)).toEqual([
			{ position: [0, 0], path: [2] },
			{ position: [2, 4], path: [3] },
			{ position: [6, 8], path: [5] },
		])
		expect(mode.extractMidpoints(original)).toEqual([{ position: [1, 2], path: [2, 3] }])
		expect(mode.updateVertexPosition(original, [0], [1, 1])).toBe(original)
		expect(mode.insertVertex(original, [1, 2], [1, 1])).toBe(original)
		expect(mode.removeVertex(original, [2])).toBe(original)
		expect(mode.translateFeature(original, [0, 0], [2, 2])).toBe(original)
	})

	test.each([
		{ type: 'Point', coordinates: [] },
		{ type: 'LineString', coordinates: [] },
		{ type: 'Polygon', coordinates: [] },
		{ type: 'Polygon', coordinates: [[]] },
		{ type: 'MultiPolygon', coordinates: [[], [[]]] },
	] satisfies Geometry[])('handles empty $type coordinates without inventing vertices', (geometry) => {
		const mode = new EditMode()
		const original = feature(geometry)
		expect(mode.extractVerticesWithPaths(original)).toEqual([])
		expect(mode.extractMidpoints(original)).toEqual([])
		expect(mode.updateVertexPosition(original, [], [1, 1])).toBe(original)
		expect(mode.removeVertex(original, [])).toBe(original)
		expect(mode.translateFeature(original, [0, 0], [1, 1])).toBe(original)
	})

	test('keeps the last vertex visible for an unclosed ring and avoids overwriting it', () => {
		const mode = new EditMode()
		const original = feature({ type: 'Polygon', coordinates: [square.slice(0, -1)] })
		expect(mode.extractVerticesWithPaths(original)).toHaveLength(4)
		expect(mode.updateVertexPosition(original, [0, 0], [1, 1]).geometry).toEqual({
			type: 'Polygon',
			coordinates: [
				[
					[1, 1],
					[4, 0],
					[4, 4],
					[0, 4],
				],
			],
		})
		expect(mode.removeVertex(original, [0, 1])).toBe(original)
	})

	test.each([
		{ type: 'Point', coordinates: [0, 0, 8] },
		{
			type: 'MultiPoint',
			coordinates: [
				[0, 0, 8],
				[2, 4, 12],
			],
		},
		{
			type: 'LineString',
			coordinates: [
				[0, 0, 8],
				[2, 4, 12],
			],
		},
		{
			type: 'MultiLineString',
			coordinates: [
				[
					[0, 0, 8],
					[2, 4, 12],
				],
			],
		},
		{ type: 'Polygon', coordinates: [square.map((position) => [...position, 8])] },
		{ type: 'MultiPolygon', coordinates: [[square.map((position) => [...position, 8])]] },
	] satisfies Geometry[])('translates every $type coordinate and preserves altitude', (geometry) => {
		const mode = new EditMode()
		const original = feature(geometry)
		const translated = mode.translateFeature(original, [1, 2], [3, 5])
		expect(mode.extractVerticesWithPaths(translated)).toEqual(
			mode.extractVerticesWithPaths(original).map(({ position: [lng, lat, altitude], path }) => {
				if (lng === undefined || lat === undefined || altitude === undefined) {
					throw new Error('Expected a three-dimensional fixture coordinate')
				}
				return { position: [lng + 2, lat + 3, altitude], path }
			}),
		)
		expect(original).toEqual(feature(geometry))
	})

	test('translates a shared first and closing coordinate only once', () => {
		const first = [0, 0, 8]
		const original = feature({
			type: 'Polygon',
			coordinates: [[first, [4, 0, 8], [4, 4, 8], first]],
		})
		expect(new EditMode().translateFeature(original, [0, 0], [2, 3]).geometry).toEqual({
			type: 'Polygon',
			coordinates: [
				[
					[2, 3, 8],
					[6, 3, 8],
					[6, 7, 8],
					[2, 3, 8],
				],
			],
		})
	})

	test('rejects invalid new positions or translation anchors and avoids coordinate overflow', () => {
		const mode = new EditMode()
		const original = feature({
			type: 'LineString',
			coordinates: [
				[0, 0],
				[2, 2],
			],
		})
		for (const position of [[], [1], [NaN, 0], [Infinity, 0], [0, 0, NaN]]) {
			expect(mode.updateVertexPosition(original, [0], position)).toBe(original)
			expect(mode.insertVertex(original, [0, 1], position)).toBe(original)
			expect(mode.translateFeature(original, [0, 0], position)).toBe(original)
			expect(mode.translateFeature(original, position, [0, 0])).toBe(original)
		}
		const enormous = feature({ type: 'Point', coordinates: [Number.MAX_VALUE, 0] })
		expect(mode.translateFeature(enormous, [0, 0], [Number.MAX_VALUE, 0])).toBe(enormous)
	})
})
