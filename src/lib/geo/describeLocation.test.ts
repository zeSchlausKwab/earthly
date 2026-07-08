import { describe, expect, it } from 'bun:test'
import { bearingToCompass, describeLocation, describeViewport } from './describeLocation'

const land: GeoJSON.FeatureCollection = {
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

const countries: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { name: 'Testland' },
			geometry: (land.features[0] as GeoJSON.Feature).geometry,
		},
	],
}

const cities: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { name: 'Testville', country: 'Testland' },
			geometry: { type: 'Point', coordinates: [5, 5] },
		},
	],
}

const coastline: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0, 10],
				],
			},
		},
	],
}

describe('bearingToCompass', () => {
	it('maps bearings to the 8-point compass', () => {
		expect(bearingToCompass(0)).toBe('N')
		expect(bearingToCompass(90)).toBe('E')
		expect(bearingToCompass(-90)).toBe('W')
		expect(bearingToCompass(135)).toBe('SE')
	})
})

describe('describeLocation', () => {
	it('grounds an on-land point with country and nearest city', () => {
		const description = describeLocation({ land, countries, cities, coastline }, [2, 5])
		expect(description.onLand).toBe(true)
		expect(description.country).toBe('Testland')
		expect(description.nearestCity?.name).toBe('Testville')
		expect(description.text).toContain('on land')
		expect(description.text).toContain('in Testland')
	})

	it('reports an on-water point with distance off the coast', () => {
		const description = describeLocation({ land, countries, cities, coastline }, [-1, 5])
		expect(description.onLand).toBe(false)
		expect(description.country).toBeUndefined()
		expect(description.coastDistanceKm).toBeGreaterThan(50)
		expect(description.coastDistanceKm).toBeLessThan(200)
		expect(description.text).toContain('on water')
	})

	it('degrades to a note when no layers are available', () => {
		const description = describeLocation({}, [2, 5])
		expect(description.text).toBe('no reference data available')
	})
})

describe('describeViewport', () => {
	it('names countries intersecting the bbox and describes the center', () => {
		const anchors = describeViewport({ land, countries, cities, coastline }, [1, 1, 9, 9])
		expect(anchors.countriesInView).toEqual(['Testland'])
		expect(anchors.center.onLand).toBe(true)
	})

	it('an all-water viewport names no countries', () => {
		const anchors = describeViewport({ land, countries, cities, coastline }, [-30, -30, -20, -20])
		expect(anchors.countriesInView).toEqual([])
		expect(anchors.center.onLand).toBe(false)
	})
})
