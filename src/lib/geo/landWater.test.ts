import { describe, expect, it } from 'bun:test'
import { checkFeaturesAgainstLandMask, isOnLand } from './landWater'

// A toy land mask: one 10°×10° "island" from [0,0] to [10,10].
const mask: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[10, 0],
						[10, 10],
						[0, 10],
						[0, 0],
					],
				],
			},
		},
	],
}

const line = (id: string, coordinates: number[][]): GeoJSON.Feature => ({
	type: 'Feature',
	id,
	properties: {},
	geometry: { type: 'LineString', coordinates },
})

describe('isOnLand', () => {
	it('classifies inside/outside the mask', () => {
		expect(isOnLand(mask, [5, 5])).toBe(true)
		expect(isOnLand(mask, [-5, 5])).toBe(false)
	})
})

describe('checkFeaturesAgainstLandMask', () => {
	it('uniform lines are counted but get no detail (noise filter)', () => {
		const report = checkFeaturesAgainstLandMask(mask, [
			line('on-land', [
				[1, 1],
				[2, 2],
			]),
			line('on-water', [
				[-1, -1],
				[-2, -2],
			]),
		])
		expect(report.lines.checked).toBe(2)
		expect(report.lines.fullyOnLand).toBe(1)
		expect(report.lines.fullyOnWater).toBe(1)
		expect(report.lines.mixed).toHaveLength(0)
	})

	it('mixed lines report land runs with a representative coordinate', () => {
		const report = checkFeaturesAgainstLandMask(mask, [
			line('crossing', [
				[-2, 5], // water
				[2, 5], // land (run 1..2)
				[4, 5], // land
				[-3, 8], // water
			]),
		])
		expect(report.lines.mixed).toHaveLength(1)
		const finding = report.lines.mixed[0]
		expect(finding?.featureId).toBe('crossing')
		expect(finding?.landVertexCount).toBe(2)
		expect(finding?.landRuns[0]).toMatchObject({ from: 1, to: 2 })
		expect(finding?.summary).toContain('2/4 vertices on land')
	})

	it('points are tallied land vs water', () => {
		const report = checkFeaturesAgainstLandMask(mask, [
			{
				type: 'Feature',
				id: 'p1',
				properties: {},
				geometry: { type: 'Point', coordinates: [5, 5] },
			},
			{
				type: 'Feature',
				id: 'p2',
				properties: {},
				geometry: { type: 'Point', coordinates: [-5, -5] },
			},
		])
		expect(report.points).toEqual({ checked: 2, onLand: 1, onWater: 1 })
	})

	it('polygons are skipped entirely', () => {
		const report = checkFeaturesAgainstLandMask(mask, [
			{
				type: 'Feature',
				id: 'poly',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[1, 1],
							[2, 1],
							[2, 2],
							[1, 1],
						],
					],
				},
			},
		])
		expect(report.lines.checked).toBe(0)
		expect(report.points.checked).toBe(0)
	})
})
