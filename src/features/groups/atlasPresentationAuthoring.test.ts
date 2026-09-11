import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { GeoFeatureItem } from '@/components/editor'
import type { MapPresentationV1 } from '@/lib/map-presentation'
import {
	addAtlasPresentationLayer,
	atlasPresentationSourceOptions,
	moveAtlasPresentationLayer,
	parseAtlasFeatureIds,
	updateAtlasLayerStyle,
	withoutAtlasInitialView,
	withoutAtlasLayerFeatureIds,
} from './atlasPresentationAuthoring'

const PUBKEY = 'a'.repeat(64)
const SOURCE = `37515:${PUBKEY}:western-front` as const

describe('Atlas presentation authoring', () => {
	test('adds repeatable render instances with stable unique ids', () => {
		const once = addAtlasPresentationLayer({ version: 1, layers: [] }, SOURCE)
		const twice = addAtlasPresentationLayer(once, SOURCE)

		expect(twice.layers.map((layer) => layer.id)).toEqual(['western-front', 'western-front-2'])
		expect(twice.layers.every((layer) => layer.source === SOURCE)).toBe(true)
		expect(twice.layers.every((layer) => layer.visible && layer.opacityMultiplier === 1)).toBe(true)
	})

	test('reorders layers without mutating the captured presentation', () => {
		const presentation: MapPresentationV1 = {
			version: 1,
			layers: [
				{ id: 'bottom', source: SOURCE, visible: true, opacityMultiplier: 1 },
				{ id: 'top', source: SOURCE, visible: true, opacityMultiplier: 0.5 },
			],
		}
		const moved = moveAtlasPresentationLayer(presentation, 1, 0)

		expect(moved.layers.map((layer) => layer.id)).toEqual(['top', 'bottom'])
		expect(presentation.layers.map((layer) => layer.id)).toEqual(['bottom', 'top'])
	})

	test('removes empty selectors and style overrides instead of writing ambiguous values', () => {
		const layer = {
			id: 'route',
			source: SOURCE,
			visible: true,
			opacityMultiplier: 1,
			featureIds: ['battle-a'],
			style: { color: '#d97706', strokeWidth: 3 },
		} as const

		const withoutColor = updateAtlasLayerStyle(layer, 'color', undefined)
		const withoutStyle = updateAtlasLayerStyle(withoutColor, 'strokeWidth', undefined)
		expect(withoutColor.style).toEqual({ strokeWidth: 3 })
		expect(withoutStyle.style).toBeUndefined()
		expect(withoutAtlasLayerFeatureIds(layer).featureIds).toBeUndefined()
		expect(
			withoutAtlasInitialView({
				version: 1,
				layers: [layer],
				initialView: { center: [7.5, 50.4], zoom: 7 },
			}).initialView,
		).toBeUndefined()
	})

	test('deduplicates feature ids and labels accepted sources from available Maps', () => {
		const address = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'western-front' })
		const available: GeoFeatureItem[] = [
			{
				id: 'map',
				name: 'Western Front',
				address,
				entityType: 'dataset',
				datasetName: 'Western Front',
			},
		]

		expect(parseAtlasFeatureIds(' battle-a, battle-b\nbattle-a ,, ')).toEqual([
			'battle-a',
			'battle-b',
		])
		expect(atlasPresentationSourceOptions([SOURCE, SOURCE], available)).toEqual([
			{ source: SOURCE, label: 'Western Front' },
		])
	})
})
