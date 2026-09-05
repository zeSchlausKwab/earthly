import { describe, expect, test } from 'bun:test'
import type { FeatureCollection, Geometry } from 'geojson'
import { geometryThumbnail } from './geometryThumbnail'

function collection(geometry: Geometry): FeatureCollection {
	return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] }
}

describe('geometry thumbnails', () => {
	test('centres a point and inverts latitude for north-up previews', () => {
		expect(geometryThumbnail(collection({ type: 'Point', coordinates: [16, 48] }))).toEqual([
			{ closed: false, points: [[20, 14]] },
		])
		const [line] = geometryThumbnail(
			collection({
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0, 10],
				],
			}),
		)
		expect(line?.points).toEqual([
			[20, 24],
			[20, 4],
		])
	})

	test('preserves line endpoints while bounding thumbnail work', () => {
		const [line] = geometryThumbnail(
			collection({
				type: 'LineString',
				coordinates: Array.from({ length: 100_000 }, (_, index) => [index, 0]),
			}),
		)
		expect(line?.points.length).toBe(48)
		expect(line?.points[0]).toEqual([4, 14])
		expect(line?.points.at(-1)).toEqual([36, 14])
	})

	test('supports collections and closed polygons without invalid SVG coordinates', () => {
		const shapes = geometryThumbnail(
			collection({
				type: 'GeometryCollection',
				geometries: [
					{
						type: 'Polygon',
						coordinates: [
							[
								[0, 0],
								[1, 0],
								[1, 1],
								[0, 0],
							],
						],
					},
					{ type: 'Point', coordinates: [Number.NaN, 12] },
				],
			}),
		)
		expect(shapes).toHaveLength(1)
		expect(shapes[0]?.closed).toBe(true)
		expect(geometryThumbnail({ type: 'FeatureCollection', features: [] })).toEqual([])
		expect(geometryThumbnail(undefined)).toEqual([])
	})
})
