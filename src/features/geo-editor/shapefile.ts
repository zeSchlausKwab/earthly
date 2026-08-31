import type { FeatureCollection, Geometry } from 'geojson'

type ShpJsCollection = FeatureCollection & { fileName?: unknown }

type ShpJsModule = {
	default: (input: unknown) => Promise<unknown>
}

type ShpWriteModule = typeof import('@mapbox/shp-write')

export const EARTHLY_SHAPEFILE_METADATA_FILE = 'earthly-metadata.json'
export const EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY = 'EARTHLYID'

const EARTHLY_SHAPEFILE_METADATA_ERROR =
	'Invalid Earthly Shapefile metadata sidecar; import was aborted to avoid losing source and license information.'

type EarthlyShapefileFeatureMetadata = {
	token: string
	id?: string | number
	source?: unknown
	sourceRecords?: unknown
}

type EarthlyShapefileMetadata = {
	schemaVersion: 1
	collection: Record<string, unknown>
	rows: EarthlyShapefileFeatureMetadata[]
}

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

const SIDECAR_FEATURE_PROPERTY_KEYS = new Set(['source', 'sourceRecords'])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): boolean {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	) {
		return true
	}
	if (Array.isArray(value)) return value.every(isJsonValue)
	return isRecord(value) && Object.values(value).every(isJsonValue)
}

function invalidEarthlyMetadata(): Error {
	return new Error(EARTHLY_SHAPEFILE_METADATA_ERROR)
}

function shouldSkipDbfProperty(key: string): boolean {
	return (
		INTERNAL_SHAPEFILE_PROPERTY_KEYS.has(key) ||
		SIDECAR_FEATURE_PROPERTY_KEYS.has(key) ||
		key === EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY
	)
}

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
		if (shouldSkipDbfProperty(key)) continue
		result[key] = toDbfSafeValue(value)
	}

	const customProperties = sourceProperties.customProperties
	if (
		customProperties &&
		typeof customProperties === 'object' &&
		!Array.isArray(customProperties)
	) {
		for (const [key, value] of Object.entries(customProperties as Record<string, unknown>)) {
			if (key in result || shouldSkipDbfProperty(key)) continue
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

function createRowToken(index: number): string {
	return `e${index.toString(36).padStart(7, '0')}`
}

function collectionMetadata(collection: FeatureCollection): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		...(collection as unknown as Record<string, unknown>),
	}
	delete metadata.type
	delete metadata.features
	return metadata
}

function featureMetadata(feature: GeoJSON.Feature, token: string): EarthlyShapefileFeatureMetadata {
	const properties = isRecord(feature.properties) ? feature.properties : {}
	const customProperties = isRecord(properties.customProperties)
		? properties.customProperties
		: undefined
	const source = Object.hasOwn(properties, 'source')
		? properties.source
		: customProperties && Object.hasOwn(customProperties, 'source')
			? customProperties.source
			: undefined
	const sourceRecords = Object.hasOwn(properties, 'sourceRecords')
		? properties.sourceRecords
		: customProperties && Object.hasOwn(customProperties, 'sourceRecords')
			? customProperties.sourceRecords
			: undefined

	return {
		token,
		...(typeof feature.id === 'string' || typeof feature.id === 'number' ? { id: feature.id } : {}),
		...(source !== undefined ? { source } : {}),
		...(sourceRecords !== undefined ? { sourceRecords } : {}),
	}
}

function normalizeCollectionForShapefile(collection: FeatureCollection): {
	collection: FeatureCollection
	skippedCount: number
	metadata: EarthlyShapefileMetadata
} {
	const normalizedFeatures: GeoJSON.Feature[] = []
	const featureMetadataRows: EarthlyShapefileFeatureMetadata[] = []
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
			const token = createRowToken(normalizedFeatures.length)

			normalizedFeatures.push({
				type: 'Feature',
				id: candidate.id,
				geometry: candidate.geometry,
				properties: {
					...sanitizeShapefileProperties(candidate.properties),
					[EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY]: token,
				},
			})
			featureMetadataRows.push(featureMetadata(candidate, token))
		}
	}

	return {
		collection: {
			type: 'FeatureCollection',
			features: normalizedFeatures,
		},
		skippedCount,
		metadata: {
			schemaVersion: 1,
			collection: collectionMetadata(collection),
			rows: featureMetadataRows,
		},
	}
}

function parseEarthlyMetadata(value: unknown): EarthlyShapefileMetadata {
	if (!isRecord(value) || value.schemaVersion !== 1) throw invalidEarthlyMetadata()
	if (!isRecord(value.collection)) throw invalidEarthlyMetadata()
	if (Object.hasOwn(value.collection, 'type') || Object.hasOwn(value.collection, 'features')) {
		throw invalidEarthlyMetadata()
	}
	if (Object.hasOwn(value.collection, 'properties') && !isRecord(value.collection.properties)) {
		throw invalidEarthlyMetadata()
	}
	if (!Array.isArray(value.rows)) throw invalidEarthlyMetadata()

	const tokens = new Set<string>()
	const rows = value.rows.map((candidate) => {
		if (!isRecord(candidate)) throw invalidEarthlyMetadata()
		const token = candidate.token
		if (typeof token !== 'string' || !/^e[0-9a-z]{7}$/u.test(token) || tokens.has(token)) {
			throw invalidEarthlyMetadata()
		}
		tokens.add(token)

		const id = candidate.id
		if (
			id !== undefined &&
			typeof id !== 'string' &&
			(typeof id !== 'number' || !Number.isFinite(id))
		) {
			throw invalidEarthlyMetadata()
		}
		if (candidate.source !== undefined && !isJsonValue(candidate.source)) {
			throw invalidEarthlyMetadata()
		}
		if (candidate.sourceRecords !== undefined && !isJsonValue(candidate.sourceRecords)) {
			throw invalidEarthlyMetadata()
		}

		return {
			token,
			...(id !== undefined ? { id: id as string | number } : {}),
			...(candidate.source !== undefined ? { source: candidate.source } : {}),
			...(candidate.sourceRecords !== undefined ? { sourceRecords: candidate.sourceRecords } : {}),
		}
	})

	return {
		schemaVersion: 1,
		collection: value.collection,
		rows,
	}
}

async function loadJsZip() {
	return (await import('jszip')).default
}

async function readEarthlyMetadata(
	input: ArrayBuffer,
): Promise<EarthlyShapefileMetadata | undefined> {
	const JSZip = await loadJsZip()
	const archive = await JSZip.loadAsync(input)
	const sidecars = Object.values(archive.files).filter(
		(entry) =>
			!entry.dir && entry.name.split('/').at(-1)?.toLowerCase() === EARTHLY_SHAPEFILE_METADATA_FILE,
	)
	if (sidecars.length === 0) return undefined
	if (sidecars.length !== 1) throw invalidEarthlyMetadata()
	const sidecar = sidecars[0]
	if (!sidecar) throw invalidEarthlyMetadata()

	try {
		const text = await sidecar.async('text')
		return parseEarthlyMetadata(JSON.parse(text))
	} catch (error) {
		if (error instanceof Error && error.message === EARTHLY_SHAPEFILE_METADATA_ERROR) {
			throw error
		}
		throw invalidEarthlyMetadata()
	}
}

function isShpJsCollection(value: unknown): value is ShpJsCollection {
	return isRecord(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)
}

function mergeImportedCollections(
	parsed: unknown,
	metadata?: EarthlyShapefileMetadata,
): FeatureCollection {
	const candidates = Array.isArray(parsed) ? parsed : [parsed]
	const collections = candidates.filter(isShpJsCollection)
	const metadataByToken = new Map(metadata?.rows.map((feature) => [feature.token, feature]))
	const usedMetadataTokens = new Set<string>()
	const features = collections.flatMap((collection) => {
		const sourceLayer =
			typeof collection.fileName === 'string' && collection.fileName.trim()
				? collection.fileName.trim()
				: undefined

		return collection.features.map((feature) => {
			const parsedProperties = isRecord(feature.properties) ? feature.properties : {}
			const token = parsedProperties[EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY]
			const restored = typeof token === 'string' ? metadataByToken.get(token) : undefined
			if (metadata) {
				if (!restored || typeof token !== 'string' || usedMetadataTokens.has(token)) {
					throw invalidEarthlyMetadata()
				}
				usedMetadataTokens.add(token)
			}
			const properties = { ...parsedProperties }
			delete properties[EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY]

			return {
				...feature,
				...(restored?.id !== undefined ? { id: restored.id } : {}),
				properties: {
					...properties,
					...(sourceLayer ? { sourceLayer } : {}),
					...(restored?.source !== undefined ? { source: restored.source } : {}),
					...(restored?.sourceRecords !== undefined
						? { sourceRecords: restored.sourceRecords }
						: {}),
				},
			}
		})
	})
	if (metadata && usedMetadataTokens.size !== metadata.rows.length) {
		throw invalidEarthlyMetadata()
	}

	return {
		...(metadata?.collection ?? {}),
		type: 'FeatureCollection',
		features,
	} as FeatureCollection
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
		const input = await file.arrayBuffer()
		const metadata = await readEarthlyMetadata(input)
		const parsed = await shp(input)
		return mergeImportedCollections(parsed, metadata)
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
	const {
		collection: normalizedCollection,
		skippedCount,
		metadata,
	} = normalizeCollectionForShapefile(collection)

	if (normalizedCollection.features.length === 0) {
		throw new Error('No supported features available for SHP export.')
	}

	const safeFileName = sanitizeFileName(filename)
	const shapefileBlob = await zip<'blob'>(normalizedCollection, {
		filename: safeFileName,
		folder: safeFileName,
		outputType: 'blob',
		compression: 'STORE',
		prj: SHAPEFILE_PRJ_WGS84,
	})
	const JSZip = await loadJsZip()
	const archive = await JSZip.loadAsync(await shapefileBlob.arrayBuffer())
	archive.file(EARTHLY_SHAPEFILE_METADATA_FILE, JSON.stringify(metadata, null, 2))
	const blob = await archive.generateAsync({
		type: 'blob',
		compression: 'STORE',
	})

	return {
		blob,
		skippedCount,
		downloadName: `${safeFileName}.zip`,
	}
}
