import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapletInstanceView } from './MapletsPanel'

export const mapletSourceId = (id: string) => `maplet:${id}`
export const mapletLayerIds = (id: string) =>
	['fill', 'line', 'point'].map((role) => `${mapletSourceId(id)}:${role}`)

export function mapletRenderCollection(
	instance: Pick<MapletInstanceView, 'id' | 'title' | 'collection'>,
): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: instance.collection.features.map((feature) => ({
			...feature,
			properties: {
				...feature.properties,
				earthlyMapletInstanceId: instance.id,
				earthlyMapletFeatureId: String(feature.id),
				earthlyMapletTitle: instance.title,
			},
		})),
	}
}

export function mapletLayerSpecifications(
	instance: Pick<MapletInstanceView, 'id' | 'visible'>,
): LayerSpecification[] {
	const source = mapletSourceId(instance.id)
	const layout = { visibility: instance.visible ? ('visible' as const) : ('none' as const) }
	return [
		{
			id: `${source}:fill`,
			type: 'fill',
			source,
			layout,
			filter: ['==', ['geometry-type'], 'Polygon'],
			paint: {
				'fill-color': ['to-color', ['get', 'fillColor'], '#38bdf8'],
				'fill-opacity': ['min', 1, ['max', 0, ['to-number', ['get', 'fillOpacity'], 0.25]]],
			},
		},
		{
			id: `${source}:line`,
			type: 'line',
			source,
			layout,
			filter: ['!=', ['geometry-type'], 'Point'],
			paint: {
				'line-color': ['to-color', ['get', 'strokeColor'], '#38bdf8'],
				'line-opacity': ['min', 1, ['max', 0, ['to-number', ['get', 'strokeOpacity'], 0.9]]],
				'line-width': ['min', 20, ['max', 0, ['to-number', ['get', 'strokeWidth'], 2]]],
			},
		},
		{
			id: `${source}:point`,
			type: 'circle',
			source,
			layout,
			filter: ['==', ['geometry-type'], 'Point'],
			paint: {
				'circle-color': ['to-color', ['get', 'fillColor'], '#38bdf8'],
				'circle-radius': 6,
				'circle-stroke-color': '#fff',
				'circle-stroke-width': 1.5,
			},
		},
	]
}

function remove(map: MapLibreMap, id: string) {
	for (const layer of mapletLayerIds(id).reverse()) if (map.getLayer(layer)) map.removeLayer(layer)
	if (map.getSource(mapletSourceId(id))) map.removeSource(mapletSourceId(id))
}

/** Reconcile a separate source per runtime instance, in Shelf order. */
export function reconcileMapletLayers(
	map: MapLibreMap,
	instances: readonly MapletInstanceView[],
	previous: ReadonlySet<string>,
): Set<string> {
	if (!map.getStyle()) return new Set(previous)
	const desired = new Set(instances.map((instance) => instance.id))
	for (const id of previous) if (!desired.has(id)) remove(map, id)
	const anchor = map.getStyle().layers?.find((layer) => layer.id.startsWith('geo-editor-'))?.id
	for (const instance of instances) {
		const source = map.getSource(mapletSourceId(instance.id)) as GeoJSONSource | undefined
		if (source) source.setData(mapletRenderCollection(instance))
		else
			map.addSource(mapletSourceId(instance.id), {
				type: 'geojson',
				data: mapletRenderCollection(instance),
			})
		for (const spec of mapletLayerSpecifications(instance)) {
			if (map.getLayer(spec.id)) {
				map.setLayoutProperty(spec.id, 'visibility', instance.visible ? 'visible' : 'none')
				map.moveLayer(spec.id, anchor)
			} else map.addLayer(spec, anchor)
		}
	}
	return desired
}

/** Dedicated runtime sources survive style reloads and never become saved Dataset events. */
export function useMapletLayers(
	mapRef: React.RefObject<MapLibreMap | null>,
	mounted: boolean,
	instances: readonly MapletInstanceView[],
) {
	const registered = useRef(new Set<string>())
	const current = useRef(instances)
	const reconcileRef = useRef<((instances: readonly MapletInstanceView[]) => void) | undefined>(
		undefined,
	)
	current.current = instances
	const [ready, setReady] = useState(false)
	const interactiveLayerIds = useMemo(
		() =>
			instances
				.filter((instance) => instance.visible)
				.flatMap((instance) => mapletLayerIds(instance.id)),
		[instances],
	)
	useEffect(() => {
		const map = mapRef.current
		if (!map || !mounted) return
		const reconcile = (instances: readonly MapletInstanceView[]) => {
			if (!map.getStyle()) return
			registered.current = reconcileMapletLayers(map, instances, registered.current)
			setReady(true)
		}
		reconcileRef.current = reconcile
		reconcile(current.current)
		const onStyleLoad = () => reconcile(current.current)
		map.on('style.load', onStyleLoad)
		return () => {
			reconcileRef.current = undefined
			map.off('style.load', onStyleLoad)
			for (const id of registered.current) remove(map, id)
			registered.current = new Set()
		}
	}, [mapRef, mounted])
	useEffect(() => {
		reconcileRef.current?.(instances)
	}, [instances])
	return { ready, interactiveLayerIds }
}
