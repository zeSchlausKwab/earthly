import { useEffect } from 'react'
import type { Feature, Geometry } from 'geojson'
import type maplibregl from 'maplibre-gl'

/**
 * Renders the geometry of a Sighting that's being created/edited as an amber
 * preview on the map. The GeoEditor's transient draw feature is deleted right
 * after its geometry is captured (it isn't a dataset feature — it becomes the
 * Sighting's `content.geometry`), so without this overlay there'd be nothing on
 * the map showing where the pin was dropped. Handles both the point pin-drop
 * (D-01) and the "draw an area instead" polygon (D-02).
 */
const SOURCE_ID = 'sighting-placement-preview'
const CIRCLE_LAYER = 'sighting-placement-circle'
const FILL_LAYER = 'sighting-placement-fill'
const LINE_LAYER = 'sighting-placement-line'
// Sighting amber (matches the entity glyph / list accent).
const AMBER = '#f0b429'

interface SightingPlacementPreviewProps {
	map: maplibregl.Map | null
	geometry: Geometry | null
	/** Only touch the map once it's loaded (adding sources/layers before errors). */
	mapReady: boolean
}

export function SightingPlacementPreview({
	map,
	geometry,
	mapReady,
}: SightingPlacementPreviewProps) {
	useEffect(() => {
		if (!map || !mapReady) return

		const removeLayersAndSource = () => {
			for (const id of [CIRCLE_LAYER, FILL_LAYER, LINE_LAYER]) {
				if (map.getLayer(id)) map.removeLayer(id)
			}
			if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
		}

		if (!geometry) {
			removeLayersAndSource()
			return
		}

		const data: Feature = { type: 'Feature', geometry, properties: {} }
		const existing = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
		if (existing) {
			existing.setData(data)
		} else {
			map.addSource(SOURCE_ID, { type: 'geojson', data })
			// Area (polygon) fill + outline.
			map.addLayer({
				id: FILL_LAYER,
				type: 'fill',
				source: SOURCE_ID,
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: { 'fill-color': AMBER, 'fill-opacity': 0.15 },
			})
			map.addLayer({
				id: LINE_LAYER,
				type: 'line',
				source: SOURCE_ID,
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: { 'line-color': AMBER, 'line-width': 2 },
			})
			// Point pin-drop.
			map.addLayer({
				id: CIRCLE_LAYER,
				type: 'circle',
				source: SOURCE_ID,
				filter: ['==', ['geometry-type'], 'Point'],
				paint: {
					'circle-radius': 8,
					'circle-color': AMBER,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 3,
				},
			})
		}

		return removeLayersAndSource
	}, [map, geometry, mapReady])

	return null
}
