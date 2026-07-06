import { describe, expect, it } from 'bun:test'
import { bboxFromFeatures, bboxTag, pointBbox } from './bbox'
import { encodeGeohash, geohashFromBbox } from './hash'

describe('encodeGeohash', () => {
	it('matches known geohash values', () => {
		// Canonical reference values (verified against geohash.org)
		expect(encodeGeohash(48.2082, 16.3738, 5)).toBe('u2edk')
		expect(encodeGeohash(48.2082, 16.3738, 6)).toBe('u2edk8')
		expect(encodeGeohash(52.52, 13.405, 5)).toBe('u33dc')
		expect(encodeGeohash(0, 0, 1)).toBe('s')
		expect(encodeGeohash(-25.382708, -49.265506, 8)).toBe('6gkzwgjz')
	})

	it('defaults to precision 5 (compat with the legacy seed copies)', () => {
		expect(encodeGeohash(48.2082, 16.3738)).toHaveLength(5)
	})
})

describe('geohashFromBbox', () => {
	it('hashes the bbox center', () => {
		expect(geohashFromBbox([16.2, 48.1, 16.5, 48.3])).toBe(encodeGeohash(48.2, 16.35, 5))
	})
})

describe('bbox helpers', () => {
	it('computes a bbox across mixed features', () => {
		const box = bboxFromFeatures([
			{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [10, 20] } },
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: [
						[-5, 0],
						[12, 30],
					],
				},
			},
		])
		expect(box).toEqual([-5, 0, 12, 30])
	})

	it('serializes bbox tags', () => {
		expect(bboxTag([1, 2, 3, 4])).toBe('1,2,3,4')
	})

	it('builds tight point bboxes', () => {
		expect(pointBbox([10, 20], 0.001)).toEqual([9.999, 19.999, 10.001, 20.001])
	})
})
