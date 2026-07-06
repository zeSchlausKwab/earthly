import type { FeatureCollection } from 'geojson'

/**
 * Shared GeoJSON fixtures for the Phase 02 test suite.
 *
 * These are pure data with zero imports from `@/features` so any test
 * (golden/characterization, read-mirror integrity, boundary, primitive)
 * can reuse them. Keep them small and stable — golden tests assert against
 * their exact shape.
 */

/** An empty FeatureCollection — the baseline/no-op input. */
export const emptyFeatureCollection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

/** A single Point Feature with a stable `id` and a `name` property. */
export const singlePointCollection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'test-point-1',
			geometry: { type: 'Point', coordinates: [13.4, 52.5] },
			properties: { name: 'Test Point' },
		},
	],
}

/**
 * Two Features that share the same `id`. Used to exercise dedup-by-id
 * behaviour (Plan 03's golden test): both entries below carry `id: 'dup-id'`.
 */
export const dupIdCollection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'dup-id',
			geometry: { type: 'Point', coordinates: [0, 0] },
			properties: { name: 'First' },
		},
		{
			type: 'Feature',
			id: 'dup-id',
			geometry: { type: 'Point', coordinates: [1, 1] },
			properties: { name: 'Second' },
		},
	],
}
