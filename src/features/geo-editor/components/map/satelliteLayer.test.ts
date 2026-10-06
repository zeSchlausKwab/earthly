import { describe, expect, it } from 'bun:test'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { DEFAULT_SATELLITE_SETTINGS, EOX_SATELLITE_TILES } from '@/lib/satellite'
import { SATELLITE_LAYER_ID, SATELLITE_SOURCE_ID, SatelliteLayerController } from './satelliteLayer'

function fixture() {
	const style: StyleSpecification = {
		version: 8,
		sources: {
			openmaptiles: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
			authored: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
		},
		layers: [
			{ id: 'background', type: 'background' },
			{ id: 'land', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover' },
			{ id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
			{ id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
			{ id: 'label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
			{ id: 'authored', type: 'circle', source: 'authored', paint: { 'circle-opacity': 0.4 } },
		],
	}
	let moves = 0
	const map = {
		getStyle: () => ({ ...style, layers: [...style.layers] }),
		getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
		getSource: (id: string) => style.sources[id],
		addSource: (id: string, source: StyleSpecification['sources'][string]) => {
			style.sources[id] = source
		},
		addLayer: (layer: StyleSpecification['layers'][number], before?: string) => {
			const index = style.layers.findIndex((existing) => existing.id === before)
			style.layers.splice(index < 0 ? style.layers.length : index, 0, layer)
		},
		removeLayer: (id: string) => {
			style.layers = style.layers.filter((layer) => layer.id !== id)
		},
		removeSource: (id: string) => {
			delete style.sources[id]
		},
		moveLayer: (id: string, before?: string) => {
			moves++
			const layer = style.layers.find((existing) => existing.id === id)
			if (!layer) throw new Error(`Missing layer ${id}`)
			map.removeLayer(id)
			map.addLayer(layer, before)
		},
		setPaintProperty: (id: string, property: string, value: number) => {
			const layer = style.layers.find((existing) => existing.id === id)
			if (layer?.type === 'raster' && property === 'raster-opacity') {
				layer.paint = { ...layer.paint, 'raster-opacity': value }
			}
		},
	}
	return {
		style,
		controller: new SatelliteLayerController(map as unknown as MapLibreMap),
		ids: () => style.layers.map((layer) => layer.id),
		moves: () => moves,
	}
}

const enabled = { ...DEFAULT_SATELLITE_SETTINGS, enabled: true }

describe('satellite composition', () => {
	it('creates no tile source until imagery is enabled', () => {
		const { controller, style } = fixture()
		controller.apply(DEFAULT_SATELLITE_SETTINGS)
		expect(style.sources[SATELLITE_SOURCE_ID]).toBeUndefined()
		controller.apply(enabled)
		expect(style.sources[SATELLITE_SOURCE_ID]).toMatchObject({
			type: 'raster',
			tiles: [EOX_SATELLITE_TILES],
			maxzoom: 14,
		})
		const source = style.sources[SATELLITE_SOURCE_ID]
		if (source?.type === 'raster') expect(source.attribution).toContain('CC BY 4.0')
	})

	it('keeps imagery above every fill, OSM roads above imagery, and authored features above both', () => {
		const { controller, ids, style, moves } = fixture()
		controller.apply(enabled)
		expect(ids()).toEqual([
			'background',
			'land',
			'building',
			SATELLITE_LAYER_ID,
			'road',
			'label',
			'authored',
		])
		const moveCount = moves()
		controller.apply({ ...enabled, opacity: 0.5 })
		expect(moves()).toBe(moveCount)
		expect(style.layers.find((layer) => layer.id === SATELLITE_LAYER_ID)?.paint).toMatchObject({
			'raster-opacity': 0.5,
		})
		expect(style.layers.find((layer) => layer.id === 'authored')?.paint).toEqual({
			'circle-opacity': 0.4,
		})
		controller.apply({ ...enabled, osmOverlay: false })
		expect(ids()).toEqual([
			'background',
			'land',
			'road',
			'building',
			'label',
			SATELLITE_LAYER_ID,
			'authored',
		])
	})

	it('restores the exact basemap order and removes the tile source when disabled or fully faded', () => {
		for (const settings of [DEFAULT_SATELLITE_SETTINGS, { ...enabled, opacity: 0 }]) {
			const { controller, ids, style } = fixture()
			const original = ids()
			controller.apply(enabled)
			controller.apply(settings)
			expect(ids()).toEqual(original)
			expect(style.sources[SATELLITE_SOURCE_ID]).toBeUndefined()
		}
	})

	it('recreates imagery after a style swap without restoring the previous style order', () => {
		const { controller, ids, style } = fixture()
		controller.apply(enabled)
		style.layers = [{ id: 'new-background', type: 'background' }]
		style.sources = {}
		controller.reset()
		controller.apply(enabled)
		expect(ids()).toEqual(['new-background', SATELLITE_LAYER_ID])
		controller.remove()
		expect(ids()).toEqual(['new-background'])
	})
})
