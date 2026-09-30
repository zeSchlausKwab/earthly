import { describe, expect, test } from 'bun:test'
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { MapletInstanceView } from './MapletsPanel'
import { mapletRenderCollection, reconcileMapletLayers } from './useMapletLayers'

const layer: MapletInstanceView = {
	id: 'instance',
	definitionId: 'demo',
	title: 'Demo',
	status: 'ready',
	visible: true,
	warnings: [],
	config: {},
	collection: {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'source-id',
				properties: {
					earthlyMapletInstanceId: 'forged-instance',
					earthlyMapletFeatureId: 'forged-id',
					earthlyMapletTitle: 'forged-title',
				},
				geometry: { type: 'Point', coordinates: [44, 15] },
			},
		],
	},
}

function mapHarness() {
	const layers = new Map<string, LayerSpecification>()
	const data = new Map<string, unknown>()
	const removals: string[] = []
	const map = {
		getStyle: () => ({ version: 8, layers: [...layers.values()] }),
		getSource: (id: string) =>
			data.has(id)
				? ({ setData: (value: unknown) => data.set(id, value) } as unknown as GeoJSONSource)
				: undefined,
		addSource: (id: string, value: { data: unknown }) => data.set(id, value.data),
		removeSource: (id: string) => {
			removals.push(id)
			data.delete(id)
		},
		getLayer: (id: string) => layers.get(id),
		addLayer: (layer: LayerSpecification) => layers.set(layer.id, layer),
		removeLayer: (id: string) => {
			removals.push(id)
			layers.delete(id)
		},
		setLayoutProperty: (id: string, key: string, value: unknown) => {
			const layer = layers.get(id)
			if (!layer) throw new Error('Missing test layer')
			layers.set(id, { ...layer, layout: { ...layer.layout, [key]: value } } as LayerSpecification)
		},
		moveLayer: () => {},
	} as unknown as MapLibreMap
	return { map, layers, data, removals }
}

describe('Maplet map sources', () => {
	test('configurations sharing source geometry remain independent when hidden or removed', () => {
		const { map, layers, data } = mapHarness()
		const sibling = { ...layer, id: 'sibling', title: 'Another view' }
		let registry = reconcileMapletLayers(map, [layer, sibling], new Set())
		registry = reconcileMapletLayers(map, [{ ...layer, visible: false }, sibling], registry)
		expect(layers.get('maplet:instance:point')?.layout?.visibility).toBe('none')
		expect(layers.get('maplet:sibling:point')?.layout?.visibility).toBe('visible')
		reconcileMapletLayers(map, [sibling], registry)
		expect(data.has('maplet:instance')).toBe(false)
		expect(data.has('maplet:sibling')).toBe(true)
		expect(layers.size).toBe(3)
		expect(
			(data.get('maplet:sibling') as GeoJSON.FeatureCollection).features[0]?.properties,
		).toMatchObject({ earthlyMapletInstanceId: 'sibling', earthlyMapletFeatureId: 'source-id' })
	})
	test('host provenance wins over foreign render identity without changing the source', () => {
		const result = mapletRenderCollection(layer)
		expect(result.features[0]?.properties).toMatchObject({
			earthlyMapletInstanceId: 'instance',
			earthlyMapletFeatureId: 'source-id',
			earthlyMapletTitle: 'Demo',
		})
		expect(layer.collection.features[0]?.properties?.earthlyMapletInstanceId).toBe(
			'forged-instance',
		)
	})
	test('refresh replaces source data, visibility affects every geometry, style reload recovers, removal cleans layers before sources', () => {
		const { map, layers, data, removals } = mapHarness()
		let registry = reconcileMapletLayers(map, [layer], new Set())
		expect(layers.size).toBe(3)
		registry = reconcileMapletLayers(
			map,
			[{ ...layer, visible: false, collection: { type: 'FeatureCollection', features: [] } }],
			registry,
		)
		expect(data.get('maplet:instance')).toEqual({ type: 'FeatureCollection', features: [] })
		for (const layer of layers.values()) expect(layer.layout?.visibility).toBe('none')
		layers.clear()
		data.clear()
		registry = reconcileMapletLayers(map, [layer], registry)
		expect(layers.size).toBe(3)
		reconcileMapletLayers(map, [], registry)
		expect(removals).toEqual([
			'maplet:instance:point',
			'maplet:instance:line',
			'maplet:instance:fill',
			'maplet:instance',
		])
		expect(data.size).toBe(0)
	})
})
