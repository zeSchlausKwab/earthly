import type { GeoFeatureItem } from '@/components/editor'
import {
	authorizePresentationLayer,
	deriveAtlasPresentationAuthorization,
	getUsableMapPresentation,
	mapPresentationSourceKey,
	parseMapPresentation,
	parseMapPresentationSource,
	type MapPresentationLayerSource,
} from '@/lib/map-presentation'
import type { PresentationSourceOption } from '@/lib/map-presentation/authoring'
import { naddrToCoordinate } from '@/lib/nostr/references'

/** Keep the owner's accepted-source order while offering each Map once. */
export function atlasPresentationSourceOptions(
	acceptedSources: readonly MapPresentationLayerSource[],
	availableFeatures: readonly GeoFeatureItem[],
	localLabels: ReadonlyMap<string, string> = new Map(),
): PresentationSourceOption[] {
	const labelBySource = new Map<string, string>()
	for (const item of availableFeatures) {
		const bareAddress = item.address.replace(/^nostr:/u, '').split('#', 1)[0]
		if (!bareAddress) continue
		const source = parseMapPresentationSource(naddrToCoordinate(bareAddress))?.coordinate
		if (!source) continue
		const label =
			item.datasetName?.trim() || (item.entityType === 'dataset' ? item.name.trim() : '')
		if (label && (!labelBySource.has(source) || item.entityType === 'dataset')) {
			labelBySource.set(source, label)
		}
	}

	const seen = new Set<string>()
	return acceptedSources.flatMap((source) => {
		const key = mapPresentationSourceKey(source)
		if (seen.has(key)) return []
		seen.add(key)
		const parsed = parseMapPresentationSource(source)
		return [
			{
				source,
				label:
					localLabels.get(key) ??
					labelBySource.get(key) ??
					parsed?.identifier ??
					(typeof source === 'string' ? source : `Local Map ${source.workspaceId}`),
			},
		]
	})
}

/** Draft previews can use account-local Maps; public serialization remains a separate gate. */
export function normalizeAtlasPresentationForDraft(
	raw: unknown,
	acceptedReferences: readonly string[],
): unknown {
	const parsed = parseMapPresentation(raw)
	if (parsed.status !== 'valid') return raw
	if (parsed.issues.length > 0)
		throw new Error('The Atlas default view contains invalid presentation fields.')
	const presentation = getUsableMapPresentation(parsed)
	if (!presentation) throw new Error('The Atlas default view has an invalid layer list.')
	const authorization = deriveAtlasPresentationAuthorization(acceptedReferences, {
		allowLocalDraftReferences: true,
	})
	for (const layer of presentation.layers) {
		if (authorizePresentationLayer(layer, authorization).status !== 'authorized')
			throw new Error(`Layer “${layer.id}” must reference a Map accepted by this Atlas.`)
	}
	return presentation
}
