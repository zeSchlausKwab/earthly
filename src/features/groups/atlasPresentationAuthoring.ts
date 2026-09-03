import type { GeoFeatureItem } from '@/components/editor'
import {
	MAP_PRESENTATION_LIMITS,
	parseMapPresentationSource,
	type MapPresentationLayerV1,
	type MapPresentationSource,
	type MapPresentationStyleOverrideV1,
	type MapPresentationV1,
} from '@/lib/map-presentation'
import { naddrToCoordinate } from '@/lib/nostr/references'

export interface AtlasPresentationSourceOption {
	source: MapPresentationSource
	label: string
}

/** Keep the owner's accepted-source order while offering each Map once. */
export function atlasPresentationSourceOptions(
	acceptedSources: readonly MapPresentationSource[],
	availableFeatures: readonly GeoFeatureItem[],
): AtlasPresentationSourceOption[] {
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

export function emptyAtlasPresentation(): MapPresentationV1 {
	return { version: 1, layers: [] }
}

export function stableAtlasLayerId(
	source: MapPresentationSource,
	usedIds: ReadonlySet<string>,
): string {
	const parsed = parseMapPresentationSource(source)
	const stem =
		(parsed?.identifier ?? 'map')
			.toLowerCase()
			.replace(/[^a-z0-9._:-]+/gu, '-')
			.replace(/^[^a-z0-9]+/u, '')
			.slice(0, MAP_PRESENTATION_LIMITS.layerIdLength) || 'map'
	let candidate = stem
	let suffix = 2
	while (usedIds.has(candidate)) {
		const suffixText = `-${suffix}`
		candidate = `${stem.slice(0, MAP_PRESENTATION_LIMITS.layerIdLength - suffixText.length)}${suffixText}`
		suffix += 1
	}
	return candidate
}

export function addAtlasPresentationLayer(
	presentation: MapPresentationV1,
	source: MapPresentationSource,
): MapPresentationV1 {
	const usedIds = new Set(presentation.layers.map((layer) => layer.id))
	return {
		...presentation,
		layers: [
			...presentation.layers,
			{
				id: stableAtlasLayerId(source, usedIds),
				source,
				visible: true,
				opacityMultiplier: 1,
			},
		],
	}
}

export function updateAtlasPresentationLayer(
	presentation: MapPresentationV1,
	index: number,
	layer: MapPresentationLayerV1,
): MapPresentationV1 {
	return {
		...presentation,
		layers: presentation.layers.map((entry, layerIndex) => (layerIndex === index ? layer : entry)),
	}
}

export function removeAtlasPresentationLayer(
	presentation: MapPresentationV1,
	index: number,
): MapPresentationV1 {
	return {
		...presentation,
		layers: presentation.layers.filter((_, layerIndex) => layerIndex !== index),
	}
}

export function moveAtlasPresentationLayer(
	presentation: MapPresentationV1,
	fromIndex: number,
	toIndex: number,
): MapPresentationV1 {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= presentation.layers.length ||
		toIndex >= presentation.layers.length
	) {
		return presentation
	}
	const layers = [...presentation.layers]
	const [layer] = layers.splice(fromIndex, 1)
	if (!layer) return presentation
	layers.splice(toIndex, 0, layer)
	return { ...presentation, layers }
}

export function withoutAtlasInitialView(presentation: MapPresentationV1): MapPresentationV1 {
	const { initialView: _initialView, ...rest } = presentation
	return rest
}

export function withoutAtlasLayerFeatureIds(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { featureIds: _featureIds, ...rest } = layer
	return rest
}

export function withoutAtlasLayerStyle(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { style: _style, ...rest } = layer
	return rest
}

export function updateAtlasLayerStyle(
	layer: MapPresentationLayerV1,
	key: keyof MapPresentationStyleOverrideV1,
	value: string | number | boolean | undefined,
): MapPresentationLayerV1 {
	const style: Record<string, unknown> = { ...layer.style }
	if (value === undefined || value === '') delete style[key]
	else style[key] = value
	return Object.keys(style).length > 0
		? { ...layer, style: style as MapPresentationStyleOverrideV1 }
		: withoutAtlasLayerStyle(layer)
}

export function parseAtlasFeatureIds(value: string): string[] {
	const seen = new Set<string>()
	return value.split(/[\n,]/u).flatMap((candidate) => {
		const featureId = candidate.trim()
		if (!featureId || seen.has(featureId)) return []
		seen.add(featureId)
		return [featureId]
	})
}
