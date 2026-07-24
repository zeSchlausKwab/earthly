import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { EditorFeature, EditorMode } from '../types'
import type { LayerManager } from './LayerManager'

interface ScreenPoint {
	x: number
	y: number
}

interface SelectionDragState {
	start: ScreenPoint
	current: ScreenPoint
	hasMoved: boolean
}

/**
 * RenderingManager handles all MapLibre source data updates for the GeoEditor.
 * This includes rendering features, selection indicators, gizmos, vertices, etc.
 */
export class RenderingManager {
	private map!: MapLibreMap
	private layers!: LayerManager

	onAdd(map: MapLibreMap, layers: LayerManager): void {
		this.map = map
		this.layers = layers
	}

	onRemove(): void {
		// Cleanup handled by GeoEditor.destroy()
	}

	/**
	 * Main render method - updates the feature collection source
	 */
	render(featureCollection: FeatureCollection): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_ID)
		if (source) {
			source.setData(featureCollection)
		}
	}

	/**
	 * Render the selection indicator overlay
	 */
	renderSelectionIndicator(selectedFeatures: EditorFeature[]): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_SELECTION)
		if (!source) return

		const highlightFeatures: Feature[] = selectedFeatures.map((feature) => ({
			type: 'Feature',
			id: `${feature.id}-selection`,
			geometry: JSON.parse(JSON.stringify(feature.geometry)) as Geometry,
			properties: {
				featureId: feature.id,
			},
		}))

		source.setData({
			type: 'FeatureCollection',
			features: highlightFeatures,
		})
	}

	/**
	 * Render the transform gizmo (rotate/move/scale handles)
	 */
	renderGizmo(
		mode: EditorMode,
		currentCenter: Position | null,
		transformDragCenter?: Position | null,
	): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_GIZMO)
		if (!source) return

		if (mode !== 'select') {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const center = transformDragCenter || currentCenter
		if (!center) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const rotateHandle = this.getRotationHandlePosition(center)
		const moveHandle = this.getMoveHandlePosition(center)
		const scaleHandle = this.getScaleHandlePosition(center)

		source.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [center, rotateHandle],
					},
					properties: { meta: 'gizmo-line' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [center, moveHandle],
					},
					properties: { meta: 'gizmo-line' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [center, scaleHandle],
					},
					properties: { meta: 'gizmo-line' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: center,
					},
					properties: { meta: 'gizmo-center' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: rotateHandle,
					},
					properties: { meta: 'gizmo-rotate' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: moveHandle,
					},
					properties: { meta: 'gizmo-move' },
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: scaleHandle,
					},
					properties: { meta: 'gizmo-scale' },
				},
			],
		})
	}

	/**
	 * Render the selection box (for box selection)
	 */
	renderSelectionBox(selectionDragState?: SelectionDragState): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_SELECTION_BOX)
		if (!source) return

		if (!selectionDragState || !selectionDragState.hasMoved) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const minX = Math.min(selectionDragState.start.x, selectionDragState.current.x)
		const minY = Math.min(selectionDragState.start.y, selectionDragState.current.y)
		const maxX = Math.max(selectionDragState.start.x, selectionDragState.current.x)
		const maxY = Math.max(selectionDragState.start.y, selectionDragState.current.y)

		const nw = this.map.unproject([minX, minY])
		const ne = this.map.unproject([maxX, minY])
		const se = this.map.unproject([maxX, maxY])
		const sw = this.map.unproject([minX, maxY])

		const polygon: Position[] = [
			[nw.lng, nw.lat],
			[ne.lng, ne.lat],
			[se.lng, se.lat],
			[sw.lng, sw.lat],
			[nw.lng, nw.lat],
		]

		source.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: {
						type: 'Polygon',
						coordinates: [polygon],
					},
					properties: {},
				},
			],
		})
	}

	/**
	 * Render vertices and midpoints for edit mode
	 */
	renderVertices(
		mode: EditorMode,
		allFeatures: EditorFeature[],
		extractVerticesWithPaths: (
			feature: EditorFeature,
		) => Array<{ position: Position; path: number[] }>,
		extractMidpoints: (feature: EditorFeature) => Array<{ position: Position; path: number[] }>,
		selectedVertex?: { featureId: string; coordinatePath: number[] },
	): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_VERTICES)
		if (!source) return

		if (mode !== 'edit') {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const vertexFeatures: Feature[] = []

		allFeatures.forEach((feature) => {
			// Add vertices
			const vertices = extractVerticesWithPaths(feature)
			vertices.forEach(({ position, path }) => {
				const isSelected =
					selectedVertex &&
					selectedVertex.featureId === feature.id &&
					JSON.stringify(selectedVertex.coordinatePath) === JSON.stringify(path)

				vertexFeatures.push({
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: position,
					},
					properties: {
						meta: 'vertex',
						featureId: feature.id,
						path: JSON.stringify(path),
						selected: isSelected ? true : undefined,
					},
				})
			})

			// Add midpoints
			const midpoints = extractMidpoints(feature)
			midpoints.forEach(({ position, path }) => {
				vertexFeatures.push({
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: position,
					},
					properties: {
						meta: 'midpoint',
						featureId: feature.id,
						path: JSON.stringify(path),
					},
				})
			})
		})

		source.setData({
			type: 'FeatureCollection',
			features: vertexFeatures,
		})
	}

	/**
	 * Update the cursor indicator position (for draw modes)
	 */
	updateCursorIndicator(position?: Position, shouldShow: boolean = false): void {
		const source = this.layers.getGeoJSONSource(this.layers.SOURCE_CURSOR)
		if (!source) return

		if (position && position[0] !== undefined && position[1] !== undefined && shouldShow) {
			source.setData({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: {
							type: 'Point',
							coordinates: position,
						},
						properties: {},
					},
				],
			})
		} else {
			source.setData({ type: 'FeatureCollection', features: [] })
		}
	}

	private getRotationHandlePosition(center: Position): Position {
		if (!this.map) return center
		const lng = center[0] ?? 0
		const lat = center[1] ?? 0
		const projected = this.map.project({ lng, lat })
		const handlePoint = this.map.unproject([projected.x, projected.y - 60])
		return [handlePoint.lng, handlePoint.lat]
	}

	private getMoveHandlePosition(center: Position): Position {
		if (!this.map) return center
		const lng = center[0] ?? 0
		const lat = center[1] ?? 0
		const projected = this.map.project({ lng, lat })
		const handlePoint = this.map.unproject([projected.x + 60, projected.y])
		return [handlePoint.lng, handlePoint.lat]
	}

	private getScaleHandlePosition(center: Position): Position {
		if (!this.map) return center
		const lng = center[0] ?? 0
		const lat = center[1] ?? 0
		const projected = this.map.project({ lng, lat })
		const handlePoint = this.map.unproject([projected.x + 48, projected.y + 48])
		return [handlePoint.lng, handlePoint.lat]
	}
}
