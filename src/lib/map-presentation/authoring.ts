import { getUsableMapPresentation, type MapPresentationAuthorization } from './authorization'
import { MAP_PRESENTATION_LIMITS, parseMapPresentation, parseMapPresentationSource } from './codec'
import type {
	MapPresentationLayerV1,
	MapPresentationSource,
	MapPresentationStyleOverrideV1,
	MapPresentationV1,
} from './types'

export interface PresentationSourceOption {
	source: MapPresentationSource
	label: string
}

export function emptyPresentation(): MapPresentationV1 {
	return { version: 1, layers: [] }
}

export function stableLayerId(source: MapPresentationSource, usedIds: ReadonlySet<string>): string {
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

export function addPresentationLayer(
	presentation: MapPresentationV1,
	source: MapPresentationSource,
	authorization: MapPresentationAuthorization,
): MapPresentationV1 {
	const grant = authorization.get(source)
	if (!grant) return presentation
	const usedIds = new Set(presentation.layers.map((layer) => layer.id))
	return {
		...presentation,
		layers: [
			...presentation.layers,
			{
				id: stableLayerId(source, usedIds),
				source,
				...(grant.scope === 'features' ? { featureIds: [...grant.featureIds] } : {}),
				visible: true,
				opacityMultiplier: 1,
			},
		],
	}
}

export function updatePresentationLayer(
	presentation: MapPresentationV1,
	index: number,
	layer: MapPresentationLayerV1,
): MapPresentationV1 {
	return {
		...presentation,
		layers: presentation.layers.map((entry, layerIndex) => (layerIndex === index ? layer : entry)),
	}
}

export function removePresentationLayer(
	presentation: MapPresentationV1,
	index: number,
): MapPresentationV1 {
	return {
		...presentation,
		layers: presentation.layers.filter((_, layerIndex) => layerIndex !== index),
	}
}

export function movePresentationLayer(
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

export function withoutInitialView(presentation: MapPresentationV1): MapPresentationV1 {
	const { initialView: _initialView, ...rest } = presentation
	return rest
}

export function withoutLayerFeatureIds(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { featureIds: _featureIds, ...rest } = layer
	return rest
}

export function withoutLayerStyle(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { style: _style, ...rest } = layer
	return rest
}

export function updateLayerStyle<Key extends keyof MapPresentationStyleOverrideV1>(
	layer: MapPresentationLayerV1,
	key: Key,
	value: MapPresentationStyleOverrideV1[Key],
): MapPresentationLayerV1 {
	const style = { ...layer.style }
	if (value === undefined || value === '') delete style[key]
	else style[key] = value
	return Object.keys(style).length > 0 ? { ...layer, style } : withoutLayerStyle(layer)
}

export function parseFeatureIds(value: string): string[] {
	const seen = new Set<string>()
	return value.split(/[\n,]/u).flatMap((candidate) => {
		const featureId = candidate.trim()
		if (!featureId || seen.has(featureId)) return []
		seen.add(featureId)
		return [featureId]
	})
}

/** Camera-only capture keeps the authored layer instances and their settings intact. */
export function applyPresentationCapture(
	presentation: MapPresentationV1 | null,
	captured: unknown,
	mode: 'all' | 'camera',
	invalidCaptureMessage: string,
): MapPresentationV1 {
	const parsed = parseMapPresentation(captured)
	const usable = getUsableMapPresentation(parsed)
	if (!usable || (parsed.status === 'valid' && parsed.issues.length > 0)) {
		throw new Error(invalidCaptureMessage)
	}
	if (mode === 'all') return usable
	if (!usable.initialView) throw new Error('The map did not provide a camera position.')
	return { ...(presentation ?? emptyPresentation()), initialView: usable.initialView }
}
