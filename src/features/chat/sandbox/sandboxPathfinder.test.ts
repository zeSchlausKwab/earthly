import { describe, expect, it } from 'bun:test'
import { runPathfinder } from './sandboxPathfinder'

// A tiny Y-shaped network: A—B—C plus a spur B—D.
const network: GeoJSON.FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0], // A
					[1, 0], // B
					[2, 0], // C
				],
			},
		},
		{
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[1, 0], // B
					[1, 1], // D
				],
			},
		},
	],
}

describe('runPathfinder', () => {
	it('routes along the network between snapped endpoints', () => {
		// Endpoints deliberately OFF the network — they must snap to A and D.
		const result = runPathfinder(network, [0.01, -0.02], [1.02, 0.98])
		expect(result.path.geometry.type).toBe('LineString')
		expect(result.path.geometry.coordinates[0]).toEqual([0, 0])
		expect(result.path.geometry.coordinates.at(-1)).toEqual([1, 1])
		// A→B→D is ~111 + ~111 km.
		expect(result.lengthKm).toBeGreaterThan(215)
		expect(result.lengthKm).toBeLessThan(230)
		expect(result.from.offsetKm).toBeGreaterThan(0)
	})

	it('routes across shared vertices (through B)', () => {
		const result = runPathfinder(network, [2, 0], [1, 1])
		expect(result.path.geometry.coordinates).toContainEqual([1, 0])
	})

	it('throws a descriptive error when the network has no lines', () => {
		expect(() =>
			runPathfinder({ type: 'FeatureCollection', features: [] }, [0, 0], [1, 1]),
		).toThrow(/no LineString/)
	})

	it('rejects malformed endpoints', () => {
		expect(() => runPathfinder(network, [0], [1, 1])).toThrow(/\[lon, lat\]/)
	})
})

describe('runPathfinder against the bundled maritime network', () => {
	it('routes Rotterdam → Ras Laffan through the Suez corridor, not overland', async () => {
		const file = Bun.file(
			new URL('../../../../public/static/world/maritime_network.json', import.meta.url),
		)
		if (!(await file.exists())) return // asset not present in this checkout
		const marnet = (await file.json()) as GeoJSON.FeatureCollection
		const result = runPathfinder(marnet, [4.5, 51.9], [51.53, 25.9])
		// Sanity: length within a plausible band for the Suez route (~11–13k km),
		// far below any Cape-of-Good-Hope detour (>20k km).
		expect(result.lengthKm).toBeGreaterThan(9000)
		expect(result.lengthKm).toBeLessThan(15000)
		// The route passes through the Suez region (bbox around the canal).
		const throughSuez = result.path.geometry.coordinates.some(
			([lon, lat]) => lon > 31 && lon < 34.5 && lat > 27 && lat < 32,
		)
		expect(throughSuez).toBe(true)
	})
})
