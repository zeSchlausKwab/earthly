import type maplibregl from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { useEditorStore, type MapLayerState } from '../../store'

/**
 * Sync `useEditorStore.mapLayers` (driven by `MapSettingsPanel`) to live
 * MapLibre layer visibility/opacity.
 *
 *   - chunked-vector basemap   → mutate every Protomaps style layer's
 *                                paint/layout (fill / line / circle / symbol /
 *                                background)
 *   - pmtiles / file overlays  → setLayoutProperty(visibility) +
 *                                setPaintProperty(raster-opacity)
 *
 * RAF-batched. Avoids structural style mutations (add/remove/move) — those
 * are scheduled via a full setStyle() in the wrapper.
 */
export function useMapLayerStateSync(map: maplibregl.Map | null, isLoaded: boolean): void {
	const mapLayers = useEditorStore((state) => state.mapLayers)
	const mapLayersRef = useRef<MapLayerState[]>(mapLayers)
	const scheduleLayerSyncRef = useRef<(() => void) | null>(null)
	const protomapsLayerIdsRef = useRef<string[]>([])

	useEffect(() => {
		mapLayersRef.current = mapLayers
		scheduleLayerSyncRef.current?.()
	}, [mapLayers])

	useEffect(() => {
		if (!map || !isLoaded) return

		let disposed = false
		let rafId: number | null = null

		const getProtomapsLayerIds = (): string[] => {
			try {
				const style = map.getStyle()
				const layers = style?.layers ?? []
				return layers
					.filter((l) => (l as unknown as { source?: string }).source === 'protomaps')
					.map((l) => l.id)
			} catch {
				return []
			}
		}

		const applyLayerChanges = () => {
			if (disposed) return
			try {
				if (!map.getStyle?.()) return
			} catch {
				return
			}

			const allLayers = mapLayersRef.current

			// chunked-vector basemap visibility + opacity
			const vectors = allLayers.find((l) => l.kind === 'chunked-vector') ?? null
			if (vectors) {
				if (protomapsLayerIdsRef.current.length === 0) {
					protomapsLayerIdsRef.current = getProtomapsLayerIds()
				}

				for (const layerId of protomapsLayerIdsRef.current) {
					try {
						if (!map.getLayer(layerId)) continue
						map.setLayoutProperty(layerId, 'visibility', vectors.enabled ? 'visible' : 'none')
					} catch {
						// ignore
					}
				}

				const opacity = vectors.opacity
				for (const layerId of protomapsLayerIdsRef.current) {
					const styleLayer = (() => {
						try {
							return map.getLayer(layerId)
						} catch {
							return undefined
						}
					})()
					if (!styleLayer) continue

					try {
						if (styleLayer.type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', opacity)
						if (styleLayer.type === 'line') map.setPaintProperty(layerId, 'line-opacity', opacity)
						if (styleLayer.type === 'circle')
							map.setPaintProperty(layerId, 'circle-opacity', opacity)
						if (styleLayer.type === 'symbol') {
							map.setPaintProperty(layerId, 'icon-opacity', opacity)
							map.setPaintProperty(layerId, 'text-opacity', opacity)
						}
						if (styleLayer.type === 'background')
							map.setPaintProperty(layerId, 'background-opacity', opacity)
					} catch {
						// ignore
					}
				}
			}

			// PMTiles / file overlays (layers were added via the style spec)
			for (const layer of allLayers) {
				if (layer.kind !== 'pmtiles' && layer.kind !== 'file') continue
				const mapLayerId = `layer-${layer.id}`
				try {
					if (!map.getLayer(mapLayerId)) continue
					map.setLayoutProperty(mapLayerId, 'visibility', layer.enabled ? 'visible' : 'none')
					map.setPaintProperty(mapLayerId, 'raster-opacity', layer.opacity)
				} catch {
					// ignore
				}
			}
		}

		const scheduleApply = () => {
			if (disposed) return
			if (rafId != null) return
			rafId = window.requestAnimationFrame(() => {
				rafId = null
				applyLayerChanges()
			})
		}

		scheduleLayerSyncRef.current = scheduleApply
		scheduleApply()

		const onStyleLoad = () => {
			protomapsLayerIdsRef.current = []
			scheduleApply()
		}
		map.on('style.load', onStyleLoad)

		return () => {
			disposed = true
			if (scheduleLayerSyncRef.current === scheduleApply) {
				scheduleLayerSyncRef.current = null
			}
			if (rafId != null) {
				try {
					window.cancelAnimationFrame(rafId)
				} catch {
					// ignore
				}
				rafId = null
			}
			try {
				map.off('style.load', onStyleLoad)
			} catch {
				// ignore
			}
		}
	}, [map, isLoaded])
}
