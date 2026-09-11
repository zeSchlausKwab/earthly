import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../store'
import {
	isPresentationMapLayerId,
	PRESENTATION_INTERACTIVE_LAYER_ROLES,
} from '../map-presentation/ids'
import {
	buildPresentationLayerBundle,
	FALLBACK_TEXT_FONT_STACK,
	getMapStyleTextFont,
	presentationLayerBundleIds,
} from '../map-presentation/layerSpecs'
import {
	materializePresentationLayerForViewport,
	materializePresentationLayers,
	type MaterializedPresentationLayer,
	type PresentationLayerMaterializationInput,
} from '../map-presentation/materialize'

const DEFAULT_OVERLAY_ANCHOR_PREFIXES = Object.freeze([
	'geo-editor-',
	'proposal-',
	'comment-',
	'sighting-',
	'user-location-',
])

export interface PresentationMapLayerRegistryEntry {
	readonly instanceId: string
	readonly sourceId: string
	readonly layerIds: readonly string[]
}

export interface PresentationMapLayerRegistry {
	readonly entries: readonly PresentationMapLayerRegistryEntry[]
}

export const EMPTY_PRESENTATION_MAP_LAYER_REGISTRY: PresentationMapLayerRegistry = Object.freeze({
	entries: Object.freeze([]),
})

interface ReconcilePresentationMapLayersOptions {
	readonly beforeLayerId?: string
	readonly overlayAnchorPrefixes?: readonly string[]
	readonly textFont?: readonly string[]
}

/** Find the first application overlay, leaving every presentation below it. */
export function findPresentationOverlayAnchor(
	map: Pick<MapLibreMap, 'getStyle' | 'getLayer'>,
	explicitLayerId?: string,
	prefixes: readonly string[] = DEFAULT_OVERLAY_ANCHOR_PREFIXES,
): string | undefined {
	if (explicitLayerId && map.getLayer(explicitLayerId)) return explicitLayerId
	const layers = map.getStyle()?.layers ?? []
	return layers.find(
		(layer) =>
			!isPresentationMapLayerId(layer.id) && prefixes.some((prefix) => layer.id.startsWith(prefix)),
	)?.id
}

function removeRegistryEntry(map: MapLibreMap, entry: PresentationMapLayerRegistryEntry): void {
	// MapLibre requires layers to disappear before their source. Removing top to
	// bottom also avoids transiently exposing lower sublayers during replacement.
	for (let index = entry.layerIds.length - 1; index >= 0; index -= 1) {
		const layerId = entry.layerIds[index]
		if (layerId && map.getLayer(layerId)) map.removeLayer(layerId)
	}
	if (map.getSource(entry.sourceId)) map.removeSource(entry.sourceId)
}

export function removePresentationMapLayers(
	map: MapLibreMap,
	registry: PresentationMapLayerRegistry,
): void {
	for (let index = registry.entries.length - 1; index >= 0; index -= 1) {
		const entry = registry.entries[index]
		if (entry) removeRegistryEntry(map, entry)
	}
}

function updateLayerVisibility(map: MapLibreMap, specification: LayerSpecification): void {
	const visibility = specification.layout?.visibility
	if (visibility) map.setLayoutProperty(specification.id, 'visibility', visibility)
}

/**
 * Idempotently reconcile one source and one complete layer bundle per authored
 * instance. Input order is already bottom-to-top and is never reversed.
 */
export function reconcilePresentationMapLayers(
	map: MapLibreMap,
	layers: readonly MaterializedPresentationLayer[],
	previous: PresentationMapLayerRegistry = EMPTY_PRESENTATION_MAP_LAYER_REGISTRY,
	options: ReconcilePresentationMapLayersOptions = {},
): PresentationMapLayerRegistry {
	if (!map.getStyle()) return previous

	const desiredIds = new Set(layers.map((layer) => layer.instanceId))
	for (let index = previous.entries.length - 1; index >= 0; index -= 1) {
		const entry = previous.entries[index]
		if (entry && !desiredIds.has(entry.instanceId)) removeRegistryEntry(map, entry)
	}

	const textFont = options.textFont ?? getMapStyleTextFont(map.getStyle()) ?? undefined
	const resolvedTextFont = textFont ?? FALLBACK_TEXT_FONT_STACK
	const beforeLayerId = findPresentationOverlayAnchor(
		map,
		options.beforeLayerId,
		options.overlayAnchorPrefixes,
	)
	const entries: PresentationMapLayerRegistryEntry[] = []

	for (const layer of layers) {
		const existingSource = map.getSource(layer.sourceId) as GeoJSONSource | undefined
		if (existingSource) {
			existingSource.setData(layer.featureCollection)
		} else {
			map.addSource(layer.sourceId, {
				type: 'geojson',
				data: layer.featureCollection,
				promoteId: 'earthlyPresentationRenderId',
			})
		}

		const specifications = buildPresentationLayerBundle(layer, resolvedTextFont)
		for (const specification of specifications) {
			if (map.getLayer(specification.id)) {
				updateLayerVisibility(map, specification)
				map.moveLayer(specification.id, beforeLayerId)
			} else {
				map.addLayer(specification, beforeLayerId)
			}
		}
		entries.push(
			Object.freeze({
				instanceId: layer.instanceId,
				sourceId: layer.sourceId,
				layerIds: Object.freeze(specifications.map((specification) => specification.id)),
			}),
		)
	}

	return Object.freeze({ entries: Object.freeze(entries) })
}

export interface UsePresentationMapLayersOptions {
	readonly mapRef: React.RefObject<MapLibreMap | null>
	readonly mounted: boolean
	readonly layers: readonly PresentationLayerMaterializationInput[]
	readonly beforeLayerId?: string
	readonly overlayAnchorPrefixes?: readonly string[]
	/** Override the user's tiny-geometry setting, primarily for embedded canvases/tests. */
	readonly geometryPointProxyEnabled?: boolean
}

export interface UsePresentationMapLayersResult {
	readonly ready: boolean
	readonly materializedLayers: readonly MaterializedPresentationLayer[]
	readonly interactiveLayerIds: readonly string[]
}

/** MapLibre lifecycle seam shared by the app canvas and editorial reader. */
export function usePresentationMapLayers({
	mapRef,
	mounted,
	layers,
	beforeLayerId,
	overlayAnchorPrefixes,
	geometryPointProxyEnabled: geometryPointProxyOverride,
}: UsePresentationMapLayersOptions): UsePresentationMapLayersResult {
	const [ready, setReady] = useState(false)
	const storedGeometryPointProxyEnabled = useEditorStore((state) => state.geometryPointProxyEnabled)
	const geometryPointProxyEnabled = geometryPointProxyOverride ?? storedGeometryPointProxyEnabled
	const registryRef = useRef<PresentationMapLayerRegistry>(EMPTY_PRESENTATION_MAP_LAYER_REGISTRY)
	const mapInstanceRef = useRef<MapLibreMap | null>(null)
	const materializedLayers = useMemo(() => materializePresentationLayers(layers), [layers])

	useEffect(() => {
		const map = mapRef.current
		if (!map) {
			setReady(false)
			return
		}
		if (mapInstanceRef.current && mapInstanceRef.current !== map) {
			try {
				removePresentationMapLayers(mapInstanceRef.current, registryRef.current)
			} catch {
				// Previous map may already be removed.
			}
			registryRef.current = EMPTY_PRESENTATION_MAP_LAYER_REGISTRY
		}
		mapInstanceRef.current = map
		if (!mounted) {
			try {
				removePresentationMapLayers(map, registryRef.current)
			} catch {
				// Map may already be removed.
			}
			registryRef.current = EMPTY_PRESENTATION_MAP_LAYER_REGISTRY
			setReady(false)
			return
		}

		const layersForViewport = () =>
			materializedLayers.map((layer) =>
				materializePresentationLayerForViewport(layer, map, geometryPointProxyEnabled),
			)

		const reconcile = () => {
			try {
				registryRef.current = reconcilePresentationMapLayers(
					map,
					layersForViewport(),
					registryRef.current,
					{ beforeLayerId, overlayAnchorPrefixes },
				)
				setReady(true)
			} catch (error) {
				console.warn('Failed to reconcile presentation map layers:', error)
				setReady(false)
			}
		}

		let zoomFrame: number | null = null
		const scheduleViewportSync = () => {
			if (!geometryPointProxyEnabled || zoomFrame !== null) return
			zoomFrame = window.requestAnimationFrame(() => {
				zoomFrame = null
				try {
					for (const layer of layersForViewport()) {
						const source = map.getSource(layer.sourceId) as GeoJSONSource | undefined
						source?.setData(layer.featureCollection)
					}
				} catch {
					// A concurrent style swap will replay through style.load.
				}
			})
		}

		reconcile()
		map.on('style.load', reconcile)
		map.on('zoom', scheduleViewportSync)
		return () => {
			if (zoomFrame !== null) window.cancelAnimationFrame(zoomFrame)
			try {
				map.off('style.load', reconcile)
				map.off('zoom', scheduleViewportSync)
			} catch {
				// Map may already be removed.
			}
		}
	}, [
		beforeLayerId,
		geometryPointProxyEnabled,
		mapRef,
		materializedLayers,
		mounted,
		overlayAnchorPrefixes,
	])

	useEffect(() => {
		return () => {
			const map = mapInstanceRef.current ?? mapRef.current
			if (!map) return
			try {
				removePresentationMapLayers(map, registryRef.current)
			} catch {
				// Map may already be removed.
			}
			registryRef.current = EMPTY_PRESENTATION_MAP_LAYER_REGISTRY
			mapInstanceRef.current = null
		}
	}, [mapRef])

	const interactiveLayerIds = useMemo(
		() =>
			materializedLayers.flatMap((layer) => {
				const ids = presentationLayerBundleIds(layer.carrierId, layer.layer.id)
				return PRESENTATION_INTERACTIVE_LAYER_ROLES.map((role) => ids[role])
			}),
		[materializedLayers],
	)

	return { ready, materializedLayers, interactiveLayerIds }
}
