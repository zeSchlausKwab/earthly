import type { GeoFeatureItem } from '@/components/editor'
import { parseMapPresentationSource, type MapPresentationSource } from '@/lib/map-presentation'
import type { PresentationSourceOption } from '@/lib/map-presentation/authoring'
import { naddrToCoordinate } from '@/lib/nostr/references'

/** Keep the owner's accepted-source order while offering each Map once. */
export function atlasPresentationSourceOptions(
	acceptedSources: readonly MapPresentationSource[],
	availableFeatures: readonly GeoFeatureItem[],
): PresentationSourceOption[] {
	const labelBySource = new Map<MapPresentationSource, string>()
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

	const seen = new Set<MapPresentationSource>()
	return acceptedSources.flatMap((source) => {
		if (seen.has(source)) return []
		seen.add(source)
		const parsed = parseMapPresentationSource(source)
		return [
			{
				source,
				label: labelBySource.get(source) ?? parsed?.identifier ?? source,
			},
		]
	})
}
