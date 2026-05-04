import { nip19 } from 'nostr-tools'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	dedupeNostrAddressReferences,
	extractNostrAddressReferences,
	extractNostrAddressReferencesFromList,
	naddrToCoordinate,
} from '../ndk/nostrReferences'

interface ResolvedBaseReference {
	address: string
	featureId?: string
	label: string
}

export interface ResolvedContextDatasetReference extends ResolvedBaseReference {
	type: 'dataset'
	dataset: GeoDataset
}

export interface ResolvedContextContextReference extends ResolvedBaseReference {
	type: 'context'
	context: MapContext
}

export type ResolvedContextReference =
	| ResolvedContextDatasetReference
	| ResolvedContextContextReference

function decodeCoordinate(
	address: string,
): { kind: number; pubkey: string; identifier: string } | null {
	const parts = address.split(':')
	if (parts.length !== 3) return null
	const kind = Number.parseInt(parts[0] ?? '', 10)
	const pubkey = parts[1]
	const identifier = parts[2]
	if (!Number.isFinite(kind) || !pubkey || !identifier) return null
	return { kind, pubkey, identifier }
}

export function encodeContextNaddr(context: MapContext): string | null {
	const identifier = context.contextId ?? context.dTag ?? context.id
	if (!identifier || !context.pubkey || !context.kind) return null

	try {
		return nip19.naddrEncode({
			kind: context.kind,
			pubkey: context.pubkey,
			identifier,
		})
	} catch {
		return null
	}
}

export function getContextReferencedMentions(context: MapContext | null | undefined) {
	return dedupeNostrAddressReferences([
		...extractNostrAddressReferences(context?.context.description),
		...extractNostrAddressReferencesFromList(context?.context.references ?? []),
	])
}

export function resolveContextReferences(
	context: MapContext | null | undefined,
	geoEvents: GeoDataset[],
	mapContexts: MapContext[],
	availableFeatures: GeoFeatureItem[] = [],
): ResolvedContextReference[] {
	const mentions = getContextReferencedMentions(context)

	return mentions.flatMap((reference): ResolvedContextReference[] => {
		const coordinate = naddrToCoordinate(reference.address)
		if (!coordinate) return []

		const featureMatch = availableFeatures.find(
			(item) =>
				item.address === reference.address &&
				(item.featureId ?? undefined) === (reference.featureId ?? undefined),
		)

		const dataset = geoEvents.find((event) => {
			const identifier = event.datasetId ?? event.dTag ?? event.id
			return identifier ? coordinate === `${event.kind}:${event.pubkey}:${identifier}` : false
		})
		if (dataset) {
			return [
				{
					type: 'dataset' as const,
					address: reference.address,
					featureId: reference.featureId,
					dataset,
					label:
						featureMatch?.name ??
						(dataset.featureCollection as { name?: string } | undefined)?.name ??
						dataset.datasetId ??
						'Referenced dataset',
				},
			]
		}

		const childContext = mapContexts.find((event) => {
			const identifier = event.contextId ?? event.dTag ?? event.id
			return identifier ? coordinate === `${event.kind}:${event.pubkey}:${identifier}` : false
		})
		if (childContext) {
			return [
				{
					type: 'context' as const,
					address: reference.address,
					featureId: reference.featureId,
					context: childContext,
					label:
						featureMatch?.name ??
						childContext.context.name ??
						childContext.contextId ??
						'Referenced context',
				},
			]
		}

		return []
	})
}

export function getContextReferencedDatasets(
	context: MapContext | null | undefined,
	geoEvents: GeoDataset[],
): GeoDataset[] {
	const seen = new Set<string>()
	const datasets: GeoDataset[] = []

	context?.referencedAddresses.forEach((coordinate) => {
		const match = decodeCoordinate(coordinate)
		if (!match) return

		const dataset = geoEvents.find((event) => {
			const identifier = event.datasetId ?? event.dTag ?? event.id
			return (
				event.kind === match.kind &&
				event.pubkey === match.pubkey &&
				identifier === match.identifier
			)
		})
		if (!dataset) return

		const key = `${dataset.kind}:${dataset.pubkey}:${dataset.datasetId ?? dataset.dTag ?? dataset.id}`
		if (seen.has(key)) return
		seen.add(key)
		datasets.push(dataset)
	})

	return datasets
}
