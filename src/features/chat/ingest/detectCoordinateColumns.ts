/**
 * Name-heuristic coordinate/geometry column detector (D-04).
 *
 * Pure function, no side effects. Given the schema field names, return the
 * best-guess coordinate columns. The AI confirms or overrides these at
 * placement time (D-04), so an ambiguous input correctly yields an empty object
 * rather than a wrong guess.
 *
 * Matching is case-insensitive and exact-on-normalized-name (not substring), so
 * a column like `relation_id` does not falsely match `lon`/`id`.
 */

import type { CoordinateColumns } from './datasetTypes'

const LAT_NAMES = new Set(['lat', 'latitude', 'y'])
const LON_NAMES = new Set(['lon', 'lng', 'long', 'longitude', 'x'])
const WKT_NAMES = new Set(['wkt'])
const GEOMETRY_NAMES = new Set(['geometry', 'geom', 'the_geom'])

function normalize(name: string): string {
	return name.trim().toLowerCase()
}

export function detectCoordinateColumns(schemaFields: string[]): CoordinateColumns {
	const result: CoordinateColumns = {}

	for (const field of schemaFields) {
		const key = normalize(field)
		if (result.lat === undefined && LAT_NAMES.has(key)) {
			result.lat = field
			continue
		}
		if (result.lon === undefined && LON_NAMES.has(key)) {
			result.lon = field
			continue
		}
		if (result.wkt === undefined && WKT_NAMES.has(key)) {
			result.wkt = field
			continue
		}
		if (result.geometry === undefined && GEOMETRY_NAMES.has(key)) {
			result.geometry = field
		}
	}

	return result
}
