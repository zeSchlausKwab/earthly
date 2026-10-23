import type {
	Feature as GeoJsonFeature,
	FeatureCollection as GeoJsonFeatureCollection,
	Geometry,
	Position,
} from 'geojson'

type Feature = GeoJsonFeature<Geometry | null>
type FeatureCollection = GeoJsonFeatureCollection<Geometry | null>

const GEOMETRY_TYPES = new Set([
	'Point',
	'MultiPoint',
	'LineString',
	'MultiLineString',
	'Polygon',
	'MultiPolygon',
	'GeometryCollection',
])

type FeatureWithUnknownGeometry = Omit<Feature, 'geometry'> & { geometry: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isPosition(value: unknown): value is Position {
	return Array.isArray(value) && value.length >= 2 && value.every((item) => isFiniteNumber(item))
}

function isPositions(value: unknown): value is Position[] {
	return Array.isArray(value) && value.every((item) => isPosition(item))
}

function isArrayOfPositions(value: unknown): value is Position[][] {
	return Array.isArray(value) && value.every((item) => isPositions(item))
}

function isArrayOfArrayOfPositions(value: unknown): value is Position[][][] {
	return Array.isArray(value) && value.every((item) => isArrayOfPositions(item))
}

function isGeoJsonGeometryWithValidCoordinates(payload: unknown): payload is Geometry {
	if (!isRecord(payload)) return false
	const type = payload.type
	if (typeof type !== 'string' || !GEOMETRY_TYPES.has(type)) return false

	if (type === 'GeometryCollection') {
		const geometries = payload.geometries
		return (
			Array.isArray(geometries) &&
			geometries.every((geometry) => isGeoJsonGeometryWithValidCoordinates(geometry))
		)
	}

	const coordinates = payload.coordinates
	switch (type) {
		case 'Point':
			return isPosition(coordinates)
		case 'MultiPoint':
		case 'LineString':
			return isPositions(coordinates)
		case 'MultiLineString':
		case 'Polygon':
			return isArrayOfPositions(coordinates)
		case 'MultiPolygon':
			return isArrayOfArrayOfPositions(coordinates)
		default:
			return false
	}
}

export function isGeoJsonGeometry(payload: unknown): payload is Geometry {
	return isGeoJsonGeometryWithValidCoordinates(payload)
}

export function isGeoJsonFeature(payload: unknown): payload is Feature {
	return isRecord(payload) && payload.type === 'Feature' && 'geometry' in payload
}

export function isGeoJsonFeatureCollection(payload: unknown): payload is FeatureCollection {
	return (
		isRecord(payload) && payload.type === 'FeatureCollection' && Array.isArray(payload.features)
	)
}

function normalizeGeometry(value: unknown): Geometry | null {
	if (value === null) return null
	return isGeoJsonGeometry(value) ? value : null
}

function normalizeProperties(value: unknown): Feature['properties'] {
	if (value === null) return null
	return isRecord(value) ? (value as Feature['properties']) : {}
}

function normalizeFeatureId(value: unknown): string | number | undefined {
	if (typeof value === 'string' || typeof value === 'number') return value
	return undefined
}

function unwrapNestedFeatureGeometry(feature: FeatureWithUnknownGeometry): Feature {
	let current: FeatureWithUnknownGeometry = feature

	while (current.geometry && isGeoJsonFeature(current.geometry)) {
		const nested = current.geometry as unknown as Feature
		const inheritedId = current.id !== undefined ? current.id : nested.id
		current = {
			type: 'Feature',
			geometry: (nested.geometry as unknown) ?? null,
			properties: {
				...(normalizeProperties(nested.properties) ?? {}),
				...(normalizeProperties(current.properties) ?? {}),
			},
			...(inheritedId !== undefined ? { id: inheritedId } : {}),
			...(nested.bbox ? { bbox: nested.bbox } : {}),
			...(current.bbox ? { bbox: current.bbox } : {}),
		}
	}

	return {
		...(current as Omit<Feature, 'geometry'>),
		geometry: normalizeGeometry(current.geometry),
	}
}

function normalizeFeatureLike(value: unknown): Feature | null {
	// Raw geometry → wrap into Feature
	if (isGeoJsonGeometry(value)) {
		return {
			type: 'Feature',
			geometry: value,
			properties: {},
		}
	}

	if (!isRecord(value)) return null

	// Proper Feature
	if (isGeoJsonFeature(value)) {
		const normalized: FeatureWithUnknownGeometry = {
			type: 'Feature',
			geometry: value.geometry as unknown,
			properties: normalizeProperties(value.properties),
			...(value.id !== undefined ? { id: value.id } : {}),
			...(value.bbox ? { bbox: value.bbox } : {}),
		}
		return unwrapNestedFeatureGeometry(normalized)
	}

	// Feature-ish object (missing type) but has geometry
	if ('geometry' in value) {
		const geometry = value.geometry
		const id = normalizeFeatureId(value.id)
		const properties = normalizeProperties(value.properties)
		const candidate: FeatureWithUnknownGeometry = {
			type: 'Feature',
			geometry,
			properties,
			...(id !== undefined ? { id } : {}),
		}
		return unwrapNestedFeatureGeometry(candidate)
	}

	return null
}

function normalizeToFeatures(payload: unknown): Feature[] {
	if (isGeoJsonFeatureCollection(payload)) {
		const rawFeatures = (payload.features ?? []) as unknown[]
		return rawFeatures
			.map(normalizeFeatureLike)
			.filter((feature): feature is Feature => feature !== null)
	}

	if (isGeoJsonFeature(payload) || isGeoJsonGeometry(payload)) {
		const feature = normalizeFeatureLike(payload)
		return feature ? [feature] : []
	}

	// Single Feature-ish object (missing type) but has geometry
	if (isRecord(payload) && 'geometry' in payload) {
		const feature = normalizeFeatureLike(payload)
		return feature ? [feature] : []
	}

	return []
}

/**
 * Normalizes arbitrary GeoJSON-ish inputs into a GeoJSON FeatureCollection:
 * - FeatureCollection → normalizes features
 * - Feature → wraps into FeatureCollection
 * - Geometry → wraps into Feature then FeatureCollection
 * - Feature-ish objects missing type → coerces into a Feature
 *
 * Invalid geometries are converted to null geometry (safe for downstream filtering/rendering).
 * Collection-level metadata is preserved when the input is a FeatureCollection.
 */
export function normalizeGeoJsonToFeatureCollection(payload: unknown): FeatureCollection {
	const features = normalizeToFeatures(payload)

	const base =
		isGeoJsonFeatureCollection(payload) && isRecord(payload)
			? (payload as Record<string, unknown>)
			: {}

	return {
		...base,
		type: 'FeatureCollection',
		features,
	}
}

/** Rendering/editor boundaries require actual geometries. Keep normalization's
 * nullable records available to callers that need their IDs or properties. */
export function normalizeRenderableFeatureCollection(payload: unknown): GeoJsonFeatureCollection {
	const collection = normalizeGeoJsonToFeatureCollection(payload)
	return {
		...collection,
		features: collection.features.filter(
			(feature): feature is GeoJsonFeature => feature.geometry !== null,
		),
	}
}
