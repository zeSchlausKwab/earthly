import { afterEach, describe, expect, test } from 'bun:test'
import { primeWorldLayerForTest, resetWorldDataForTest } from '@/lib/geo/worldData'
import { normalizeReferenceBoundaryNames } from './reference-boundary-tools'
import { dispatch, registry } from './registry'

describe('source-selecting reference boundaries', () => {
	afterEach(() => resetWorldDataForTest())

	test('serves nation-state boundaries from bundled Natural Earth in one batch', async () => {
		primeWorldLayerForTest('countries_110m', {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { name: 'Germany', iso_a2: 'DE' },
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[5, 47],
								[15, 47],
								[15, 55],
								[5, 47],
							],
						],
					},
				},
			],
		})

		const result = (await dispatch('get_reference_boundaries', {
			level: 'country',
			names: ['Germany'],
		})) as Record<string, unknown>

		expect(result.source).toBe('natural_earth_countries_110m')
		expect(result.count).toBe(1)
		expect((result.features as GeoJSON.Feature[])[0]?.properties?.sourceDataset).toContain(
			'Natural Earth',
		)
	})

	test('keeps the legacy country-boundary tool on Natural Earth too', async () => {
		primeWorldLayerForTest('countries_110m', {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { name: 'Poland', iso_a2: 'PL' },
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[14, 49],
								[24, 49],
								[24, 55],
								[14, 49],
							],
						],
					},
				},
			],
		})

		const result = (await dispatch('get_country_boundary', { countryCode: 'PL' })) as Record<
			string,
			unknown
		>

		expect(result.source).toBe('natural_earth_countries_110m')
		expect((result.feature as GeoJSON.Feature).properties?.geometryPrecision).toBe('generalized')
	})

	test('does not cap admin1 boundary batches', () => {
		const names = Array.from({ length: 25 }, (_, index) => `Region ${index + 1}`)

		expect(normalizeReferenceBoundaryNames(names, 'admin1')).toEqual(names)
	})
})

describe('GeoJSON network routing', () => {
	test('returns a multi-vertex path that follows the supplied line network', async () => {
		const result = (await dispatch('route_over_network', {
			network: 'provided_geojson',
			from: [0, 0],
			to: [2, 1],
			networkGeojson: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 0],
								[1, 1],
								[2, 1],
							],
						},
					},
				],
			},
		})) as { feature: GeoJSON.Feature<GeoJSON.LineString>; summary: { vertexCount: number } }

		expect(result.feature.geometry.coordinates).toEqual([
			[0, 0],
			[1, 1],
			[2, 1],
		])
		expect(result.summary.vertexCount).toBe(3)
		expect(result.feature.properties?.geometryPrecision).toBe('network-derived')
	})

	test('advertises Valhalla as network-following rather than schematic drawing', () => {
		const production = registry.get('valhalla_route')
		expect(production).toBeDefined()
		expect(production?.schema.function.description).toMatch(/network-following/i)
		expect(production?.schema.function.description).toMatch(/2 to 25 coordinate waypoints/i)
		expect(production?.schema.function.description).toMatch(/not a road-name search/i)
		expect(production?.schema.function.description).toMatch(/does not route rail/i)
		expect(production?.schema.function.description).toMatch(/route_over_network/i)
	})
})
