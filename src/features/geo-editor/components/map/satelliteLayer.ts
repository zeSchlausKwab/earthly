import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import {
	EOX_SATELLITE_ATTRIBUTION,
	EOX_SATELLITE_TILES,
	type SatelliteSettings,
} from '@/lib/satellite'

export const SATELLITE_SOURCE_ID = 'earthly-eox-satellite'
export const SATELLITE_LAYER_ID = 'earthly-eox-satellite-imagery'

type SatelliteMap = Pick<
	MapLibreMap,
	| 'getStyle'
	| 'getLayer'
	| 'getSource'
	| 'addSource'
	| 'addLayer'
	| 'removeLayer'
	| 'removeSource'
	| 'moveLayer'
	| 'setPaintProperty'
>

function isBasemapLayer(layer: LayerSpecification): boolean {
	return (
		layer.type === 'background' ||
		('source' in layer && (layer.source === 'openmaptiles' || layer.source === 'ne2_shaded'))
	)
}

function isOsmOverlay(layer: LayerSpecification): boolean {
	return layer.type === 'line' || layer.type === 'symbol' || layer.type === 'circle'
}

/** Owns only the imagery and OpenFreeMap layer order; authored layers stay above both. */
export class SatelliteLayerController {
	private baseLayers: LayerSpecification[] | null = null
	private osmOverlay: boolean | null = null

	constructor(private readonly map: SatelliteMap) {}

	/** A full style replacement discarded our source and the previous layer order. */
	reset(): void {
		this.baseLayers = null
		this.osmOverlay = null
	}

	apply(settings: SatelliteSettings): void {
		if (!settings.enabled || settings.opacity === 0) {
			this.remove()
			return
		}
		const style = this.map.getStyle()
		if (!style) return
		this.baseLayers ??= style.layers.filter(isBasemapLayer)
		const baseIds = new Set(this.baseLayers.map((layer) => layer.id))
		const anchor = style.layers.find(
			(layer) => layer.id !== SATELLITE_LAYER_ID && !baseIds.has(layer.id),
		)?.id

		if (!this.map.getSource(SATELLITE_SOURCE_ID)) {
			this.map.addSource(SATELLITE_SOURCE_ID, {
				type: 'raster',
				tiles: [EOX_SATELLITE_TILES],
				tileSize: 256,
				minzoom: 0,
				// Native imagery is about 10 m; MapLibre overzooms it at closer views.
				maxzoom: 14,
				attribution: EOX_SATELLITE_ATTRIBUTION,
			})
		}
		if (!this.map.getLayer(SATELLITE_LAYER_ID)) {
			this.map.addLayer(
				{
					id: SATELLITE_LAYER_ID,
					type: 'raster',
					source: SATELLITE_SOURCE_ID,
					paint: { 'raster-opacity': settings.opacity, 'raster-fade-duration': 0 },
				},
				anchor,
			)
			this.osmOverlay = null
		} else {
			this.map.setPaintProperty(SATELLITE_LAYER_ID, 'raster-opacity', settings.opacity)
		}

		if (this.osmOverlay === settings.osmOverlay) return
		// OpenFreeMap interleaves fills and roads. Partition its layers so no
		// opaque land/building fill covers the imagery or the retained road overlay.
		const below = this.baseLayers.filter((layer) => !settings.osmOverlay || !isOsmOverlay(layer))
		const above = settings.osmOverlay ? this.baseLayers.filter(isOsmOverlay) : []
		for (const layer of below) {
			if (this.map.getLayer(layer.id)) this.map.moveLayer(layer.id, anchor)
		}
		this.map.moveLayer(SATELLITE_LAYER_ID, anchor)
		for (const layer of above) {
			if (this.map.getLayer(layer.id)) this.map.moveLayer(layer.id, anchor)
		}
		this.osmOverlay = settings.osmOverlay
	}

	remove(): void {
		// If a style swap already removed the imagery, do not reorder the new style.
		if (this.map.getLayer(SATELLITE_LAYER_ID)) {
			this.map.removeLayer(SATELLITE_LAYER_ID)
			const layers = this.map.getStyle()?.layers ?? []
			const baseIds = new Set(this.baseLayers?.map((layer) => layer.id))
			const anchor = layers.find((layer) => !baseIds.has(layer.id))?.id
			for (const layer of this.baseLayers ?? []) {
				if (this.map.getLayer(layer.id)) this.map.moveLayer(layer.id, anchor)
			}
		}
		if (this.map.getSource(SATELLITE_SOURCE_ID)) this.map.removeSource(SATELLITE_SOURCE_ID)
		this.reset()
	}
}
