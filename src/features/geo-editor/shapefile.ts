import type { FeatureCollection, Geometry } from 'geojson'

type ShpJsCollection = FeatureCollection & { fileName?: unknown }
type ShpJsResult = ShpJsCollection | ShpJsCollection[]

type ShpJsModule = {
	default: (input: unknown) => Promise<ShpJsResult>
}

type ShpWriteModule = typeof import('@mapbox/shp-write')

const SHAPEFILE_PRJ_WGS84 =
	'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'

const INTERNAL_SHAPEFILE_PROPERTY_KEYS = new Set([
	'meta',
	'customProperties',
	'featureId',
	'datasetId',
	'sourceEventId',
	'hashtags',
	'importSource',
	'externalPlaceholder',
	'collapseToPointProxy',
	'proxyFeature',
	'sourceGeometryType',
	'proxySourceBbox',
])

function sanitizeFileName(value: string): string {
	const sanitized = value
		.trim()
		.replace(/\.[^.]+$/, '')
		.replace(/[^a-z0-9-_]+/gi, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
	return sanitized || 'features'
}

function toDbfSafeValue(value: unknown): string | number | boolean | Date | null {
	if (value == null) return null
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value instanceof Date
	) {
		return value
	}
	return JSON.stringify(value)
}

function sanitizeShapefileProperties(
	properties: unknown,
): Record<string, string | number | boolean | Date | null> {
	if (!properties || typeof properties !== 'object') return {}

	const sourceProperties = properties as Record<string, unknown>
	const result: Record<string, string | number | boolean | Date | null> = {}

	for (const [key, value] of Object.entries(sourceProperties)) {
		if (INTERNAL_SHAPEFILE_PROPERTY_KEYS.has(key)) continue
		result[key] = toDbfSafeValue(value)
	}

	const customProperties = sourceProperties.customProperties
	if (
		customProperties &&
		typeof customProperties === 'object' &&
		!Array.isArray(customProperties)
	) {
		for (const [key, value] of Object.entries(customProperties as Record<string, unknown>)) {
			if (key in result) continue
			result[key] = toDbfSafeValue(value)
		}
	}

	return result
}

function explodeUnsupportedGeometry(feature: GeoJSON.Feature): GeoJSON.Feature[] {
	if (!feature.geometry) return []

	if (feature.geometry.type === 'MultiPoint') {
		return feature.geometry.coordinates.map((coordinates, index) => ({
			type: 'Feature',
			id: `${feature.id ?? 'feature'}:${index}`,
			geometry: {
				type: 'Point',
				coordinates,
			},
			properties: feature.properties ?? {},
		}))
	}

	if (feature.geometry.type === 'GeometryCollection') {
		return feature.geometry.geometries
			.filter(
				(geometry): geometry is Exclude<Geometry, GeoJSON.GeometryCollection> =>
					geometry.type !== 'GeometryCollection',
			)
			.flatMap((geometry, index) =>
				explodeUnsupportedGeometry({
					type: 'Feature',
					id: `${feature.id ?? 'feature'}:${index}`,
					geometry,
					properties: feature.properties ?? {},
				}),
			)
	}

	return [feature]
}

function normalizeCollectionForShapefile(collection: FeatureCollection): {
	collection: FeatureCollection
	skippedCount: number
} {
	const normalizedFeatures: GeoJSON.Feature[] = []
	let skippedCount = 0

	for (const feature of collection.features) {
		if (!feature.geometry) {
			skippedCount += 1
			continue
		}

		const candidates = explodeUnsupportedGeometry(feature)
		for (const candidate of candidates) {
			const geometryType = candidate.geometry?.type
			if (
				geometryType !== 'Point' &&
				geometryType !== 'LineString' &&
				geometryType !== 'Polygon' &&
				geometryType !== 'MultiLineString' &&
				geometryType !== 'MultiPolygon'
			) {
				skippedCount += 1
				continue
			}

			normalizedFeatures.push({
				type: 'Feature',
				id: candidate.id,
				geometry: candidate.geometry,
				properties: sanitizeShapefileProperties(candidate.properties),
			})
		}
	}

	return {
		collection: {
			type: 'FeatureCollection',
			features: normalizedFeatures,
		},
		skippedCount,
	}
}

function mergeImportedCollections(parsed: ShpJsResult): FeatureCollection {
	const collections = Array.isArray(parsed) ? parsed : [parsed]

	return {
		type: 'FeatureCollection',
		features: collections.flatMap((collection) => {
			const sourceLayer =
				typeof collection.fileName === 'string' && collection.fileName.trim()
					? collection.fileName.trim()
					: undefined

			return collection.features.map((feature) => ({
				...feature,
				properties: {
					...(feature.properties ?? {}),
					...(sourceLayer ? { sourceLayer } : {}),
				},
			}))
		}),
	}
}

async function loadShpJs() {
	return (await import('shpjs')) as ShpJsModule
}

async function loadShpWrite() {
	return (await import('@mapbox/shp-write')) as ShpWriteModule
}

export async function importShapefile(file: File): Promise<FeatureCollection> {
	const extension = file.name.split('.').pop()?.toLowerCase()
	const shp = (await loadShpJs()).default

	if (extension === 'zip') {
		const parsed = await shp(await file.arrayBuffer())
		return mergeImportedCollections(parsed)
	}

	if (extension === 'shp') {
		const parsed = await shp({ shp: await file.arrayBuffer() })
		return mergeImportedCollections(parsed)
	}

	throw new Error('Unsupported shapefile import. Use a .zip or .shp file.')
}

export async function exportShapefile(
	collection: FeatureCollection,
	filename: string,
): Promise<{ blob: Blob; skippedCount: number; downloadName: string }> {
	const { zip } = await loadShpWrite()
	const { collection: normalizedCollection, skippedCount } =
		normalizeCollectionForShapefile(collection)

	if (normalizedCollection.features.length === 0) {
		throw new Error('No supported features available for SHP export.')
	}

	const safeFileName = sanitizeFileName(filename)
	const blob = await zip(normalizedCollection, {
		filename: safeFileName,
		folder: safeFileName,
		outputType: 'blob',
		compression: 'STORE',
		prj: SHAPEFILE_PRJ_WGS84,
	})

	return {
		blob,
		skippedCount,
		downloadName: `${safeFileName}.zip`,
	}
}
