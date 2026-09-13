import type { FeatureCollection, Geometry, Position } from 'geojson'
import { boundedJson, isRecord } from './config'

export const MAPLET_LIMITS = {
	features: 5000,
	positions: 50_000,
	bytes: 5 * 1024 * 1024,
	propertyChars: 16_384,
} as const

/** Only declarative GeoJSON crosses this seam. Foreign data never reaches MapLibre unchecked. */
export function validateMapletCollection(input: unknown): FeatureCollection {
	if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features))
		throw new Error('Expected a GeoJSON FeatureCollection')
	if (input.features.length > MAPLET_LIMITS.features)
		throw new Error('Maplet feature limit exceeded')
	let positions = 0
	const ids = new Set<string>()
	function position(value: unknown): Position {
		if (++positions > MAPLET_LIMITS.positions) throw new Error('Maplet coordinate limit exceeded')
		if (
			!Array.isArray(value) ||
			value.length < 2 ||
			value.length > 3 ||
			value.some((n) => typeof n !== 'number' || !Number.isFinite(n)) ||
			Math.abs(value[0]) > 180 ||
			Math.abs(value[1]) > 90
		)
			throw new Error('Invalid geographic coordinate')
		return [...value]
	}
	function list(value: unknown): unknown[] {
		if (!Array.isArray(value) || value.length > MAPLET_LIMITS.positions)
			throw new Error('Invalid geometry coordinates')
		return value
	}
	function line(value: unknown, ring = false): Position[] {
		const result = list(value).map(position)
		if (result.length < (ring ? 4 : 2)) throw new Error('Geometry has too few coordinates')
		if (ring && JSON.stringify(result[0]) !== JSON.stringify(result[result.length - 1]))
			throw new Error('Polygon ring must be closed')
		return result
	}
	function polygon(value: unknown): Position[][] {
		const rings = list(value)
		if (!rings.length) throw new Error('Polygon needs an exterior ring')
		return rings.map((ring) => line(ring, true))
	}
	function geometry(value: unknown, depth = 0): Geometry {
		if (!isRecord(value) || depth > 3) throw new Error('Invalid geometry')
		switch (value.type) {
			case 'Point':
				return { type: 'Point', coordinates: position(value.coordinates) }
			case 'MultiPoint':
				return { type: 'MultiPoint', coordinates: list(value.coordinates).map(position) }
			case 'LineString':
				return { type: 'LineString', coordinates: line(value.coordinates) }
			case 'MultiLineString':
				return {
					type: 'MultiLineString',
					coordinates: list(value.coordinates).map((item) => line(item)),
				}
			case 'Polygon':
				return { type: 'Polygon', coordinates: polygon(value.coordinates) }
			case 'MultiPolygon':
				return { type: 'MultiPolygon', coordinates: list(value.coordinates).map(polygon) }
			case 'GeometryCollection':
				return {
					type: 'GeometryCollection',
					geometries: list(value.geometries).map((item) => {
						const child = geometry(item, depth + 1)
						if (!child) throw new Error('Nested geometry must not be null')
						return child
					}),
				}
			default:
				throw new Error('Unsupported GeoJSON geometry')
		}
	}
	const collection: FeatureCollection = {
		type: 'FeatureCollection',
		features: input.features.map((feature, index) => {
			if (!isRecord(feature) || feature.type !== 'Feature')
				throw new Error('Invalid GeoJSON feature')
			if (feature.properties !== null && !isRecord(feature.properties))
				throw new Error('Feature properties must be an object')
			const properties = boundedJson(feature.properties, MAPLET_LIMITS.propertyChars)
			const id = feature.id ?? index
			if (typeof id !== 'string' && typeof id !== 'number') throw new Error('Invalid feature id')
			if ((typeof id === 'number' && !Number.isFinite(id)) || String(id).length > 256)
				throw new Error('Invalid feature id')
			if (ids.has(String(id))) throw new Error('Duplicate feature id')
			ids.add(String(id))
			return {
				type: 'Feature',
				id,
				geometry: geometry(feature.geometry),
				properties: properties as Record<string, unknown> | null,
			}
		}),
	}
	if (JSON.stringify(collection).length > MAPLET_LIMITS.bytes)
		throw new Error('Maplet collection exceeds size limit')
	return collection
}
