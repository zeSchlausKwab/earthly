import { useMemo } from 'react'
import { nip19 } from 'nostr-tools'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoEvent } from '../ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../ndk/NDKMapContextEvent'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'

interface NamedFeatureCollection extends FeatureCollection {
	name?: string
	properties?: { name?: string }
}

/**
 * Extracts available features from visible geo events for use in mention suggestions.
 * Each feature gets a proper naddr1 address for NIP-27 compliant references.
 */
export function useAvailableGeoFeatures(
	geoEvents: NDKGeoEvent[],
	resolvedCollectionResolver?: (event: NDKGeoEvent) => FeatureCollection | undefined,
	mapContexts: NDKMapContextEvent[] = [],
): GeoFeatureItem[] {
	return useMemo(() => {
		const items: GeoFeatureItem[] = []

		for (const event of geoEvents) {
			const identifier = event.datasetId ?? event.dTag ?? event.id
			if (!identifier || !event.pubkey || !event.kind) continue

			// Create naddr for the dataset
			let naddr: string
			try {
				naddr = nip19.naddrEncode({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier,
				})
			} catch {
				// Fallback to a simple format if encoding fails
				naddr = `${event.kind}:${event.pubkey}:${identifier}`
			}

			// Get dataset name from featureCollection
			const collection = (resolvedCollectionResolver?.(event) ??
				event.featureCollection) as NamedFeatureCollection
			const datasetName = collection?.name || collection?.properties?.name || identifier

			// Add dataset-level item
			items.push({
				id: `dataset:${event.id ?? identifier}`,
				name: datasetName,
				address: naddr,
				entityType: 'dataset',
				datasetName,
				geometryType: 'Dataset',
			})

			// Add individual features
			if (collection?.features) {
				collection.features.forEach((feature, i) => {
					if (!feature.geometry) return

					const featureId =
						typeof feature.id === 'string'
							? feature.id
							: typeof feature.id === 'number'
								? String(feature.id)
								: `${i}`

					const featureName =
						(feature.properties?.name as string) ||
						(feature.properties?.title as string) ||
						(feature.properties?.label as string) ||
						`Feature ${i + 1}`

					const geometryType = feature.geometry?.type || 'Unknown'

					items.push({
						id: `feature:${event.id}:${featureId}`,
						name: featureName,
						address: naddr,
						entityType: 'feature',
						featureId,
						datasetName,
						geometryType,
					})
				})
			}
		}

		for (const context of mapContexts) {
			const identifier = context.contextId ?? context.dTag ?? context.id
			if (!identifier || !context.pubkey || !context.kind) continue

			try {
				items.push({
					id: `context:${context.id ?? identifier}`,
					name: context.context.name || identifier,
					address: nip19.naddrEncode({
						kind: context.kind,
						pubkey: context.pubkey,
						identifier,
					}),
					entityType: 'context',
					datasetName: context.context.allowForeignAttachments ? 'Open context' : 'Closed context',
					geometryType: 'Context',
				})
			} catch {
				// Ignore contexts that cannot be encoded.
			}
		}

		return items
	}, [geoEvents, mapContexts, resolvedCollectionResolver])
}
