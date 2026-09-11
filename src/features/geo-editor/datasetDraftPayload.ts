import type { FeatureCollection } from 'geojson'
import type { GeoBlobReference } from '@/lib/nostr/geo-event'
import type { GeoCollectionEditDraft } from './store'
import { sanitizeEditorProperties } from './utils'

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

export function buildFeatureCollection(draft: GeoCollectionEditDraft): FeatureCollection {
	const collection: FeatureCollection & {
		name?: string
		description?: string
		color?: string
		properties?: Record<string, unknown>
	} = {
		type: 'FeatureCollection',
		features: draft.features.map((feature) => {
			const properties = sanitizeEditorProperties(
				feature.properties as Record<string, unknown> | undefined,
			)
			return {
				type: 'Feature' as const,
				id: feature.id,
				geometry: clone(feature.geometry),
				...(properties ? { properties } : {}),
			}
		}) as FeatureCollection['features'],
	}

	const existingIds = new Set(collection.features.map((feature) => String(feature.id)))
	for (const reference of draft.blobReferences) {
		if (
			reference.scope !== 'feature' ||
			!reference.featureId ||
			existingIds.has(reference.featureId)
		) {
			continue
		}
		existingIds.add(reference.featureId)
		collection.features.push({
			type: 'Feature',
			id: reference.featureId,
			geometry: null,
			properties: { externalPlaceholder: true, blobUrl: reference.url },
		} as unknown as FeatureCollection['features'][number])
	}

	const title = draft.collectionMeta.name || draft.name || 'Untitled Dataset'
	collection.name = title
	if (draft.collectionMeta.description) collection.description = draft.collectionMeta.description
	if (draft.collectionMeta.color) collection.color = draft.collectionMeta.color
	const properties: Record<string, unknown> = { ...draft.collectionMeta.customProperties }
	if (draft.collectionMeta.name) properties.name = draft.collectionMeta.name
	if (draft.collectionMeta.description) properties.description = draft.collectionMeta.description
	if (draft.collectionMeta.color) properties.color = draft.collectionMeta.color
	if (Object.keys(properties).length > 0) collection.properties = properties
	return collection
}

export function serializeBlobReferences(draft: GeoCollectionEditDraft): GeoBlobReference[] {
	return draft.blobReferences
		.filter((reference) => Boolean(reference.url))
		.map(({ scope, featureId, url, sha256, size, mimeType }) => ({
			scope,
			featureId,
			url,
			sha256,
			size,
			mimeType,
		}))
}
