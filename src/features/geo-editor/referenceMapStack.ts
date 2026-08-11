import { parseGeoReference } from '@/lib/geo/reference'
import { encodeNostrFeatureId } from '@/lib/nostr/references'
import type { MapStackEntry } from './store'

export interface VisibleCoordinateReference {
	entryId: string
	reference: string
	latitude: number
	longitude: number
	title: string
}

export interface ReferenceMapRenderState {
	/** Dataset key → null for whole dataset, or the exact visible feature ids. */
	datasetFeatureSelectors: Record<string, string[] | null>
	coordinates: VisibleCoordinateReference[]
}

export function datasetReferenceEntryId(datasetKey: string, featureId?: string): string {
	return featureId
		? `dataset:${datasetKey}#${encodeNostrFeatureId(featureId)}`
		: `dataset:${datasetKey}`
}

export function featureMatchesReferenceSelector(
	feature: GeoJSON.Feature,
	featureIds: readonly string[],
): boolean {
	const id = feature.id
	const propertyId = feature.properties?.id
	return featureIds.some(
		(featureId) =>
			(typeof id === 'string' || typeof id === 'number' ? String(id) === featureId : false) ||
			(typeof propertyId === 'string' || typeof propertyId === 'number'
				? String(propertyId) === featureId
				: false),
	)
}

/** Pure derivation used by GeoEditorView and unit tests. */
export function deriveReferenceMapRenderState(
	entries: Array<MapStackEntry | undefined>,
): ReferenceMapRenderState {
	const ordered = entries.filter((entry): entry is MapStackEntry => Boolean(entry))
	const isolated = ordered.find((entry) => entry.isolated)
	const visible = isolated ? [isolated] : ordered.filter((entry) => entry.visible !== false)
	const selectorSets = new Map<string, Set<string> | null>()
	const coordinates: VisibleCoordinateReference[] = []

	for (const entry of visible) {
		if (entry.entityType === 'coordinate') {
			const parsed = parseGeoReference(entry.entityKey)
			if (parsed?.kind !== 'coordinate') continue
			coordinates.push({
				entryId: entry.id,
				reference: entry.entityKey,
				latitude: parsed.latitude,
				longitude: parsed.longitude,
				title: entry.title,
			})
			continue
		}
		if (entry.entityType !== 'dataset') continue

		const existing = selectorSets.get(entry.entityKey)
		if (!entry.featureIds || entry.featureIds.length === 0) {
			selectorSets.set(entry.entityKey, null)
			continue
		}
		if (existing === null) continue
		const next = existing ?? new Set<string>()
		for (const featureId of entry.featureIds) next.add(featureId)
		selectorSets.set(entry.entityKey, next)
	}

	const datasetFeatureSelectors: Record<string, string[] | null> = {}
	for (const [datasetKey, selector] of selectorSets) {
		datasetFeatureSelectors[datasetKey] = selector ? [...selector] : null
	}
	return { datasetFeatureSelectors, coordinates }
}
