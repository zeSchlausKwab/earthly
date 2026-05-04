import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	isGeoJsonFeature,
	isGeoJsonFeatureCollection,
	isGeoJsonGeometry,
	normalizeGeoJsonToFeatureCollection,
} from '@/lib/geo/normalizeGeoJSON'
import type { EditorFeature } from './core'
import { NON_CUSTOM_EDITOR_PROPERTY_KEYS } from './constants'
import { isStyleProperty } from './types/styleProperties'
import type { CollectionMeta } from './types'

export function convertGeoEventsToEditorFeatures(
	events: GeoDataset[],
	collectionResolver?: (event: GeoDataset) => FeatureCollection | undefined,
): EditorFeature[] {
	const aggregated: EditorFeature[] = []

	events.forEach((event) => {
		const datasetId = event.datasetId ?? event.id
		const collection = collectionResolver?.(event) ?? event.featureCollection

		// Extract collection-level color to propagate to features
		const collectionColor = getCollectionColor(collection)

		collection.features.forEach((feature, index) => {
			if (!feature.geometry) return

			const featureId =
				typeof feature.id === 'string'
					? feature.id
					: `${datasetId}:${typeof feature.id === 'number' ? feature.id : index}`

			// Use feature-level color if present, otherwise use collection color
			const featureColor = (feature.properties as any)?.color ?? collectionColor

			aggregated.push({
				type: 'Feature',
				id: featureId,
				geometry: feature.geometry as any,
				properties: {
					...(feature.properties ?? {}),
					meta: 'feature',
					datasetId,
					sourceEventId: event.id,
					hashtags: event.hashtags,
					...(featureColor ? { color: featureColor } : {}),
				},
			})
		})
	})

	return aggregated
}

/**
 * Extract color from collection-level properties.
 * Checks both root-level `color` and `properties.color`.
 */
function getCollectionColor(collection: FeatureCollection): string | undefined {
	const asAny = collection as any
	if (typeof asAny.color === 'string') return asAny.color
	if (typeof asAny.properties?.color === 'string') return asAny.properties.color
	return undefined
}

export function convertGeoEventsToFeatureCollection(
	events: GeoDataset[],
	collectionResolver?: (event: GeoDataset) => FeatureCollection | undefined,
): FeatureCollection {
	const features = events.flatMap((event) => {
		const datasetId = event.datasetId ?? event.id
		const collection = collectionResolver?.(event) ?? event.featureCollection

		// Extract collection-level color to propagate to features
		const collectionColor = getCollectionColor(collection)

		return collection.features
			.filter((feature) => Boolean(feature.geometry))
			.map((feature) => {
				// Use feature-level color if present, otherwise use collection color
				const featureColor = (feature.properties as any)?.color ?? collectionColor

				return {
					...feature,
					properties: {
						...(feature.properties ?? {}),
						datasetId,
						sourceEventId: event.id,
						...(featureColor ? { color: featureColor } : {}),
					},
				}
			})
	})

	return {
		type: 'FeatureCollection',
		features,
	}
}

export async function fetchGeoJsonPayload(
	url: string,
): Promise<{ payload: any; size?: number; mimeType?: string }> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
	}
	const sizeHeader = response.headers.get('content-length')
	const size = sizeHeader ? Number.parseInt(sizeHeader, 10) : undefined
	const mimeType = response.headers.get('content-type') ?? undefined
	const payload = await response.json()
	return { payload, size, mimeType }
}

export function ensureFeatureCollection(payload: any): FeatureCollection {
	if (
		isGeoJsonFeatureCollection(payload) ||
		isGeoJsonFeature(payload) ||
		isGeoJsonGeometry(payload) ||
		(typeof payload === 'object' && payload !== null && 'geometry' in (payload as any))
	) {
		return normalizeGeoJsonToFeatureCollection(payload)
	}

	throw new Error(
		'Payload is not a GeoJSON Feature, FeatureCollection, Geometry, or Feature-like object.',
	)
}

export function summarizeFeatureCollection(collection: FeatureCollection): {
	featureCount: number
	geometryTypes: string[]
} {
	const geometries = new Set<string>()
	let featureCount = 0
	for (const feature of collection.features ?? []) {
		if (feature?.geometry) {
			featureCount += 1
			if (feature.geometry.type) {
				geometries.add(feature.geometry.type)
			}
		}
	}
	return {
		featureCount: collection.features?.length ?? 0,
		geometryTypes: Array.from(geometries),
	}
}

export function detectBlobScope(collection: FeatureCollection): {
	scope: 'collection' | 'feature'
	featureId?: string
} {
	const features = collection.features ?? []
	if (features.length <= 1) {
		let featureId: string | undefined
		if (features.length === 0) {
			featureId = crypto.randomUUID()
			collection.features = [
				{
					type: 'Feature',
					id: featureId,
					geometry: null,
					properties: {
						externalPlaceholder: true,
					},
				} as any,
			]
		} else {
			const first = features[0]
			if (first && !first.id) {
				first.id = crypto.randomUUID()
			}
			featureId =
				first && typeof first.id === 'string'
					? first.id
					: first && typeof first.id === 'number'
						? String(first.id)
						: undefined
		}
		return {
			scope: 'feature',
			featureId,
		}
	}

	return {
		scope: 'collection',
	}
}

export function sanitizeEditorProperties(
	props?: Record<string, any>,
): Record<string, any> | undefined {
	if (!props) return undefined
	const { meta, datasetId, sourceEventId, hashtags, ...rest } = props
	return Object.keys(rest).length > 0 ? rest : undefined
}

export function createDefaultCollectionMeta(): CollectionMeta {
	return {
		name: '',
		description: '',
		color: '#1d4ed8',
		customProperties: {},
	}
}

export function extractCollectionMeta(collection: FeatureCollection): CollectionMeta {
	const meta = createDefaultCollectionMeta()
	const asAny = collection as any
	if (typeof asAny.name === 'string') meta.name = asAny.name
	if (typeof asAny.description === 'string') meta.description = asAny.description
	if (typeof asAny.color === 'string') meta.color = asAny.color
	const properties = { ...(asAny.properties ?? {}) }
	if (typeof properties.name === 'string' && !meta.name) meta.name = properties.name
	if (typeof properties.description === 'string' && !meta.description)
		meta.description = properties.description
	if (typeof properties.color === 'string') meta.color = properties.color
	delete properties.name
	delete properties.description
	delete properties.color
	meta.customProperties = properties
	return meta
}

export function parseCustomValue(value: string): string | number | boolean {
	const trimmed = value.trim()
	if (trimmed === 'true') return true
	if (trimmed === 'false') return false
	const num = Number(trimmed)
	if (!Number.isNaN(num) && trimmed !== '') {
		return num
	}
	return value
}

/**
 * Derive a stable ID for a GeoJSON feature.
 * Checks `feature.id`, then `properties["@id"]` (OSM convention), then generates a UUID.
 */
export function featureStableId(feature: GeoJSON.Feature): string {
	const rawId = feature.id
	if (typeof rawId === 'string' || typeof rawId === 'number') {
		return String(rawId)
	}
	const props = feature.properties
	if (props && typeof props === 'object') {
		const atId = (props as Record<string, unknown>)['@id']
		if (typeof atId === 'string' || typeof atId === 'number') {
			return String(atId)
		}
	}
	return crypto.randomUUID()
}

/**
 * Convert a raw GeoJSON feature into an EditorFeature, normalizing properties
 * and mirroring non-internal keys into `customProperties`.
 */
export function toEditorFeature(feature: GeoJSON.Feature, importSource?: string): EditorFeature {
	const stableId = featureStableId(feature)
	const sourceProps =
		feature.properties && typeof feature.properties === 'object'
			? (feature.properties as Record<string, unknown>)
			: {}
	const existingCustomProperties =
		sourceProps.customProperties &&
		typeof sourceProps.customProperties === 'object' &&
		!Array.isArray(sourceProps.customProperties)
			? (sourceProps.customProperties as Record<string, unknown>)
			: {}
	const mirroredCustomProperties: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(sourceProps)) {
		if (NON_CUSTOM_EDITOR_PROPERTY_KEYS.has(key) || isStyleProperty(key)) continue
		mirroredCustomProperties[key] = value
	}

	const mergedCustomProperties = {
		...existingCustomProperties,
		...mirroredCustomProperties,
	}

	return {
		...feature,
		id: stableId,
		properties: {
			...sourceProps,
			...(Object.keys(mergedCustomProperties).length > 0
				? { customProperties: mergedCustomProperties }
				: {}),
			meta: 'feature',
			featureId: stableId,
			...(importSource ? { importSource } : {}),
		},
	} as EditorFeature
}
