import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'

const FALLBACK_TEXT_FONT_STACK = ['Open Sans Regular', 'Arial Unicode MS Regular']

/**
 * LayerManager handles all MapLibre layer and source setup for the GeoEditor.
 * This includes creating sources, adding layers with appropriate styling,
 * and safely accessing GeoJSON sources.
 *
 * IMPORTANT: Layer order matters for z-index and event handling.
 * The order must match the original GeoEditor implementation exactly.
 */
export class LayerManager {
	private map!: MapLibreMap

	// Source IDs
	readonly SOURCE_ID = 'geo-editor'
	readonly SOURCE_VERTICES = 'geo-editor-vertices'
	readonly SOURCE_SELECTION = 'geo-editor-selection'
	readonly SOURCE_SELECTION_BOX = 'geo-editor-selection-box'
	readonly SOURCE_CURSOR = 'geo-editor-cursor'
	readonly SOURCE_GIZMO = 'geo-editor-gizmo'

	// Layer IDs
	readonly LAYER_LINE = 'geo-editor-line'
	readonly LAYER_FILL = 'geo-editor-fill'
	readonly LAYER_POINT = 'geo-editor-point'
	readonly LAYER_LABEL = 'geo-editor-label'
	readonly LAYER_ANNOTATION_ANCHOR = 'geo-editor-annotation-anchor'
	readonly LAYER_ANNOTATION = 'geo-editor-annotation'
	readonly LAYER_VERTEX = 'geo-editor-vertex'
	readonly LAYER_MIDPOINT = 'geo-editor-midpoint'
	readonly LAYER_SELECTION_FILL = 'geo-editor-selection-fill'
	readonly LAYER_SELECTION_LINE = 'geo-editor-selection-line'
	readonly LAYER_SELECTION_POINT = 'geo-editor-selection-point'
	readonly LAYER_SELECTION_BOX = 'geo-editor-selection-box'
	readonly LAYER_GIZMO_LINE = 'geo-editor-gizmo-line'
	readonly LAYER_GIZMO_CENTER = 'geo-editor-gizmo-center'
	readonly LAYER_GIZMO_ROTATE = 'geo-editor-gizmo-rotate'
	readonly LAYER_GIZMO_MOVE = 'geo-editor-gizmo-move'
	readonly LAYER_CURSOR = 'geo-editor-cursor'

	onAdd(map: MapLibreMap): void {
		this.map = map
	}

	onRemove(): void {
		// Cleanup handled by GeoEditor.destroy()
	}

	isStyleReady(): boolean {
		try {
			if (!this.map?.getStyle?.()) return false
			return true
		} catch {
			return false
		}
	}

	private getDefaultTextFontStack(): string[] {
		const isStringArray = (value: unknown): value is string[] =>
			Array.isArray(value) && value.every((v) => typeof v === 'string')

		const extract = (value: unknown): string[] | null => {
			if (typeof value === 'string') return [value]
			if (isStringArray(value)) return value
			if (!Array.isArray(value) || value.length === 0) return null

			const [op, ...rest] = value
			if (op === 'literal' && rest.length > 0 && isStringArray(rest[0])) return rest[0]
			if (op === 'case') {
				for (const part of rest) {
					const extracted = extract(part)
					if (extracted) return extracted
				}
			}
			return null
		}

		try {
			const style = this.map.getStyle?.()
			const layers = style?.layers ?? []
			for (const layer of layers) {
				const layout = (layer as unknown as { layout?: Record<string, unknown> }).layout
				const textFont = layout?.['text-font']
				const extracted = extract(textFont)
				if (extracted) return extracted
			}
		} catch {
			return FALLBACK_TEXT_FONT_STACK
		}

		return FALLBACK_TEXT_FONT_STACK
	}

	/**
	 * Get a GeoJSON source with full style readiness check.
	 * Use this for initial layer setup.
	 */
	safeGetGeoJSONSource(id: string): GeoJSONSource | undefined {
		if (!this.isStyleReady()) return undefined
		try {
			return this.map.getSource(id) as GeoJSONSource | undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Get a GeoJSON source without the isStyleLoaded check.
	 * Use this for updates after layers are already set up, since
	 * isStyleLoaded() can return false during rapid interactions
	 * even when sources exist.
	 */
	getGeoJSONSource(id: string): GeoJSONSource | undefined {
		try {
			if (!this.map?.getStyle?.()) return undefined
			return this.map.getSource(id) as GeoJSONSource | undefined
		} catch {
			return undefined
		}
	}

	/**
	 * Setup all sources and layers in the exact order from the original implementation.
	 * Order matters for z-index and event handling.
	 */
	setupLayers(getFeatureCollection: () => FeatureCollection): void {
		if (!this.isStyleReady()) return
		try {
			// === SOURCES ===
			// Add main feature source
			if (!this.safeGetGeoJSONSource(this.SOURCE_ID)) {
				this.map.addSource(this.SOURCE_ID, {
					type: 'geojson',
					data: getFeatureCollection(),
				})
			}

			// Add vertices source for edit mode
			if (!this.safeGetGeoJSONSource(this.SOURCE_VERTICES)) {
				this.map.addSource(this.SOURCE_VERTICES, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
			}

			if (!this.safeGetGeoJSONSource(this.SOURCE_SELECTION)) {
				this.map.addSource(this.SOURCE_SELECTION, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
			}

			if (!this.safeGetGeoJSONSource(this.SOURCE_SELECTION_BOX)) {
				this.map.addSource(this.SOURCE_SELECTION_BOX, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
			}

			if (!this.safeGetGeoJSONSource(this.SOURCE_GIZMO)) {
				this.map.addSource(this.SOURCE_GIZMO, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
			}

			if (!this.safeGetGeoJSONSource(this.SOURCE_CURSOR)) {
				this.map.addSource(this.SOURCE_CURSOR, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
			}

			// === LAYERS (order is critical for z-index and events) ===

			// 1. Polygon fill layer
			if (!this.map.getLayer(this.LAYER_FILL)) {
				this.map.addLayer({
					id: this.LAYER_FILL,
					type: 'fill',
					source: this.SOURCE_ID,
					filter: [
						'all',
						[
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						['any', ['==', ['get', 'meta'], 'feature'], ['==', ['get', 'meta'], 'feature-temp']],
					],
					paint: {
						'fill-color': [
							'case',
							['==', ['get', 'active'], true],
							'#fbb03b',
							['coalesce', ['get', 'fillColor'], ['get', 'color'], '#3bb2d0'],
						],
						'fill-opacity': [
							'case',
							['==', ['get', 'meta'], 'feature-temp'],
							0.2,
							['coalesce', ['get', 'fillOpacity'], 0.3],
						],
					},
				})
			}

			// 2. Selection fill layer
			if (!this.map.getLayer(this.LAYER_SELECTION_FILL)) {
				this.map.addLayer({
					id: this.LAYER_SELECTION_FILL,
					type: 'fill',
					source: this.SOURCE_SELECTION,
					filter: [
						'any',
						['==', ['geometry-type'], 'Polygon'],
						['==', ['geometry-type'], 'MultiPolygon'],
					],
					paint: {
						'fill-color': '#2563eb',
						'fill-opacity': 0.2,
					},
				})
			}

			// 3. Main line layer
			if (!this.map.getLayer(this.LAYER_LINE)) {
				this.map.addLayer({
					id: this.LAYER_LINE,
					type: 'line',
					source: this.SOURCE_ID,
					filter: [
						'all',
						[
							'any',
							['==', ['geometry-type'], 'LineString'],
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiLineString'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						['any', ['==', ['get', 'meta'], 'feature'], ['==', ['get', 'meta'], 'feature-temp']],
					],
					paint: {
						'line-color': [
							'case',
							['==', ['get', 'active'], true],
							'#1d4ed8',
							['coalesce', ['get', 'strokeColor'], ['get', 'color'], '#3bb2d0'],
						],
						'line-width': [
							'case',
							['==', ['get', 'active'], true],
							4,
							['coalesce', ['get', 'strokeWidth'], 2],
						],
						'line-opacity': ['coalesce', ['get', 'strokeOpacity'], 1],
					},
				})
			}

			// 4. Selection line layer
			if (!this.map.getLayer(this.LAYER_SELECTION_LINE)) {
				this.map.addLayer({
					id: this.LAYER_SELECTION_LINE,
					type: 'line',
					source: this.SOURCE_SELECTION,
					filter: [
						'any',
						['==', ['geometry-type'], 'LineString'],
						['==', ['geometry-type'], 'MultiLineString'],
						['==', ['geometry-type'], 'Polygon'],
						['==', ['geometry-type'], 'MultiPolygon'],
					],
					paint: {
						'line-color': '#2563eb',
						'line-width': 3,
						'line-dasharray': ['literal', [2, 2]],
					},
				})
			}

			// 5. Main point layer (excludes annotations)
			if (!this.map.getLayer(this.LAYER_POINT)) {
				this.map.addLayer({
					id: this.LAYER_POINT,
					type: 'circle',
					source: this.SOURCE_ID,
					filter: [
						'all',
						['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
						['==', ['get', 'meta'], 'feature'],
						['!=', ['get', 'featureType'], 'annotation'],
					],
					paint: {
						'circle-radius': [
							'case',
							['==', ['get', 'active'], true],
							['+', ['coalesce', ['get', 'radius'], 6], 2],
							['coalesce', ['get', 'radius'], 6],
						],
						'circle-color': [
							'case',
							['==', ['get', 'active'], true],
							'#1d4ed8',
							['coalesce', ['get', 'color'], '#3bb2d0'],
						],
						'circle-stroke-width': [
							'case',
							['==', ['get', 'active'], true],
							3,
							['coalesce', ['get', 'strokeWidth'], 2],
						],
						'circle-stroke-color': [
							'case',
							['==', ['get', 'active'], true],
							'#93c5fd',
							['coalesce', ['get', 'strokeColor'], '#fff'],
						],
					},
				})
			}

			// 5b. Annotation anchor layer (small circle for click/drag interaction)
			if (!this.map.getLayer(this.LAYER_ANNOTATION_ANCHOR)) {
				this.map.addLayer({
					id: this.LAYER_ANNOTATION_ANCHOR,
					type: 'circle',
					source: this.SOURCE_ID,
					filter: [
						'all',
						['==', ['geometry-type'], 'Point'],
						['==', ['get', 'meta'], 'feature'],
						['==', ['get', 'featureType'], 'annotation'],
					],
					paint: {
						'circle-radius': ['case', ['==', ['get', 'active'], true], 6, 4],
						'circle-color': [
							'case',
							['==', ['get', 'active'], true],
							'#1d4ed8',
							'#f59e0b', // Amber color for annotations
						],
						'circle-stroke-width': 2,
						'circle-stroke-color': '#fff',
					},
				})
			}

			// 5c. Annotation text layer (symbol layer for text annotations)
			const annotationTextFont = this.getDefaultTextFontStack()
			if (!this.map.getLayer(this.LAYER_ANNOTATION)) {
				this.map.addLayer({
					id: this.LAYER_ANNOTATION,
					type: 'symbol',
					source: this.SOURCE_ID,
					filter: [
						'all',
						['==', ['geometry-type'], 'Point'],
						['==', ['get', 'meta'], 'feature'],
						['==', ['get', 'featureType'], 'annotation'],
					],
					layout: {
						'text-field': ['coalesce', ['get', 'text'], 'Annotation'],
						'text-font': annotationTextFont,
						'text-size': ['coalesce', ['get', 'textFontSize'], 14],
						'text-anchor': 'top',
						'text-offset': [0, 0.8],
						'text-allow-overlap': true,
						'text-ignore-placement': true,
					},
					paint: {
						'text-color': [
							'case',
							['==', ['get', 'active'], true],
							'#1d4ed8',
							['coalesce', ['get', 'textColor'], '#1f2937'],
						],
						'text-halo-color': [
							'case',
							['==', ['get', 'active'], true],
							'#93c5fd',
							['coalesce', ['get', 'textHaloColor'], '#ffffff'],
						],
						'text-halo-width': ['coalesce', ['get', 'textHaloWidth'], 1.5],
					},
				})
			}

			// 5d. Feature label layer (for non-annotation features with labels)
			if (!this.map.getLayer(this.LAYER_LABEL)) {
				this.map.addLayer({
					id: this.LAYER_LABEL,
					type: 'symbol',
					source: this.SOURCE_ID,
					filter: [
						'all',
						['==', ['get', 'meta'], 'feature'],
						['!=', ['get', 'featureType'], 'annotation'],
						['has', 'label'],
					],
					layout: {
						'text-field': ['get', 'label'],
						'text-font': annotationTextFont,
						'text-size': 12,
						'text-anchor': 'center',
						'text-allow-overlap': false,
						'text-ignore-placement': false,
					},
					paint: {
						'text-color': '#374151',
						'text-halo-color': '#ffffff',
						'text-halo-width': 1.5,
					},
				})
			}

			// 6. Selection point layer
			if (!this.map.getLayer(this.LAYER_SELECTION_POINT)) {
				this.map.addLayer({
					id: this.LAYER_SELECTION_POINT,
					type: 'circle',
					source: this.SOURCE_SELECTION,
					filter: [
						'any',
						['==', ['geometry-type'], 'Point'],
						['==', ['geometry-type'], 'MultiPoint'],
					],
					paint: {
						'circle-radius': 8,
						'circle-color': '#2563eb',
						'circle-opacity': 0.15,
						'circle-stroke-width': 2,
						'circle-stroke-color': '#2563eb',
					},
				})
			}

			// 7. Gizmo line layer
			if (!this.map.getLayer(this.LAYER_GIZMO_LINE)) {
				this.map.addLayer({
					id: this.LAYER_GIZMO_LINE,
					type: 'line',
					source: this.SOURCE_GIZMO,
					filter: ['==', ['get', 'meta'], 'gizmo-line'],
					paint: {
						'line-color': '#1d4ed8',
						'line-width': 2,
						'line-dasharray': ['literal', [1, 1]],
					},
				})
			}

			// 8. Gizmo center layer
			if (!this.map.getLayer(this.LAYER_GIZMO_CENTER)) {
				this.map.addLayer({
					id: this.LAYER_GIZMO_CENTER,
					type: 'circle',
					source: this.SOURCE_GIZMO,
					filter: ['==', ['get', 'meta'], 'gizmo-center'],
					paint: {
						'circle-radius': 6,
						'circle-color': '#1d4ed8',
						'circle-stroke-width': 2,
						'circle-stroke-color': '#93c5fd',
					},
				})
			}

			// 9. Gizmo rotate handle layer
			if (!this.map.getLayer(this.LAYER_GIZMO_ROTATE)) {
				this.map.addLayer({
					id: this.LAYER_GIZMO_ROTATE,
					type: 'circle',
					source: this.SOURCE_GIZMO,
					filter: ['==', ['get', 'meta'], 'gizmo-rotate'],
					paint: {
						'circle-radius': 8,
						'circle-color': '#f97316',
						'circle-stroke-width': 2,
						'circle-stroke-color': '#1d4ed8',
					},
				})
			}

			// 10. Gizmo move handle layer
			if (!this.map.getLayer(this.LAYER_GIZMO_MOVE)) {
				this.map.addLayer({
					id: this.LAYER_GIZMO_MOVE,
					type: 'circle',
					source: this.SOURCE_GIZMO,
					filter: ['==', ['get', 'meta'], 'gizmo-move'],
					paint: {
						'circle-radius': 7,
						'circle-color': '#22c55e',
						'circle-stroke-width': 2,
						'circle-stroke-color': '#166534',
					},
				})
			}

			// 11. Cursor indicator layer
			if (!this.map.getLayer(this.LAYER_CURSOR)) {
				this.map.addLayer({
					id: this.LAYER_CURSOR,
					type: 'circle',
					source: this.SOURCE_CURSOR,
					paint: {
						'circle-radius': 6,
						'circle-color': '#3b82f6',
						'circle-stroke-width': 2,
						'circle-stroke-color': '#fff',
					},
				})
			}

			// 12. Vertex layer (for edit mode)
			if (!this.map.getLayer(this.LAYER_VERTEX)) {
				this.map.addLayer({
					id: this.LAYER_VERTEX,
					type: 'circle',
					source: this.SOURCE_VERTICES,
					filter: ['==', ['get', 'meta'], 'vertex'],
					paint: {
						'circle-radius': ['case', ['==', ['get', 'selected'], true], 7, 5],
						'circle-color': [
							'case',
							['==', ['get', 'selected'], true],
							'#ef4444', // Red for selected
							'#fbb03b', // Orange for normal
						],
						'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 3, 2],
						'circle-stroke-color': '#fff',
					},
				})
			}

			// 13. Midpoint layer (for edit mode)
			if (!this.map.getLayer(this.LAYER_MIDPOINT)) {
				this.map.addLayer({
					id: this.LAYER_MIDPOINT,
					type: 'circle',
					source: this.SOURCE_VERTICES,
					filter: ['==', ['get', 'meta'], 'midpoint'],
					paint: {
						'circle-radius': 4,
						'circle-color': '#fff',
						'circle-stroke-width': 2,
						'circle-stroke-color': '#fbb03b',
					},
				})
			}

			// 14. Selection box layer (last so it renders on top during box selection)
			if (!this.map.getLayer(this.LAYER_SELECTION_BOX)) {
				this.map.addLayer({
					id: this.LAYER_SELECTION_BOX,
					type: 'fill',
					source: this.SOURCE_SELECTION_BOX,
					paint: {
						'fill-color': '#93c5fd',
						'fill-opacity': 0.15,
						'fill-outline-color': '#2563eb',
					},
				})
			}
		} catch (error) {
			console.warn('Failed to setup geo editor layers:', error)
		}
	}

	removeLayers(): void {
		try {
			// Remove layers in reverse order
			if (this.map.getLayer(this.LAYER_SELECTION_BOX))
				this.map.removeLayer(this.LAYER_SELECTION_BOX)
			if (this.map.getLayer(this.LAYER_MIDPOINT)) this.map.removeLayer(this.LAYER_MIDPOINT)
			if (this.map.getLayer(this.LAYER_VERTEX)) this.map.removeLayer(this.LAYER_VERTEX)
			if (this.map.getLayer(this.LAYER_CURSOR)) this.map.removeLayer(this.LAYER_CURSOR)
			if (this.map.getLayer(this.LAYER_GIZMO_MOVE)) this.map.removeLayer(this.LAYER_GIZMO_MOVE)
			if (this.map.getLayer(this.LAYER_GIZMO_ROTATE)) this.map.removeLayer(this.LAYER_GIZMO_ROTATE)
			if (this.map.getLayer(this.LAYER_GIZMO_CENTER)) this.map.removeLayer(this.LAYER_GIZMO_CENTER)
			if (this.map.getLayer(this.LAYER_GIZMO_LINE)) this.map.removeLayer(this.LAYER_GIZMO_LINE)
			if (this.map.getLayer(this.LAYER_SELECTION_POINT))
				this.map.removeLayer(this.LAYER_SELECTION_POINT)
			if (this.map.getLayer(this.LAYER_LABEL)) this.map.removeLayer(this.LAYER_LABEL)
			if (this.map.getLayer(this.LAYER_ANNOTATION)) this.map.removeLayer(this.LAYER_ANNOTATION)
			if (this.map.getLayer(this.LAYER_ANNOTATION_ANCHOR))
				this.map.removeLayer(this.LAYER_ANNOTATION_ANCHOR)
			if (this.map.getLayer(this.LAYER_POINT)) this.map.removeLayer(this.LAYER_POINT)
			if (this.map.getLayer(this.LAYER_SELECTION_LINE))
				this.map.removeLayer(this.LAYER_SELECTION_LINE)
			if (this.map.getLayer(this.LAYER_LINE)) this.map.removeLayer(this.LAYER_LINE)
			if (this.map.getLayer(this.LAYER_SELECTION_FILL))
				this.map.removeLayer(this.LAYER_SELECTION_FILL)
			if (this.map.getLayer(this.LAYER_FILL)) this.map.removeLayer(this.LAYER_FILL)

			// Remove sources
			if (this.map.getSource(this.SOURCE_ID)) this.map.removeSource(this.SOURCE_ID)
			if (this.map.getSource(this.SOURCE_VERTICES)) this.map.removeSource(this.SOURCE_VERTICES)
			if (this.map.getSource(this.SOURCE_SELECTION)) this.map.removeSource(this.SOURCE_SELECTION)
			if (this.map.getSource(this.SOURCE_SELECTION_BOX))
				this.map.removeSource(this.SOURCE_SELECTION_BOX)
			if (this.map.getSource(this.SOURCE_CURSOR)) this.map.removeSource(this.SOURCE_CURSOR)
			if (this.map.getSource(this.SOURCE_GIZMO)) this.map.removeSource(this.SOURCE_GIZMO)
		} catch {
			// Map may have been removed during source switch
		}
	}
}
