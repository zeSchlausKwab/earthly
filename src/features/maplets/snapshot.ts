import type { FeatureCollection } from 'geojson'

export interface MapletSnapshotSource {
	instanceId: string
	title: string
	dTag: string
	aggregateHash: string
	publisher?: string
	manifestId?: string
	updatedAt?: number
}

/** Copy complete source geometry, never the clipped feature returned by map tiles. */
export function copyMapletSnapshot(
	collection: FeatureCollection,
	source: MapletSnapshotSource,
	featureIds?: readonly string[],
	newId: () => string = () => crypto.randomUUID(),
	clock: () => number = Date.now,
): FeatureCollection {
	const selected = featureIds ? new Set(featureIds) : null
	const copiedAt = new Date(clock()).toISOString()
	return {
		type: 'FeatureCollection',
		features: collection.features
			.filter((feature) => !selected || selected.has(String(feature.id)))
			.map((original) => {
				const feature = structuredClone(original)
				const sourceFeatureId = String(original.id)
				const id = newId()
				// These properties belong to host renderers/editor identity, never to the copy.
				const properties = { ...feature.properties }
				for (const key of [
					'featureId',
					'datasetId',
					'sourceEventId',
					'earthlyMapletInstanceId',
					'earthlyMapletFeatureId',
				])
					delete properties[key]
				return {
					...feature,
					id,
					properties: {
						...properties,
						mapletSource: {
							dTag: source.dTag,
							aggregateHash: source.aggregateHash,
							...(source.publisher ? { publisher: source.publisher } : {}),
							...(source.manifestId ? { manifestId: source.manifestId } : {}),
							featureId: sourceFeatureId,
							copiedAt,
							...(source.updatedAt ? { receivedAt: new Date(source.updatedAt).toISOString() } : {}),
						},
					},
				}
			}),
	}
}
