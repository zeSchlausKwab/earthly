import { describe, expect, test } from 'bun:test'
import type { FeatureCollection, Point } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type * as maplibregl from 'maplibre-gl'
import type { MapPresentationLayerV1 } from '@/lib/map-presentation'
import {
	EMPTY_PRESENTATION_MAP_LAYER_REGISTRY,
	reconcilePresentationMapLayers,
} from '../hooks/usePresentationMapLayers'
import {
	applyPresentationCameraIntent,
	type PresentationCameraMap,
} from '../hooks/usePresentationCamera'
import {
	PRESENTATION_LAYER_ROLE_ORDER,
	PRESENTATION_PROPERTY_KEYS,
	presentationFeatureRenderId,
	presentationGeometryChoiceId,
	presentationInstanceId,
	readPresentationFeatureProvenance,
} from './ids'
import { buildPresentationLayerBundle, presentationLayerBundleIds } from './layerSpecs'
import {
	materializePresentationLayer,
	materializePresentationLayerForViewport,
	materializePresentationLayers,
} from './materialize'

const PUBKEY = 'a'.repeat(64)
const SOURCE = `37515:${PUBKEY}:western-front` as const

function layer(
	id: string,
	overrides: Partial<MapPresentationLayerV1> = {},
): MapPresentationLayerV1 {
	return {
		id,
		source: SOURCE,
		visible: true,
		opacityMultiplier: 1,
		...overrides,
	}
}

const collection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'front',
			geometry: {
				type: 'LineString',
				coordinates: [
					[1, 2],
					[3, 4],
				],
			},
			properties: {
				name: 'Author name',
				strokeColor: '#111111',
				strokeOpacity: 0.5,
				earthlyPresentationCarrierId: 'spoofed',
			},
		},
		{
			type: 'Feature',
			id: 'battle',
			geometry: { type: 'Point', coordinates: [5, 6] },
			properties: { color: '#222222' },
		},
	],
}
const frontFeature = collection.features[0]
if (!frontFeature) throw new Error('Renderer test fixture requires a front feature.')

describe('presentation feature materialization', () => {
	test('selects without widening, overlays style immutably, and stamps trusted provenance', () => {
		const original = structuredClone(collection)
		const materialized = materializePresentationLayer({
			carrierId: 'story:campaign',
			layer: layer('front-only', {
				featureIds: ['front', 'missing'],
				opacityMultiplier: 0.4,
				style: { strokeColor: '#ff0000', strokeWidth: 7 },
			}),
			featureCollection: collection,
			sourceEvent: { id: 'event-latest', pubkey: PUBKEY, datasetId: 'western-front' },
			presentationAuthor: 'b'.repeat(64),
		})

		expect(collection).toEqual(original)
		expect(materialized.sourceFeatureCount).toBe(1)
		expect(materialized.matchedFeatureIds).toEqual(['front'])
		expect(materialized.missingFeatureIds).toEqual(['missing'])
		const feature = materialized.featureCollection.features[0]
		expect(feature?.properties?.name).toBe('Author name')
		expect(feature?.properties?.strokeColor).toBe('#ff0000')
		expect(feature?.properties?.strokeWidth).toBe(7)
		expect(feature?.properties?.[PRESENTATION_PROPERTY_KEYS.opacityMultiplier]).toBe(0.4)
		expect(feature?.properties?.[PRESENTATION_PROPERTY_KEYS.carrierId]).toBe('story:campaign')
		expect(feature?.properties?.sourceEventId).toBe('event-latest')
		expect(readPresentationFeatureProvenance(feature?.properties)).toMatchObject({
			carrierId: 'story:campaign',
			layerId: 'front-only',
			sourceFeatureId: 'front',
			occurrence: 0,
			dataAuthor: PUBKEY,
			presentationAuthor: 'b'.repeat(64),
		})
	})

	test('an explicit empty or stale selector remains empty', () => {
		const empty = materializePresentationLayer({
			carrierId: 'story:campaign',
			layer: layer('empty', { featureIds: [] }),
			featureCollection: collection,
		})
		const stale = materializePresentationLayer({
			carrierId: 'story:campaign',
			layer: layer('stale', { featureIds: ['does-not-exist'] }),
			featureCollection: collection,
		})
		expect(empty.featureCollection.features).toEqual([])
		expect(stale.featureCollection.features).toEqual([])
		expect(stale.missingFeatureIds).toEqual(['does-not-exist'])
	})

	test('keeps authored instance order and namespaces duplicate feature occurrences', () => {
		const duplicates: FeatureCollection<Point> = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'same',
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: {},
				},
				{
					type: 'Feature',
					id: 'same',
					geometry: { type: 'Point', coordinates: [1, 1] },
					properties: {},
				},
			],
		}
		const result = materializePresentationLayers([
			{ carrierId: 'story', layer: layer('bottom'), featureCollection: duplicates },
			{ carrierId: 'story', layer: layer('top'), featureCollection: duplicates },
		])

		expect(result.map((entry) => entry.layer.id)).toEqual(['bottom', 'top'])
		expect(result[0]?.featureCollection.features.map((feature) => feature.id)).toEqual([
			presentationFeatureRenderId({
				carrierId: 'story',
				layerId: 'bottom',
				sourceFeatureId: 'same',
				occurrence: 0,
			}),
			presentationFeatureRenderId({
				carrierId: 'story',
				layerId: 'bottom',
				sourceFeatureId: 'same',
				occurrence: 1,
			}),
		])
	})

	test('derived arrows retain source provenance but receive unique render ids', () => {
		const materialized = materializePresentationLayer({
			carrierId: 'story',
			layer: layer('arrows', { style: { arrowEnd: true } }),
			featureCollection: {
				type: 'FeatureCollection',
				features: [frontFeature],
			},
		})
		const source = materialized.featureCollection.features[0]
		const arrow = materialized.featureCollection.features[1]
		const sourceProvenance = readPresentationFeatureProvenance(source?.properties)
		const arrowProvenance = readPresentationFeatureProvenance(arrow?.properties)
		expect(arrow?.properties?.meta).toBe('arrowhead')
		expect(arrowProvenance).toMatchObject({
			carrierId: sourceProvenance?.carrierId,
			layerId: sourceProvenance?.layerId,
			sourceFeatureId: sourceProvenance?.sourceFeatureId,
			occurrence: sourceProvenance?.occurrence,
		})
		expect(arrowProvenance?.renderId).not.toBe(sourceProvenance?.renderId)
		expect(arrowProvenance?.renderId.startsWith(sourceProvenance?.renderId ?? 'missing')).toBe(true)
	})

	test('uses instance-specific, provenance-preserving proxies for tiny geometries', () => {
		const materialized = materializePresentationLayer({
			carrierId: 'story',
			layer: layer('tiny', {
				opacityMultiplier: 0.35,
				style: { fillColor: '#abcdef', arrowEnd: true },
			}),
			featureCollection: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						id: 'area',
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[0, 0],
									[0.001, 0],
									[0.001, 0.001],
									[0, 0],
								],
							],
						},
						properties: {},
					},
					{
						type: 'Feature',
						id: 'line',
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 0],
								[0.001, 0.001],
							],
						},
						properties: {},
					},
				],
			},
		})
		let projectionScale = 1_000
		const projection = {
			project: ([longitude, latitude]: [number, number]) => ({
				x: longitude * projectionScale,
				y: latitude * projectionScale,
			}),
		}

		const collapsed = materializePresentationLayerForViewport(materialized, projection, true)
		const collapsedOriginals = collapsed.featureCollection.features.slice(
			0,
			collapsed.sourceFeatureCount,
		)
		const proxies = collapsed.featureCollection.features.filter(
			(feature) => feature.properties?.proxyFeature === true,
		)
		expect(proxies).toHaveLength(2)
		expect(collapsedOriginals.every((feature) => feature.properties?.collapseToPointProxy)).toBe(
			true,
		)
		expect(
			collapsed.featureCollection.features.some(
				(feature) => feature.properties?.meta === 'arrowhead',
			),
		).toBe(false)
		const originalProvenance = readPresentationFeatureProvenance(collapsedOriginals[0]?.properties)
		const proxyProvenance = readPresentationFeatureProvenance(proxies[0]?.properties)
		expect(proxyProvenance?.renderId).toBe(`${originalProvenance?.renderId}:geometry-proxy`)
		expect(proxyProvenance && originalProvenance).toBeTruthy()
		if (proxyProvenance && originalProvenance) {
			expect(presentationGeometryChoiceId(proxyProvenance)).toBe(
				presentationGeometryChoiceId(originalProvenance),
			)
		}
		expect(proxies[0]?.properties?.fillColor).toBe('#abcdef')
		expect(proxies[0]?.properties?.[PRESENTATION_PROPERTY_KEYS.opacityMultiplier]).toBe(0.35)

		projectionScale = 100_000
		const expanded = materializePresentationLayerForViewport(materialized, projection, true)
		expect(
			expanded.featureCollection.features.some(
				(feature) => feature.properties?.proxyFeature === true,
			),
		).toBe(false)
		expect(
			expanded.featureCollection.features.some(
				(feature) => feature.properties?.meta === 'arrowhead',
			),
		).toBe(true)
		expect(materializePresentationLayerForViewport(materialized, projection, false)).toBe(
			materialized,
		)
	})
})

describe('presentation layer specifications', () => {
	test('builds one ordered, complete bundle with opacity on every visual surface', () => {
		const materialized = materializePresentationLayer({
			carrierId: 'story',
			layer: layer('front', { visible: false, opacityMultiplier: 0.25 }),
			featureCollection: collection,
		})
		const specs = buildPresentationLayerBundle(materialized, ['Open Sans Regular'])
		const expectedIds = presentationLayerBundleIds('story', 'front')
		expect(specs.map((spec) => spec.id)).toEqual(
			PRESENTATION_LAYER_ROLE_ORDER.map((role) => expectedIds[role]),
		)
		expect(new Set(specs.map((spec) => spec.source))).toEqual(new Set([materialized.sourceId]))
		expect(specs.every((spec) => spec.layout?.visibility === 'none')).toBe(true)

		const opacityPaintKeys = {
			fill: ['fill-opacity'],
			'polygon-stroke': ['line-opacity'],
			line: ['line-opacity'],
			'line-dashed': ['line-opacity'],
			'line-dotted': ['line-opacity'],
			'line-arrow': ['icon-opacity'],
			point: ['circle-opacity', 'circle-stroke-opacity'],
			'point-icon': ['icon-opacity'],
			'annotation-anchor': ['circle-opacity', 'circle-stroke-opacity'],
			'annotation-text': ['text-opacity'],
			label: ['text-opacity'],
			'line-label': ['text-opacity'],
		}
		for (const [index, spec] of specs.entries()) {
			const role = PRESENTATION_LAYER_ROLE_ORDER[index]
			if (!role) throw new Error(`Missing role for presentation spec ${spec.id}`)
			const paint = spec.paint as Record<string, unknown> | undefined
			for (const key of opacityPaintKeys[role]) {
				expect(JSON.stringify(paint?.[key])).toContain(PRESENTATION_PROPERTY_KEYS.opacityMultiplier)
			}
		}
		expect(JSON.stringify(specs.find((spec) => spec.id === expectedIds.point)?.paint)).toContain(
			'fillOpacity',
		)
		expect(
			JSON.stringify(specs.find((spec) => spec.id === expectedIds['polygon-stroke'])?.paint),
		).toContain('strokeOpacity')
	})
})

class FakeStyleMap {
	layers: Array<{ id: string }> = [{ id: 'background' }, { id: 'geo-editor-fill' }]
	sources = new Map<
		string,
		{ setData: (data: FeatureCollection) => void; data: FeatureCollection }
	>()
	addLayerCalls = 0
	removals: string[] = []

	getStyle() {
		return {
			version: 8 as const,
			sources: {},
			layers: this.layers,
		} as unknown as maplibregl.StyleSpecification
	}

	getLayer(id: string) {
		return this.layers.find((layer) => layer.id === id) as maplibregl.LayerSpecification | undefined
	}

	addLayer(specification: maplibregl.LayerSpecification, beforeId?: string) {
		this.addLayerCalls += 1
		const at = beforeId ? this.layers.findIndex((layer) => layer.id === beforeId) : -1
		const next = { id: specification.id }
		if (at >= 0) this.layers.splice(at, 0, next)
		else this.layers.push(next)
	}

	moveLayer(id: string, beforeId?: string) {
		const index = this.layers.findIndex((layer) => layer.id === id)
		if (index < 0) return
		const [layerEntry] = this.layers.splice(index, 1)
		if (!layerEntry) return
		const at = beforeId ? this.layers.findIndex((layer) => layer.id === beforeId) : -1
		if (at >= 0) this.layers.splice(at, 0, layerEntry)
		else this.layers.push(layerEntry)
	}

	removeLayer(id: string) {
		this.removals.push(`layer:${id}`)
		this.layers = this.layers.filter((layer) => layer.id !== id)
	}

	addSource(id: string, source: { data: FeatureCollection }) {
		const stored = {
			data: source.data,
			setData: (data: FeatureCollection) => {
				stored.data = data
			},
		}
		this.sources.set(id, stored)
	}

	getSource(id: string) {
		return this.sources.get(id)
	}

	removeSource(id: string) {
		this.removals.push(`source:${id}`)
		this.sources.delete(id)
	}

	setLayoutProperty() {}
}

describe('presentation MapLibre reconciliation', () => {
	test('is idempotent, preserves bottom-to-top order, replays style.load, and removes obsolete bundles', () => {
		const map = new FakeStyleMap()
		const materials = materializePresentationLayers([
			{ carrierId: 'story', layer: layer('bottom'), featureCollection: collection },
			{ carrierId: 'story', layer: layer('top'), featureCollection: collection },
		])
		let registry = reconcilePresentationMapLayers(
			map as unknown as MapLibreMap,
			materials,
			EMPTY_PRESENTATION_MAP_LAYER_REGISTRY,
			{ textFont: ['Open Sans Regular'] },
		)
		const firstAddCount = map.addLayerCalls
		const presentationIds = map.layers
			.map((entry) => entry.id)
			.filter((id) => id.startsWith('earthly-presentation:'))
		expect(presentationIds.slice(0, PRESENTATION_LAYER_ROLE_ORDER.length)).toEqual(
			Object.values(presentationLayerBundleIds('story', 'bottom')),
		)
		const overlayAnchor = map.layers.find((entry) => entry.id === 'geo-editor-fill')
		expect(overlayAnchor).toBeDefined()
		expect(overlayAnchor ? map.layers.indexOf(overlayAnchor) : -1).toBe(presentationIds.length + 1)

		registry = reconcilePresentationMapLayers(map as unknown as MapLibreMap, materials, registry, {
			textFont: ['Open Sans Regular'],
		})
		expect(map.addLayerCalls).toBe(firstAddCount)

		// A MapLibre style swap clears custom sources/layers; the same registry must replay safely.
		map.layers = [{ id: 'background' }, { id: 'geo-editor-fill' }]
		map.sources.clear()
		registry = reconcilePresentationMapLayers(map as unknown as MapLibreMap, materials, registry, {
			textFont: ['Open Sans Regular'],
		})
		expect(map.sources.size).toBe(2)

		const obsoleteMaterial = materials[1]
		expect(obsoleteMaterial).toBeDefined()
		registry = reconcilePresentationMapLayers(
			map as unknown as MapLibreMap,
			materials.slice(0, 1),
			registry,
			{ textFont: ['Open Sans Regular'] },
		)
		const obsoleteBundle = presentationLayerBundleIds('story', 'top')
		expect(map.removals).toEqual([
			...PRESENTATION_LAYER_ROLE_ORDER.toReversed().map((role) => `layer:${obsoleteBundle[role]}`),
			`source:${obsoleteMaterial?.sourceId}`,
		])
		expect(registry.entries).toHaveLength(1)
		expect(obsoleteMaterial ? map.sources.has(obsoleteMaterial.sourceId) : true).toBe(false)
		expect(
			map.layers.some((entry) => entry.id.startsWith(presentationInstanceId('story', 'top'))),
		).toBe(false)
	})
})

describe('presentation camera intent', () => {
	test('applies each intent once and resets omitted bearing and pitch', () => {
		const calls: Array<{ method: string; options: unknown }> = []
		const map: PresentationCameraMap = {
			easeTo: (options) => calls.push({ method: 'easeTo', options }),
			jumpTo: (options) => calls.push({ method: 'jumpTo', options }),
			fitBounds: (bounds, options) =>
				calls.push({ method: 'fitBounds', options: { bounds, options } }),
		}
		const applied = new Set<string>()
		const intent = {
			carrierId: 'story',
			intentId: 'opening',
			camera: { center: [3, 4] as const, zoom: 7 },
		}
		expect(applyPresentationCameraIntent(map, intent, applied)).toBe(true)
		expect(applyPresentationCameraIntent(map, intent, applied)).toBe(false)
		expect(calls).toEqual([
			{
				method: 'easeTo',
				options: { center: [3, 4], zoom: 7, bearing: 0, pitch: 0, duration: 500 },
			},
		])
	})

	test('fits only the supplied selected collection and retries an unresolved intent', () => {
		const calls: unknown[] = []
		const map: PresentationCameraMap = {
			easeTo: () => undefined,
			jumpTo: () => undefined,
			fitBounds: (bounds, options) => calls.push({ bounds, options }),
		}
		const applied = new Set<string>()
		const base = { carrierId: 'story', intentId: 'opening' }
		expect(
			applyPresentationCameraIntent(
				map,
				{ ...base, fitFeatureCollection: { type: 'FeatureCollection', features: [] } },
				applied,
			),
		).toBe(false)
		expect(
			applyPresentationCameraIntent(
				map,
				{
					...base,
					fitFeatureCollection: {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [12, 48] },
								properties: {},
							},
						],
					},
				},
				applied,
			),
		).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			bounds: [
				[12, 48],
				[12, 48],
			],
		})
	})
})

describe('presentation interaction identity', () => {
	test('deduplicates sublayers inside an instance without collapsing duplicate instances', () => {
		const base = {
			carrierId: 'story',
			layerId: 'one',
			source: SOURCE,
			sourceFeatureId: 'front',
			occurrence: 0,
			renderId: 'render',
		}
		expect(presentationGeometryChoiceId(base)).toBe(presentationGeometryChoiceId({ ...base }))
		expect(presentationGeometryChoiceId(base)).not.toBe(
			presentationGeometryChoiceId({ ...base, layerId: 'two' }),
		)
	})
})
