import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	authorizePresentationLayer,
	getUsableMapPresentation,
	type MapPresentationAuthorization,
} from './authorization'
import { parseMapPresentationSource } from './codec'
import { selectPresentationFeatures } from './featureIdentity'
import type {
	MapPresentationIssue,
	MapPresentationLayerV1,
	MapPresentationParseResult,
	MapPresentationSource,
	MapPresentationV1,
} from './types'

export type PresentationLayerResolutionStatus =
	| 'loading'
	| 'resolved'
	| 'partial-missing'
	| 'missing-source'
	| 'missing-features'
	| 'unauthorized-source'
	| 'unauthorized-features'
	| 'blob-error'

export type PresentationSourceResolution =
	| { readonly status: 'loading' }
	| { readonly status: 'missing-source' }
	| {
			readonly status: 'resolved'
			readonly sourceEvent: GeoDataset
			readonly featureCollection: FeatureCollection
	  }
	| {
			readonly status: 'blob-error'
			readonly sourceEvent: GeoDataset
			readonly error: string
	  }

export interface PresentationLayerResolution {
	readonly layer: MapPresentationLayerV1
	readonly status: PresentationLayerResolutionStatus
	/** Always safe to render. Diagnostic/error states deliberately expose an empty collection. */
	readonly featureCollection: FeatureCollection
	readonly sourceEvent?: GeoDataset
	readonly matchedFeatureIds: readonly string[]
	readonly missingFeatureIds: readonly string[]
	readonly unauthorizedFeatureIds: readonly string[]
	readonly error?: string
}

export interface PresentationRuntimeResolution {
	/** Null for absent/unsupported/invalid presentations and an invalid `layers` root. */
	readonly presentation: MapPresentationV1 | null
	readonly layers: readonly PresentationLayerResolution[]
	/** Codec diagnostics are retained even when the presentation cannot run. */
	readonly issues: readonly MapPresentationIssue[]
}

const EMPTY_COLLECTION: FeatureCollection = Object.freeze({
	type: 'FeatureCollection',
	features: [],
})
const EMPTY_IDS = Object.freeze([]) as readonly string[]

function emptyLayerResolution(
	layer: MapPresentationLayerV1,
	status: PresentationLayerResolutionStatus,
	options: {
		sourceEvent?: GeoDataset
		missingFeatureIds?: readonly string[]
		unauthorizedFeatureIds?: readonly string[]
		error?: string
	} = {},
): PresentationLayerResolution {
	return Object.freeze({
		layer,
		status,
		featureCollection: EMPTY_COLLECTION,
		...(options.sourceEvent ? { sourceEvent: options.sourceEvent } : {}),
		matchedFeatureIds: EMPTY_IDS,
		missingFeatureIds: options.missingFeatureIds ?? EMPTY_IDS,
		unauthorizedFeatureIds: options.unauthorizedFeatureIds ?? EMPTY_IDS,
		...(options.error ? { error: options.error } : {}),
	})
}

export function getPresentationDatasetSource(event: GeoDataset): MapPresentationSource | null {
	return (
		parseMapPresentationSource(`${event.kind}:${event.pubkey}:${event.datasetId}`)?.coordinate ??
		null
	)
}

/**
 * Index exact sources deterministically. The latest replaceable event wins;
 * event id is a stable tie-breaker for malformed relay timelines.
 */
export function indexPresentationSourceEvents(
	events: readonly GeoDataset[],
): ReadonlyMap<MapPresentationSource, GeoDataset> {
	const bySource = new Map<MapPresentationSource, GeoDataset>()
	for (const event of events) {
		const source = getPresentationDatasetSource(event)
		if (!source) continue
		const previous = bySource.get(source)
		if (
			!previous ||
			event.created_at > previous.created_at ||
			(event.created_at === previous.created_at && event.id > previous.id)
		) {
			bySource.set(source, event)
		}
	}
	return bySource
}

/** Resolve ordered layer instances without widening any selector. */
export function resolvePresentationLayers(
	result: MapPresentationParseResult,
	authorization: MapPresentationAuthorization,
	sources: ReadonlyMap<MapPresentationSource, PresentationSourceResolution>,
): PresentationRuntimeResolution {
	const presentation = getUsableMapPresentation(result)
	const issues = Object.freeze([...result.issues])
	if (!presentation) {
		return Object.freeze({ presentation: null, layers: Object.freeze([]), issues })
	}

	const layers = presentation.layers.map((layer): PresentationLayerResolution => {
		const authorized = authorizePresentationLayer(layer, authorization)
		if (authorized.status === 'unauthorized-source') {
			return emptyLayerResolution(layer, 'unauthorized-source', {
				error: `Source ${layer.source} is not referenced by the containing object.`,
			})
		}
		if (authorized.status === 'unauthorized-features') {
			return emptyLayerResolution(layer, 'unauthorized-features', {
				unauthorizedFeatureIds: authorized.featureIds,
				error: authorized.requestedWholeMap
					? `The containing object authorizes only cited features from ${layer.source}.`
					: `The layer selects features that the containing object does not reference.`,
			})
		}

		const source = sources.get(layer.source) ?? ({ status: 'loading' } as const)
		if (source.status === 'loading') return emptyLayerResolution(layer, 'loading')
		if (source.status === 'missing-source') {
			return emptyLayerResolution(layer, 'missing-source', {
				error: `Referenced Map ${layer.source} could not be found.`,
			})
		}
		if (source.status === 'blob-error') {
			return emptyLayerResolution(layer, 'blob-error', {
				sourceEvent: source.sourceEvent,
				error: source.error,
			})
		}

		const selection = selectPresentationFeatures(source.featureCollection, layer.featureIds)
		if (selection.missingFeatureIds.length === 0) {
			return Object.freeze({
				layer,
				status: 'resolved' as const,
				featureCollection: selection.featureCollection,
				sourceEvent: source.sourceEvent,
				matchedFeatureIds: selection.matchedFeatureIds,
				missingFeatureIds: EMPTY_IDS,
				unauthorizedFeatureIds: EMPTY_IDS,
			})
		}
		if (selection.matchedFeatureIds.length === 0) {
			return emptyLayerResolution(layer, 'missing-features', {
				sourceEvent: source.sourceEvent,
				missingFeatureIds: selection.missingFeatureIds,
				error: 'None of the selected features exist in the latest source Map.',
			})
		}
		return Object.freeze({
			layer,
			status: 'partial-missing' as const,
			featureCollection: selection.featureCollection,
			sourceEvent: source.sourceEvent,
			matchedFeatureIds: selection.matchedFeatureIds,
			missingFeatureIds: selection.missingFeatureIds,
			unauthorizedFeatureIds: EMPTY_IDS,
			error: 'Some selected features no longer exist in the latest source Map.',
		})
	})

	return Object.freeze({
		presentation,
		layers: Object.freeze(layers),
		issues,
	})
}
