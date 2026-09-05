import { normalizeMapPresentation, parseStoryViewBlock } from './codec'
import type {
	EffectiveStoryViewStateV1,
	MapPresentationIssue,
	MapPresentationLayerV1,
	MapPresentationStyleOverrideV1,
	MapPresentationV1,
	StoryViewReductionResultV1,
	StoryViewSnapshotV1,
} from './types'

function cloneLayer(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	return Object.freeze({
		id: layer.id,
		source: layer.source,
		...(layer.featureIds !== undefined ? { featureIds: Object.freeze([...layer.featureIds]) } : {}),
		visible: layer.visible,
		opacityMultiplier: layer.opacityMultiplier,
		...(layer.style ? { style: Object.freeze({ ...layer.style }) } : {}),
	})
}

function snapshotState(
	presentation: MapPresentationV1,
	layers: readonly MapPresentationLayerV1[],
	camera = presentation.initialView,
): EffectiveStoryViewStateV1 {
	return Object.freeze({
		...(camera ? { camera } : {}),
		layers: Object.freeze(layers.map(cloneLayer)),
	})
}

function prefixIssuePath(issue: MapPresentationIssue, blockIndex: number): MapPresentationIssue {
	const suffix = issue.path === '$' ? '' : issue.path.slice(1)
	return Object.freeze({ ...issue, path: `$[${blockIndex}]${suffix}` })
}

/**
 * Apply driving Story views cumulatively in document order. Figure-only views
 * get a snapshot of their own delta but do not change the next driving view.
 * Unknown layer ids
 * are ignored, which prevents a view block from mutating route-local ambient
 * overlays that are not part of the Story's own presentation.
 */
export function reduceStoryViewBlocks(
	presentationValue: MapPresentationV1,
	blocks: readonly unknown[],
): StoryViewReductionResultV1 {
	const presentation = normalizeMapPresentation(presentationValue)
	let camera = presentation.initialView
	let layers = presentation.layers.map(cloneLayer)
	const initialState = snapshotState(presentation, layers, camera)
	const snapshots: StoryViewSnapshotV1[] = []
	const issues: MapPresentationIssue[] = []

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const parsed = parseStoryViewBlock(blocks[blockIndex])
		issues.push(...parsed.issues.map((entry) => prefixIssuePath(entry, blockIndex)))
		if (parsed.status !== 'valid') continue

		const nextCamera = parsed.value.camera ?? camera
		const nextLayers = layers.map(cloneLayer)
		if (parsed.value.layers) {
			const indexes = new Map(nextLayers.map((layer, index) => [layer.id, index]))
			for (const [layerId, patch] of Object.entries(parsed.value.layers)) {
				const index = indexes.get(layerId)
				if (index === undefined) {
					issues.push(
						Object.freeze({
							code: 'unknown-layer-id',
							path: `$[${blockIndex}].layers.${layerId}`,
							message: `Story view references unknown local layer id '${layerId}'.`,
						}),
					)
					continue
				}
				const previous = nextLayers[index]
				if (!previous) continue
				let style: MapPresentationStyleOverrideV1 | undefined = previous.style
				if (patch.style) style = Object.freeze({ ...previous.style, ...patch.style })
				nextLayers[index] = Object.freeze({
					...previous,
					visible: patch.visible ?? previous.visible,
					opacityMultiplier: patch.opacityMultiplier ?? previous.opacityMultiplier,
					...(style ? { style } : {}),
				})
			}
		}

		snapshots.push(
			Object.freeze({
				view: parsed.value,
				state: snapshotState(presentation, nextLayers, nextCamera),
			}),
		)
		if (parsed.value.display !== 'figure') {
			camera = nextCamera
			layers = nextLayers
		}
	}

	return Object.freeze({
		initialState,
		snapshots: Object.freeze(snapshots),
		issues: Object.freeze(issues),
	})
}
