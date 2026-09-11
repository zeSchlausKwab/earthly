import type { Filter } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { naddrToCoordinate } from '@/lib/nostr/references'
import { parseMapPresentationSource } from './codec'
import { extractSemanticStoryMapReferences } from './storyMarkdown'
import type {
	MapPresentationLayerV1,
	MapPresentationParseResult,
	MapPresentationSource,
	MapPresentationV1,
} from './types'

export type PresentationSourceAuthorization =
	| {
			readonly source: MapPresentationSource
			readonly scope: 'whole'
	  }
	| {
			readonly source: MapPresentationSource
			readonly scope: 'features'
			readonly featureIds: readonly string[]
	  }

export type MapPresentationAuthorization = ReadonlyMap<
	MapPresentationSource,
	PresentationSourceAuthorization
>

export type PresentationLayerAuthorization =
	| { readonly status: 'authorized' }
	| { readonly status: 'unauthorized-source' }
	| {
			readonly status: 'unauthorized-features'
			/** Empty when the denied request was for the whole Map. */
			readonly featureIds: readonly string[]
			readonly requestedWholeMap: boolean
	  }

export interface PresentationSourceRequest {
	readonly source: MapPresentationSource
	/** Exact address filter. Combining authors and d-tags would create a Cartesian request. */
	readonly filter: Filter
}

/**
 * A malformed `layers` root makes the presentation unusable. Individual bad
 * layer entries are already dropped by the codec and remain visible through
 * `issues`, while other valid entries may still be used.
 */
export function getUsableMapPresentation(
	result: MapPresentationParseResult,
): MapPresentationV1 | null {
	if (result.status !== 'valid') return null
	if (result.issues.some((issue) => issue.code === 'invalid-layers' && issue.path === '$.layers')) {
		return null
	}
	return result.value
}

/**
 * Derive Story grants exclusively from semantic references in the Markdown
 * body. Mirrored `a` tags are intentionally not accepted here: the body owns
 * fine-grained feature authorization.
 */
export function deriveStoryPresentationAuthorization(
	markdown: string | null | undefined,
): MapPresentationAuthorization {
	const grants = new Map<
		MapPresentationSource,
		{ whole: boolean; featureIds: string[]; seenFeatureIds: Set<string> }
	>()

	for (const reference of extractSemanticStoryMapReferences(markdown)) {
		const coordinate = naddrToCoordinate(reference.address)
		const source = parseMapPresentationSource(coordinate)?.coordinate
		if (!source) continue

		const grant = grants.get(source) ?? {
			whole: false,
			featureIds: [],
			seenFeatureIds: new Set<string>(),
		}
		if (reference.featureId === undefined) {
			grant.whole = true
		} else if (!grant.seenFeatureIds.has(reference.featureId)) {
			grant.seenFeatureIds.add(reference.featureId)
			grant.featureIds.push(reference.featureId)
		}
		grants.set(source, grant)
	}

	const authorization = new Map<MapPresentationSource, PresentationSourceAuthorization>()
	for (const [source, grant] of grants) {
		authorization.set(
			source,
			grant.whole
				? Object.freeze({ source, scope: 'whole' as const })
				: Object.freeze({
						source,
						scope: 'features' as const,
						featureIds: Object.freeze(grant.featureIds),
					}),
		)
	}
	return authorization
}

/**
 * Honest fallback for Stories that predate the embedded presentation field (or
 * carry a future/malformed value we cannot interpret). Semantic body references
 * still produce a useful, selector-safe opening map; an explicitly valid empty
 * presentation remains empty and never comes through this helper.
 */
export function buildFallbackStoryPresentation(
	markdown: string | null | undefined,
): MapPresentationV1 {
	const authorization = deriveStoryPresentationAuthorization(markdown)
	const layers: MapPresentationLayerV1[] = []
	let ordinal = 1
	for (const grant of authorization.values()) {
		layers.push(
			Object.freeze({
				id: `reference-${ordinal}`,
				source: grant.source,
				...(grant.scope === 'features' ? { featureIds: Object.freeze([...grant.featureIds]) } : {}),
				visible: true,
				opacityMultiplier: 1,
			}),
		)
		ordinal += 1
	}
	return Object.freeze({ version: 1, layers: Object.freeze(layers) })
}

/** Atlas presentation grants come only from the owner's accepted/curated `a` lane. */
export function deriveAtlasPresentationAuthorization(
	acceptedAddresses: readonly string[],
): MapPresentationAuthorization {
	const authorization = new Map<MapPresentationSource, PresentationSourceAuthorization>()
	for (const address of acceptedAddresses) {
		const parsed = parseMapPresentationSource(address)
		if (!parsed || authorization.has(parsed.coordinate)) continue
		authorization.set(
			parsed.coordinate,
			Object.freeze({ source: parsed.coordinate, scope: 'whole' as const }),
		)
	}
	return authorization
}

/**
 * Honest Atlas fallback for content without a usable authored default view.
 * The owner-curated `a` lane supplies whole-Map layers in tag order; callers
 * keep this route-local and must not write it back over malformed/future data.
 */
export function buildFallbackAtlasPresentation(
	acceptedAddresses: readonly string[],
): MapPresentationV1 {
	const authorization = deriveAtlasPresentationAuthorization(acceptedAddresses)
	return Object.freeze({
		version: 1,
		layers: Object.freeze(
			[...authorization.keys()].map((source, index) =>
				Object.freeze({
					id: `atlas-map-${index + 1}`,
					source,
					visible: true,
					opacityMultiplier: 1,
				}),
			),
		),
	})
}

/** Strictly authorize one layer. A partially authorized selector is rejected as a whole. */
export function authorizePresentationLayer(
	layer: MapPresentationLayerV1,
	authorization: MapPresentationAuthorization,
): PresentationLayerAuthorization {
	const grant = authorization.get(layer.source)
	if (!grant) return Object.freeze({ status: 'unauthorized-source' as const })
	if (grant.scope === 'whole') return Object.freeze({ status: 'authorized' as const })

	if (layer.featureIds === undefined) {
		return Object.freeze({
			status: 'unauthorized-features' as const,
			featureIds: Object.freeze([]),
			requestedWholeMap: true,
		})
	}

	const allowed = new Set(grant.featureIds)
	const unauthorized = layer.featureIds.filter((featureId) => !allowed.has(featureId))
	if (unauthorized.length === 0) return Object.freeze({ status: 'authorized' as const })
	return Object.freeze({
		status: 'unauthorized-features' as const,
		featureIds: Object.freeze(unauthorized),
		requestedWholeMap: false,
	})
}

/**
 * Produce one exact filter per distinct authorized kind-37515 coordinate.
 * Duplicate render instances remain in the presentation; only their fetch is
 * deduplicated.
 */
export function buildPresentationSourceRequests(
	result: MapPresentationParseResult,
	authorization: MapPresentationAuthorization,
): readonly PresentationSourceRequest[] {
	const presentation = getUsableMapPresentation(result)
	if (!presentation) return Object.freeze([])

	const seen = new Set<MapPresentationSource>()
	const requests: PresentationSourceRequest[] = []
	for (const layer of presentation.layers) {
		if (authorizePresentationLayer(layer, authorization).status !== 'authorized') continue
		if (seen.has(layer.source)) continue
		const source = parseMapPresentationSource(layer.source)
		if (!source) continue
		seen.add(source.coordinate)
		requests.push(
			Object.freeze({
				source: source.coordinate,
				filter: Object.freeze({
					kinds: [GEO_EVENT_KIND],
					authors: [source.pubkey],
					'#d': [source.identifier],
				}),
			}),
		)
	}
	return Object.freeze(requests)
}

export function buildAuthorizedPresentationSourceFilters(
	result: MapPresentationParseResult,
	authorization: MapPresentationAuthorization,
): readonly Filter[] {
	return Object.freeze(
		buildPresentationSourceRequests(result, authorization).map((request) => request.filter),
	)
}
