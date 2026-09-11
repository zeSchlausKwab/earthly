import { describe, expect, test } from 'bun:test'
import type { Feature, Geometry } from 'geojson'
import {
	materializePresentationLayers,
	type PresentationLayerMaterializationInput,
} from '@/features/geo-editor/map-presentation/materialize'
import {
	collectPresentationCanvasGeometryChoices,
	presentationFitCollection,
} from './PresentationCanvas'

const source = `37515:${'11'.repeat(32)}:map` as const

function layer(id: string, visible: boolean): PresentationLayerMaterializationInput {
	return {
		carrierId: 'story',
		layer: { id, source, visible, opacityMultiplier: 1 },
		featureCollection: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id,
					properties: {},
					geometry: { type: 'Point', coordinates: [1, 2] },
				},
			],
		},
	}
}

describe('Reader presentation fit', () => {
	test('fits only layers visible in the effective view', () => {
		expect(
			presentationFitCollection([layer('shown', true), layer('hidden', false)]).features,
		).toHaveLength(1)
		expect(
			presentationFitCollection([layer('shown', true), layer('hidden', false)]).features[0]?.id,
		).toEqual(expect.stringContaining(':feature:shown:0'))
	})

	test('reapplies feature selectors and never widens empty or stale selections', () => {
		const input: PresentationLayerMaterializationInput = {
			...layer('selective', true),
			layer: {
				id: 'selective',
				source,
				visible: true,
				opacityMultiplier: 1,
				featureIds: ['keep', 'missing'],
			},
			featureCollection: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						id: 'keep',
						properties: {},
						geometry: { type: 'Point', coordinates: [1, 2] },
					},
					{
						type: 'Feature',
						id: 'not-selected',
						properties: {},
						geometry: { type: 'Point', coordinates: [20, 30] },
					},
				],
			},
		}
		expect(presentationFitCollection([input]).features.map((feature) => feature.id)).toEqual([
			expect.stringContaining(':feature:keep:0'),
		])
		expect(
			presentationFitCollection([{ ...input, layer: { ...input.layer, featureIds: [] } }]).features,
		).toEqual([])
		expect(
			presentationFitCollection([{ ...input, layer: { ...input.layer, featureIds: ['missing'] } }])
				.features,
		).toEqual([])
	})
})

describe('Reader presentation geometry choices', () => {
	test('deduplicates visual sublayers but keeps duplicate authored instances', () => {
		const collection = {
			type: 'FeatureCollection' as const,
			features: [
				{
					type: 'Feature' as const,
					id: 'shared',
					properties: { name: 'Shared feature' },
					geometry: { type: 'Point' as const, coordinates: [1, 2] },
				},
			],
		}
		const inputs: PresentationLayerMaterializationInput[] = [
			{
				carrierId: 'story',
				layer: { id: 'first', source, visible: true, opacityMultiplier: 1 },
				featureCollection: collection,
				sourceEvent: { id: 'event', pubkey: '11'.repeat(32), datasetId: 'map' },
			},
			{
				carrierId: 'story',
				layer: { id: 'second', source, visible: true, opacityMultiplier: 0.5 },
				featureCollection: collection,
				sourceEvent: { id: 'event', pubkey: '11'.repeat(32), datasetId: 'map' },
			},
		]
		const materialized = materializePresentationLayers(inputs)
		const first = materialized[0]?.featureCollection.features[0]
		const second = materialized[1]?.featureCollection.features[0]
		if (!first || !second) throw new Error('Expected materialized Reader features')
		const rendered = [first, first, second, second] as Feature<Geometry>[]
		const choices = collectPresentationCanvasGeometryChoices(rendered, inputs)

		expect(choices).toHaveLength(2)
		expect(choices.map((choice) => choice.provenance.layerId)).toEqual(['first', 'second'])
		expect(new Set(choices.map((choice) => choice.id)).size).toBe(2)
	})
})
