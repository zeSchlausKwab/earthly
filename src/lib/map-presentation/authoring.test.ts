import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import {
	authorizePresentationLayer,
	deriveAtlasPresentationAuthorization,
	deriveStoryPresentationAuthorization,
} from './authorization'
import {
	addPresentationLayer,
	applyPresentationCapture,
	emptyPresentation,
	movePresentationLayer,
	parseFeatureIds,
	removePresentationLayer,
	updateLayerStyle,
	updatePresentationLayer,
	withoutInitialView,
	withoutLayerFeatureIds,
} from './authoring'
import { MAP_PRESENTATION_LIMITS, parseMapPresentation } from './codec'
import type { MapPresentationLayerV1, MapPresentationV1 } from './types'

const PUBKEY = 'a'.repeat(64)
const SOURCE = `37515:${PUBKEY}:western-front` as const
const UNACCEPTED_SOURCE = `37515:${PUBKEY}:unaccepted` as const
const ADDRESS = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'western-front' })
const AUTHORIZATION = deriveAtlasPresentationAuthorization([SOURCE])
const LAYER: MapPresentationLayerV1 = {
	id: 'route',
	source: SOURCE,
	visible: true,
	opacityMultiplier: 0.5,
	featureIds: ['battle-a'],
	style: { color: '#d97706', strokeWidth: 3 },
}
const PRESENTATION: MapPresentationV1 = {
	version: 1,
	layers: [LAYER],
	initialView: { center: [7.5, 50.4], zoom: 7 },
}

describe('shared presentation authoring', () => {
	test('adds repeatable render instances with stable unique ids', () => {
		const once = addPresentationLayer(emptyPresentation(), SOURCE, AUTHORIZATION)
		const twice = addPresentationLayer(once, SOURCE, AUTHORIZATION)
		expect(twice.layers.map((layer) => layer.id)).toEqual(['western-front', 'western-front-2'])
		expect(twice.layers.every((layer) => layer.source === SOURCE)).toBe(true)
		expect(twice.layers.every((layer) => layer.visible && layer.opacityMultiplier === 1)).toBe(true)
		expect(once.layers).toHaveLength(1)
	})

	test('keeps suffixed ids valid for Maps whose identifiers reach the id limit', () => {
		const source = `37515:${PUBKEY}:${'m'.repeat(MAP_PRESENTATION_LIMITS.layerIdLength)}` as const
		const authorization = deriveAtlasPresentationAuthorization([source])
		const once = addPresentationLayer(emptyPresentation(), source, authorization)
		const twice = addPresentationLayer(once, source, authorization)
		const parsed = parseMapPresentation(twice)
		expect(new Set(twice.layers.map((layer) => layer.id)).size).toBe(2)
		expect(
			twice.layers.every((layer) => layer.id.length <= MAP_PRESENTATION_LIMITS.layerIdLength),
		).toBe(true)
		expect(parsed.issues).toEqual([])
	})

	test('initializes Story layers only with cited features, but allows whole Maps for Atlas grants', () => {
		const authorization = deriveStoryPresentationAuthorization(`nostr:${ADDRESS}#battle-a`)
		const story = addPresentationLayer(emptyPresentation(), SOURCE, authorization)
		const atlas = addPresentationLayer(emptyPresentation(), SOURCE, AUTHORIZATION)
		expect(story.layers[0]?.featureIds).toEqual(['battle-a'])
		expect(atlas.layers[0]?.featureIds).toBeUndefined()
		for (const layer of story.layers) {
			expect(authorizePresentationLayer(layer, authorization).status).toBe('authorized')
		}
	})

	test('does not add sources outside the current authorization or after their reference is removed', () => {
		const empty = emptyPresentation()
		expect(addPresentationLayer(empty, UNACCEPTED_SOURCE, AUTHORIZATION)).toBe(empty)
		expect(addPresentationLayer(empty, SOURCE, deriveStoryPresentationAuthorization(''))).toBe(
			empty,
		)
	})

	test('reorders, edits and removes instances without mutating authored layers or camera', () => {
		const presentation = addPresentationLayer(PRESENTATION, SOURCE, AUTHORIZATION)
		const moved = movePresentationLayer(presentation, 1, 0)
		const updated = updatePresentationLayer(moved, 1, {
			...LAYER,
			visible: false,
			opacityMultiplier: 0.2,
		})
		const removed = removePresentationLayer(updated, 0)
		expect(presentation.layers.map((layer) => layer.id)).toEqual(['route', 'western-front'])
		expect(moved.layers.map((layer) => layer.id)).toEqual(['western-front', 'route'])
		expect(removed.layers).toEqual([{ ...LAYER, visible: false, opacityMultiplier: 0.2 }])
		expect(removed.initialView).toBe(PRESENTATION.initialView)
		expect(LAYER.visible).toBe(true)
		expect(movePresentationLayer(presentation, 0, -1)).toBe(presentation)
		expect(movePresentationLayer(presentation, 1, 2)).toBe(presentation)
	})

	test('removes empty selectors and style overrides but preserves explicit zero and false', () => {
		const withoutColor = updateLayerStyle(LAYER, 'color', undefined)
		const withoutStyle = updateLayerStyle(withoutColor, 'strokeWidth', undefined)
		expect(withoutColor.style).toEqual({ strokeWidth: 3 })
		expect(withoutStyle.style).toBeUndefined()
		expect(updateLayerStyle(withoutStyle, 'fillOpacity', 0).style).toEqual({ fillOpacity: 0 })
		expect(updateLayerStyle(withoutStyle, 'arrowEnd', false).style).toEqual({ arrowEnd: false })
		expect(withoutLayerFeatureIds(LAYER).featureIds).toBeUndefined()
		expect(withoutInitialView(PRESENTATION).initialView).toBeUndefined()
		expect(PRESENTATION.initialView).toEqual({ center: [7.5, 50.4], zoom: 7 })
	})

	test('deduplicates feature selectors in their entered order', () => {
		expect(parseFeatureIds(' battle-a, battle-b\nbattle-a ,, ')).toEqual(['battle-a', 'battle-b'])
	})

	test('camera capture preserves authored layer settings while full capture replaces them', () => {
		const captured: MapPresentationV1 = {
			version: 1,
			initialView: { center: [8, 49], zoom: 9, bearing: 30, pitch: 40 },
			layers: [],
		}
		const cameraOnly = applyPresentationCapture(PRESENTATION, captured, 'camera', 'Invalid capture')
		expect(cameraOnly.layers).toBe(PRESENTATION.layers)
		expect(cameraOnly.initialView).toEqual(captured.initialView)
		expect(applyPresentationCapture(PRESENTATION, captured, 'all', 'Invalid capture')).toEqual(
			captured,
		)
		expect(PRESENTATION.initialView).toEqual({ center: [7.5, 50.4], zoom: 7 })
	})

	test('rejects incomplete, malformed or future captures without dropping authored content', () => {
		for (const captured of [
			undefined,
			{ version: 2, layers: [] },
			{ version: 1, layers: [null] },
		]) {
			expect(() =>
				applyPresentationCapture(PRESENTATION, captured, 'all', 'Invalid capture'),
			).toThrow('Invalid capture')
		}
		expect(() =>
			applyPresentationCapture(PRESENTATION, emptyPresentation(), 'camera', 'Invalid capture'),
		).toThrow('The map did not provide a camera position.')
		expect(PRESENTATION.layers).toEqual([LAYER])
	})
})
