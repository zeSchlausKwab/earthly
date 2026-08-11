import { useMemo } from 'react'
import { nip19 } from 'nostr-tools'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { parseGeoReference, stringifyGeoReference, type OsmElementType } from '@/lib/geo/reference'

interface NamedFeatureCollection extends FeatureCollection {
	name?: string
	properties?: { name?: string }
}

function parseOsmIdentity(value: unknown): { elementType: OsmElementType; id: string } | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null
	const text = String(value).trim()
	const url = parseGeoReference(text)
	if (url?.kind === 'osm') return { elementType: url.elementType, id: url.id }
	const match = text.match(/^(node|way|relation)[/:](\d+)$/i)
	if (!match?.[1] || !match[2]) return null
	return { elementType: match[1].toLowerCase() as OsmElementType, id: match[2] }
}

export function getOsmReferenceForFeature(feature: GeoJSON.Feature): string | null {
	const properties = feature.properties as Record<string, unknown> | null | undefined
	const directCandidates = [
		feature.id,
		properties?.osmRef,
		properties?.osm_ref,
		properties?.['@id'],
	]
	for (const candidate of directCandidates) {
		const identity = parseOsmIdentity(candidate)
		if (identity) return stringifyGeoReference({ kind: 'osm', ...identity })
	}

	const elementType = properties?.osmType ?? properties?.osm_type ?? properties?.type
	const id = properties?.osmId ?? properties?.osm_id
	if (
		typeof elementType === 'string' &&
		['node', 'way', 'relation'].includes(elementType.toLowerCase()) &&
		(typeof id === 'string' || typeof id === 'number')
	) {
		const numericId = String(id).trim()
		if (/^\d+$/.test(numericId)) {
			return stringifyGeoReference({
				kind: 'osm',
				elementType: elementType.toLowerCase() as OsmElementType,
				id: numericId,
			})
		}
	}
	return null
}

/**
 * Extracts available features from visible geo events for use in mention suggestions.
 * Each feature gets a proper naddr1 address for NIP-27 compliant references.
 */
export function useAvailableGeoFeatures(
	geoEvents: GeoDataset[],
	resolvedCollectionResolver?: (event: GeoDataset) => FeatureCollection | undefined,
	mapContexts: MapContext[] = [],
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

					const osmReference = getOsmReferenceForFeature(feature)
					if (osmReference) {
						const osm = parseGeoReference(osmReference)
						items.push({
							id: `osm:${osmReference}`,
							name: `${featureName} on OpenStreetMap`,
							address: osmReference,
							entityType: 'osm',
							datasetName,
							geometryType:
								osm?.kind === 'osm' ? `OSM ${osm.elementType} ${osm.id}` : 'OpenStreetMap',
						})
					}
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
