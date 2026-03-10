import { nip19 } from 'nostr-tools'
import type { NDKGeoEvent } from '../ndk/NDKGeoEvent'
import type { MapContextFixedReference, NDKMapContextEvent } from '../ndk/NDKMapContextEvent'

interface FeatureLookupItem {
	address: string
	featureId?: string
	name: string
	datasetName?: string
}

export interface ResolvedContextFixedReference {
	reference: MapContextFixedReference
	dataset: NDKGeoEvent | null
	label: string
	datasetName?: string
}

export function resolveNaddrToDataset(
	address: string,
	geoEvents: NDKGeoEvent[],
): NDKGeoEvent | null {
	if (!address || !address.startsWith('naddr1')) {
		return null
	}

	try {
		const decoded = nip19.decode(address)
		if (decoded.type !== 'naddr') return null

		const { kind, pubkey, identifier } = decoded.data

		return (
			geoEvents.find(
				(event) =>
					event.kind === kind &&
					event.pubkey === pubkey &&
					(event.datasetId === identifier || event.dTag === identifier || event.id === identifier),
			) ?? null
		)
	} catch {
		return null
	}
}

export function getContextFixedReferences(
	context: NDKMapContextEvent | null | undefined,
): MapContextFixedReference[] {
	const fixedReferences = context?.context.fixedReferences
	if (!Array.isArray(fixedReferences)) return []

	return fixedReferences.flatMap((reference) => {
		if (!reference || typeof reference !== 'object') return []
		if (typeof reference.address !== 'string' || reference.address.trim().length === 0) return []

		return [
			{
				address: reference.address,
				featureId:
					typeof reference.featureId === 'string' && reference.featureId.trim().length > 0
						? reference.featureId
						: undefined,
				label:
					typeof reference.label === 'string' && reference.label.trim().length > 0
						? reference.label
						: undefined,
			},
		]
	})
}

export function resolveContextFixedReferences(
	context: NDKMapContextEvent | null | undefined,
	geoEvents: NDKGeoEvent[],
	availableFeatures: FeatureLookupItem[] = [],
): ResolvedContextFixedReference[] {
	return getContextFixedReferences(context).map((reference) => {
		const dataset = resolveNaddrToDataset(reference.address, geoEvents)
		const matchingFeature = availableFeatures.find(
			(feature) =>
				feature.address === reference.address &&
				(feature.featureId ?? undefined) === (reference.featureId ?? undefined),
		)
		const datasetMatch =
			matchingFeature ??
			availableFeatures.find(
				(feature) => feature.address === reference.address && feature.featureId === undefined,
			)
		const label =
			reference.label ??
			matchingFeature?.name ??
			datasetMatch?.name ??
			dataset?.featureCollection?.name ??
			dataset?.datasetId ??
			'Referenced dataset'

		return {
			reference,
			dataset,
			label,
			datasetName: datasetMatch?.datasetName ?? dataset?.featureCollection?.name,
		}
	})
}

export function getContextStickyDatasets(
	context: NDKMapContextEvent | null | undefined,
	geoEvents: NDKGeoEvent[],
): NDKGeoEvent[] {
	const seen = new Set<string>()
	const datasets: NDKGeoEvent[] = []

	getContextFixedReferences(context).forEach((reference) => {
		const dataset = resolveNaddrToDataset(reference.address, geoEvents)
		if (!dataset) return

		const datasetId = dataset.datasetId ?? dataset.dTag ?? dataset.id
		if (!datasetId) return

		const key = `${dataset.kind ?? NDKGeoEvent.kinds[0]}:${dataset.pubkey}:${datasetId}`
		if (seen.has(key)) return
		seen.add(key)
		datasets.push(dataset)
	})

	return datasets
}
