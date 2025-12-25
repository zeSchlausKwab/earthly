import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type {
	GeoJSONSource,
	MapGeoJSONFeature,
	Map as MapLibreMap,
	MapMouseEvent,
	MapTouchEvent
} from 'maplibre-gl'
import { HistoryManager } from './managers/HistoryManager'
import { SelectionManager } from './managers/SelectionManager'
import { SnapManager } from './managers/SnapManager'
import { TransformManager } from './managers/TransformManager'
import { DrawLineStringMode, DrawPointMode, DrawPolygonMode } from './modes/DrawMode'
import { EditMode } from './modes/EditMode'
import type {
	EditorEvent,
	EditorEventHandler,
	EditorEventType,
	EditorFeature,
	EditorMode,
	GeoEditorOptions
} from './types'
import { generateId } from './utils/geometry'

type ScreenPoint = { x: number; y: number }
type PointerOffset = { x: number; y: number }

interface SelectionDragState {
	start: ScreenPoint
	current: ScreenPoint
	hasMoved: boolean
}

type TransformDragType = 'rotate' | 'move'

interface TransformDragState {
	type: TransformDragType
	center: Position
	startPointer: Position
	startBearing?: number
	baseFeatures: EditorFeature[]
	lastFeatures?: EditorFeature[]
	dragPanWasEnabled: boolean
}

export class GeoEditor {
	private map: MapLibreMap
	private options: Required<GeoEditorOptions>
	private mode: EditorMode = 'static'
	private features: Map<string, EditorFeature> = new Map()
	private eventHandlers: Map<EditorEventType, Set<EditorEventHandler>> = new Map()

	// Managers
	public history: HistoryManager
	public snap: SnapManager
	public selection: SelectionManager
	public transform: TransformManager

	// Modes
	private drawPointMode: DrawPointMode
	private drawLineMode: DrawLineStringMode
	private drawPolygonMode: DrawPolygonMode
	private editMode: EditMode
	private doubleClickZoomDisabled: boolean = false

	// Layer IDs
	private readonly LAYER_LINE = 'geo-editor-line'
	private readonly LAYER_FILL = 'geo-editor-fill'
	private readonly LAYER_POINT = 'geo-editor-point'
	private readonly LAYER_VERTEX = 'geo-editor-vertex'
	private readonly LAYER_MIDPOINT = 'geo-editor-midpoint'
	private readonly LAYER_SELECTION_FILL = 'geo-editor-selection-fill'
	private readonly LAYER_SELECTION_LINE = 'geo-editor-selection-line'
	private readonly LAYER_SELECTION_POINT = 'geo-editor-selection-point'
	private readonly LAYER_SELECTION_BOX = 'geo-editor-selection-box'
	private readonly LAYER_GIZMO_LINE = 'geo-editor-gizmo-line'
	private readonly LAYER_GIZMO_CENTER = 'geo-editor-gizmo-center'
	private readonly LAYER_GIZMO_ROTATE = 'geo-editor-gizmo-rotate'
	private readonly LAYER_GIZMO_MOVE = 'geo-editor-gizmo-move'
	private readonly LAYER_CURSOR = 'geo-editor-cursor'
	private readonly SOURCE_ID = 'geo-editor'
	private readonly SOURCE_VERTICES = 'geo-editor-vertices'
	private readonly SOURCE_SELECTION = 'geo-editor-selection'
	private readonly SOURCE_SELECTION_BOX = 'geo-editor-selection-box'
	private readonly SOURCE_CURSOR = 'geo-editor-cursor'
	private readonly SOURCE_GIZMO = 'geo-editor-gizmo'
	private selectionDragState?: SelectionDragState
	private selectionDragPanWasEnabled: boolean = true
	private skipClickUntil: number = 0
	private transformDragState?: TransformDragState
	private pointerOffset: PointerOffset
	private panLockEnabled: boolean = false
	private panLockDragPanWasEnabled: boolean = false
	private touchDrawInProgress: boolean = false
	private lastTouchPoint?: ScreenPoint
	private readonly DRAW_MIN_LINE_POINTS = 2
	private readonly DRAW_MIN_POLYGON_POINTS = 3
	private readonly keyDownHandler = this.onKeyDown.bind(this)
	private readonly keyUpHandler = this.onKeyUp.bind(this)
	private readonly gizmoRenderHandler = () => this.renderGizmo()
	private readonly multiSelectModifier: 'ctrl' | 'shift'

	constructor(map: MapLibreMap, options: GeoEditorOptions = {}) {
		this.map = map
		this.multiSelectModifier = this.detectMultiSelectModifier()
		this.options = {
			modes: options.modes || ['draw_point', 'draw_linestring', 'draw_polygon', 'edit', 'select'],
			defaultMode: options.defaultMode || 'static',
			features: options.features || ['Point', 'LineString', 'Polygon'],
			snapping: options.snapping ?? true,
			snapDistance: options.snapDistance || 10,
			snapToVertices: options.snapToVertices ?? true,
			snapToEdges: options.snapToEdges ?? true,
			styles: options.styles || {},
			displayControlsDefault: options.displayControlsDefault ?? true,
			touchEnabled: options.touchEnabled ?? true,
			boxSelect: options.boxSelect ?? true,
			clickTolerance: options.clickTolerance || 2,
			pointerOffsetPx: options.pointerOffsetPx ?? { x: 0, y: -44 }
		}
		this.pointerOffset = this.options.pointerOffsetPx

		// Initialize managers
		this.history = new HistoryManager()
		this.snap = new SnapManager(
			this.options.snapDistance,
			this.options.snapToVertices,
			this.options.snapToEdges
		)
		this.selection = new SelectionManager()
		this.transform = new TransformManager()

		// Initialize modes
		this.drawPointMode = new DrawPointMode()
		this.drawLineMode = new DrawLineStringMode()
		this.drawPolygonMode = new DrawPolygonMode()
		this.editMode = new EditMode()

		this.initialize()
	}

	private initialize(): void {
		// Add managers to map
		this.history.onAdd(this.map)
		this.snap.onAdd(this.map)
		this.selection.onAdd(this.map)
		this.transform.onAdd(this.map)

		// Add modes
		this.drawPointMode.onAdd(this.map)
		this.drawLineMode.onAdd(this.map)
		this.drawPolygonMode.onAdd(this.map)
		this.editMode.onAdd(this.map)

		// Setup map layers and sources - ensure style is loaded
		if (this.map.isStyleLoaded()) {
			this.setupLayers()
		} else {
			this.map.once('styledata', () => {
				this.setupLayers()
			})
		}

		// Re-add layers when style changes (e.g. switching basemaps)
		this.map.on('styledata', () => {
			this.setupLayers()
		})

		// Setup event listeners
		this.setupEventListeners()

		// Set initial mode
		this.setMode(this.options.defaultMode)
	}

	private setupLayers(): void {
		// Add main feature source
		if (!this.map.getSource(this.SOURCE_ID)) {
			this.map.addSource(this.SOURCE_ID, {
				type: 'geojson',
				data: this.getFeatureCollection()
			})
		}

		// Add vertices source for edit mode
		if (!this.map.getSource(this.SOURCE_VERTICES)) {
			this.map.addSource(this.SOURCE_VERTICES, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			})
		}
		if (!this.map.getSource(this.SOURCE_SELECTION)) {
			this.map.addSource(this.SOURCE_SELECTION, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			})
		}
		if (!this.map.getSource(this.SOURCE_SELECTION_BOX)) {
			this.map.addSource(this.SOURCE_SELECTION_BOX, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			})
		}
		if (!this.map.getSource(this.SOURCE_GIZMO)) {
			this.map.addSource(this.SOURCE_GIZMO, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			})
		}
		if (!this.map.getSource(this.SOURCE_CURSOR)) {
			this.map.addSource(this.SOURCE_CURSOR, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			})
		}

		// Add polygon fill layer
		if (!this.map.getLayer(this.LAYER_FILL)) {
			this.map.addLayer({
				id: this.LAYER_FILL,
				type: 'fill',
				source: this.SOURCE_ID,
				filter: [
					'all',
					['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
					['any', ['==', ['get', 'meta'], 'feature'], ['==', ['get', 'meta'], 'feature-temp']]
				],
				paint: {
					'fill-color': ['case', ['==', ['get', 'active'], true], '#fbb03b', '#3bb2d0'],
					'fill-opacity': ['case', ['==', ['get', 'meta'], 'feature-temp'], 0.2, 0.3],
					'fill-outline-color': ['case', ['==', ['get', 'active'], true], '#1d4ed8', '#1f2937']
				}
			})
		}
		if (!this.map.getLayer(this.LAYER_SELECTION_FILL)) {
			this.map.addLayer({
				id: this.LAYER_SELECTION_FILL,
				type: 'fill',
				source: this.SOURCE_SELECTION,
				filter: [
					'any',
					['==', ['geometry-type'], 'Polygon'],
					['==', ['geometry-type'], 'MultiPolygon']
				],
				paint: {
					'fill-color': '#2563eb',
					'fill-opacity': 0.2
				}
			})
		}

		// Add line layer with dashed pattern for edit mode
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
						['==', ['geometry-type'], 'MultiPolygon']
					],
					['any', ['==', ['get', 'meta'], 'feature'], ['==', ['get', 'meta'], 'feature-temp']]
				],
				paint: {
					'line-color': ['case', ['==', ['get', 'active'], true], '#1d4ed8', '#3bb2d0'],
					'line-width': ['case', ['==', ['get', 'active'], true], 4, 2],
					'line-dasharray': [
						'case',
						['==', ['get', 'active'], true],
						['literal', [2, 2]],
						['literal', [1, 0]]
					]
				}
			})
		}
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
					['==', ['geometry-type'], 'MultiPolygon']
				],
				paint: {
					'line-color': '#2563eb',
					'line-width': 3,
					'line-dasharray': ['literal', [2, 2]]
				}
			})
		}

		// Add point layer
		if (!this.map.getLayer(this.LAYER_POINT)) {
			this.map.addLayer({
				id: this.LAYER_POINT,
				type: 'circle',
				source: this.SOURCE_ID,
				filter: [
					'all',
					['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
					['==', ['get', 'meta'], 'feature']
				],
				paint: {
					'circle-radius': ['case', ['==', ['get', 'active'], true], 8, 6],
					'circle-color': ['case', ['==', ['get', 'active'], true], '#1d4ed8', '#3bb2d0'],
					'circle-stroke-width': ['case', ['==', ['get', 'active'], true], 3, 2],
					'circle-stroke-color': ['case', ['==', ['get', 'active'], true], '#93c5fd', '#fff']
				}
			})
		}
		if (!this.map.getLayer(this.LAYER_SELECTION_POINT)) {
			this.map.addLayer({
				id: this.LAYER_SELECTION_POINT,
				type: 'circle',
				source: this.SOURCE_SELECTION,
				filter: [
					'any',
					['==', ['geometry-type'], 'Point'],
					['==', ['geometry-type'], 'MultiPoint']
				],
				paint: {
					'circle-radius': 8,
					'circle-color': '#2563eb',
					'circle-opacity': 0.15,
					'circle-stroke-width': 2,
					'circle-stroke-color': '#2563eb'
				}
			})
		}
		if (!this.map.getLayer(this.LAYER_GIZMO_LINE)) {
			this.map.addLayer({
				id: this.LAYER_GIZMO_LINE,
				type: 'line',
				source: this.SOURCE_GIZMO,
				filter: ['==', ['get', 'meta'], 'gizmo-line'],
				paint: {
					'line-color': '#1d4ed8',
					'line-width': 2,
					'line-dasharray': ['literal', [1, 1]]
				}
			})
		}
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
					'circle-stroke-color': '#93c5fd'
				}
			})
		}
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
					'circle-stroke-color': '#1d4ed8'
				}
			})
		}
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
					'circle-stroke-color': '#166534'
				}
			})
		}
		if (!this.map.getLayer(this.LAYER_CURSOR)) {
			this.map.addLayer({
				id: this.LAYER_CURSOR,
				type: 'circle',
				source: this.SOURCE_CURSOR,
				paint: {
					'circle-radius': 6,
					'circle-color': '#3b82f6',
					'circle-stroke-width': 2,
					'circle-stroke-color': '#fff'
				}
			})
		}

		// Add vertex layer (for edit mode)
		if (!this.map.getLayer(this.LAYER_VERTEX)) {
			this.map.addLayer({
				id: this.LAYER_VERTEX,
				type: 'circle',
				source: this.SOURCE_VERTICES,
				filter: ['==', ['get', 'meta'], 'vertex'],
				paint: {
					'circle-radius': 5,
					'circle-color': '#fbb03b',
					'circle-stroke-width': 2,
					'circle-stroke-color': '#fff'
				}
			})
		}

		// Add midpoint layer (for edit mode)
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
					'circle-stroke-color': '#fbb03b'
				}
			})
		}
		if (!this.map.getLayer(this.LAYER_SELECTION_BOX)) {
			this.map.addLayer({
				id: this.LAYER_SELECTION_BOX,
				type: 'fill',
				source: this.SOURCE_SELECTION_BOX,
				paint: {
					'fill-color': '#93c5fd',
					'fill-opacity': 0.15,
					'fill-outline-color': '#2563eb'
				}
			})
		}
	}

	private setupEventListeners(): void {
		this.map.on('click', this.onClick.bind(this))
		this.map.on('dblclick', this.onDoubleClick.bind(this))
		this.map.on('mousemove', this.onMouseMove.bind(this))
		this.map.on('mousedown', this.onMouseDown.bind(this))
		this.map.on('mouseup', this.onMouseUp.bind(this))
		this.map.on('touchstart', this.onTouchStart.bind(this))
		this.map.on('touchmove', this.onTouchMove.bind(this))
		this.map.on('touchend', this.onTouchEnd.bind(this))
		this.map.on('contextmenu', this.onContextMenu.bind(this))
		this.map.on('move', this.gizmoRenderHandler)

		// Keyboard events
		window.addEventListener('keydown', this.keyDownHandler)
		window.addEventListener('keyup', this.keyUpHandler)

		// Set cursor style on hover - moved here to avoid duplication
		this.map.on('mouseenter', this.LAYER_VERTEX, () => {
			this.map.getCanvas().style.cursor = 'move'
		})
		this.map.on('mouseleave', this.LAYER_VERTEX, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.LAYER_MIDPOINT, () => {
			this.map.getCanvas().style.cursor = 'pointer'
		})
		this.map.on('mouseleave', this.LAYER_MIDPOINT, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.LAYER_GIZMO_ROTATE, () => {
			this.map.getCanvas().style.cursor = 'crosshair'
		})
		this.map.on('mouseleave', this.LAYER_GIZMO_ROTATE, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.LAYER_GIZMO_MOVE, () => {
			this.map.getCanvas().style.cursor = 'move'
		})
		this.map.on('mouseleave', this.LAYER_GIZMO_MOVE, () => {
			this.map.getCanvas().style.cursor = ''
		})
	}

	private onClick(e: MapMouseEvent): void {
		if (this.skipClickUntil && Date.now() < this.skipClickUntil) {
			return
		}
		this.skipClickUntil = 0

		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) {
			// Touch drawing disabled when pan is unlocked
			return
		}

		const { position: clickPoint } = this.getAdjustedPointerPosition(e)
		e.lngLat.lng = clickPoint[0]
		e.lngLat.lat = clickPoint[1]

		if (this.mode === 'draw_point') {
			const feature = this.drawPointMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
		} else if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		} else if (this.mode === 'select') {
			if (!this.map.getLayer(this.LAYER_FILL)) return
			const features = this.map.queryRenderedFeatures(e.point, {
				layers: [this.LAYER_FILL, this.LAYER_LINE, this.LAYER_POINT]
			})

			if (features.length > 0) {
				const featureId = this.getRenderedFeatureId(features[0])
				if (!featureId) {
					return
				}
				if (!this.isMultiSelectEvent(e.originalEvent)) {
					this.selection.clearSelection()
				}
				this.selection.toggleSelect(featureId)
				this.updateActiveStates()
				this.emit('selection.change', {
					type: 'selection.change',
					features: this.getSelectedFeatures()
				})
			} else if (!this.isMultiSelectEvent(e.originalEvent)) {
				this.selection.clearSelection()
				this.updateActiveStates()
				this.emit('selection.change', {
					type: 'selection.change',
					features: []
				})
			}
		} else if (this.mode === 'edit') {
			// Handle vertex and midpoint clicks in edit mode
			if (!this.map.getLayer(this.LAYER_VERTEX)) return
			const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
				layers: [this.LAYER_VERTEX, this.LAYER_MIDPOINT]
			})

			if (vertexFeatures.length > 0) {
				const vertex = vertexFeatures[0]
				const meta = vertex.properties?.meta

				if (meta === 'midpoint') {
					// Insert new vertex at midpoint
					const featureId = vertex.properties?.featureId as string
					const path = JSON.parse(vertex.properties?.path as string)
					const feature = this.features.get(featureId)

					if (feature) {
						const updated = this.editMode.insertVertex(feature, path, clickPoint)
						this.updateFeature(featureId, updated)
						this.renderVertices()
					}
				}
			} else {
				// Select feature for editing
				if (!this.map.getLayer(this.LAYER_FILL)) return
				const features = this.map.queryRenderedFeatures(e.point, {
					layers: [this.LAYER_FILL, this.LAYER_LINE, this.LAYER_POINT]
				})

				if (features.length > 0) {
					const featureId = this.getRenderedFeatureId(features[0])
					if (!featureId) {
						return
					}
					if (!this.isMultiSelectEvent(e.originalEvent)) {
						this.selection.clearSelection()
					}
					this.selection.toggleSelect(featureId)
					this.updateActiveStates()
					this.renderVertices()
				} else if (!this.isMultiSelectEvent(e.originalEvent)) {
					this.selection.clearSelection()
					this.updateActiveStates()
					this.renderVertices()
				}
			}
		}
	}

	private onMouseDown(e: MapMouseEvent): void {
		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) {
			// Allow panning; do not start drawing
			return
		}

		if (this.mode === 'select') {
			if (this.tryStartTransformDrag(e)) {
				return
			}
			if (this.isMultiSelectEvent(e.originalEvent) && e.originalEvent.button === 0) {
				this.startSelectionDrag(e)
			}
			return
		}

		if (this.mode !== 'edit') return

		if (!this.map.getLayer(this.LAYER_VERTEX)) return
		const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
			layers: [this.LAYER_VERTEX]
		})

		if (vertexFeatures.length > 0) {
			const vertex = vertexFeatures[0]
			const featureId = vertex.properties?.featureId as string
			const path = JSON.parse(vertex.properties?.path as string)

			this.editMode.setDraggingVertex(featureId, path, [e.lngLat.lng, e.lngLat.lat])
			this.map.getCanvas().style.cursor = 'grabbing'
			e.preventDefault()
		}
	}

	private onMouseUp(_e: MapMouseEvent): void {
		if (this.transformDragState) {
			this.finishTransformDrag(true)
			return
		}

		if (this.isTouchLikeEvent(_e as any) && this.isDrawMode(this.mode) && !this.panLockEnabled) {
			return
		}

		if (this.mode === 'select') {
			if (this.selectionDragState) {
				this.completeSelectionDrag()
			}
			return
		}

		if (this.mode !== 'edit') return

		const state = this.editMode.getState()
		if (state.draggingVertex) {
			this.editMode.clearDragging()
			this.map.getCanvas().style.cursor = ''
		}
	}

	private onTouchStart(e: MapTouchEvent): void {
		this.touchDrawInProgress = false
		this.lastTouchPoint = { x: e.point.x, y: e.point.y }
		this.onMouseDown(e as unknown as MapMouseEvent)
	}

	private onTouchMove(e: MapTouchEvent): void {
		this.touchDrawInProgress = true
		this.lastTouchPoint = { x: e.point.x, y: e.point.y }
		this.onMouseMove(e as unknown as MapMouseEvent)
	}

	private onTouchEnd(e: MapTouchEvent): void {
		if (
			this.touchDrawInProgress &&
			this.lastTouchPoint &&
			this.panLockEnabled &&
			this.isDrawMode(this.mode)
		) {
			const position = this.getAdjustedPositionFromScreenPoint(this.lastTouchPoint)
			this.handleDrawRelease(position)
		}
		this.touchDrawInProgress = false
		this.lastTouchPoint = undefined
		this.onMouseUp(e as unknown as MapMouseEvent)
	}

	private startSelectionDrag(e: MapMouseEvent): void {
		if (this.selectionDragState) return

		this.selectionDragState = {
			start: { x: e.point.x, y: e.point.y },
			current: { x: e.point.x, y: e.point.y },
			hasMoved: false
		}

		this.selectionDragPanWasEnabled = this.map.dragPan.isEnabled()
		if (this.selectionDragPanWasEnabled) {
			this.map.dragPan.disable()
		}

		this.renderSelectionBox()
	}

	private updateSelectionDrag(e: MapMouseEvent): void {
		if (!this.selectionDragState) return

		this.selectionDragState.current = { x: e.point.x, y: e.point.y }

		if (!this.selectionDragState.hasMoved) {
			const dx = Math.abs(this.selectionDragState.current.x - this.selectionDragState.start.x)
			const dy = Math.abs(this.selectionDragState.current.y - this.selectionDragState.start.y)
			if (dx > 3 || dy > 3) {
				this.selectionDragState.hasMoved = true
			}
		}

		this.renderSelectionBox()
	}

	private completeSelectionDrag(cancel: boolean = false): void {
		if (!this.selectionDragState) return

		const state = this.selectionDragState
		this.selectionDragState = undefined

		if (this.selectionDragPanWasEnabled) {
			this.map.dragPan.enable()
		}

		const shouldSkipClick = state.hasMoved && !cancel
		this.skipClickUntil = shouldSkipClick ? Date.now() + 100 : 0

		this.renderSelectionBox()

		if (cancel || !state.hasMoved) {
			return
		}

		const minX = Math.min(state.start.x, state.current.x)
		const minY = Math.min(state.start.y, state.current.y)
		const maxX = Math.max(state.start.x, state.current.x)
		const maxY = Math.max(state.start.y, state.current.y)

		if (!this.map.getLayer(this.LAYER_FILL)) return
		const queriedFeatures = this.map.queryRenderedFeatures(
			[
				[minX, minY],
				[maxX, maxY]
			],
			{
				layers: [this.LAYER_FILL, this.LAYER_LINE, this.LAYER_POINT]
			}
		)

		const featureIds = Array.from(
			new Set(
				queriedFeatures
					.filter((feature) => feature.properties?.meta === 'feature')
					.map((feature) => this.getRenderedFeatureId(feature))
					.filter((id): id is string => typeof id === 'string' && id.length > 0)
			)
		)

		if (featureIds.length > 0) {
			this.selection.select(featureIds)
			this.updateActiveStates()
			this.emit('selection.change', {
				type: 'selection.change',
				features: this.getSelectedFeatures()
			})
		}
	}

	private tryStartTransformDrag(e: MapMouseEvent): boolean {
		if (this.mode !== 'select') return false
		const gizmoFeatures = this.map.queryRenderedFeatures(e.point, {
			layers: [this.LAYER_GIZMO_ROTATE, this.LAYER_GIZMO_MOVE]
		})

		if (gizmoFeatures.length === 0) {
			return false
		}

		const meta = gizmoFeatures[0].properties?.meta
		const pointer: Position = [e.lngLat.lng, e.lngLat.lat]

		if (meta === 'gizmo-rotate') {
			this.startTransformDrag('rotate', pointer)
			e.preventDefault()
			return true
		}
		if (meta === 'gizmo-move') {
			this.startTransformDrag('move', pointer)
			e.preventDefault()
			return true
		}
		return false
	}

	private startTransformDrag(type: TransformDragType, pointer: Position): void {
		const selected = this.getSelectedFeatures()
		if (selected.length === 0) return
		const center = this.getSelectionCentroid(selected)
		if (!center) return

		const baseFeatures = selected.map((feature) => this.cloneFeature(feature))
		const dragPanWasEnabled = this.map.dragPan.isEnabled()
		if (dragPanWasEnabled) {
			this.map.dragPan.disable()
		}

		this.transformDragState = {
			type,
			center,
			startPointer: pointer,
			startBearing: type === 'rotate' ? turf.bearing(center, pointer) : undefined,
			baseFeatures,
			dragPanWasEnabled
		}
		this.map.getCanvas().style.cursor = 'grabbing'
	}

	private handleTransformDrag(e: MapMouseEvent): void {
		if (!this.transformDragState) return
		const pointer: Position = [e.lngLat.lng, e.lngLat.lat]
		this.updateTransformDrag(pointer)
		e.preventDefault()
	}

	private updateTransformDrag(pointer: Position): void {
		const state = this.transformDragState
		if (!state) return

		let updatedFeatures: EditorFeature[] = []

		if (state.type === 'rotate') {
			const startBearing = state.startBearing ?? turf.bearing(state.center, state.startPointer)
			const currentBearing = turf.bearing(state.center, pointer)
			const angleDelta = currentBearing - startBearing
			updatedFeatures = state.baseFeatures.map((feature) =>
				this.transform.rotate(feature, {
					center: state.center,
					angle: angleDelta
				})
			)
		} else {
			updatedFeatures = state.baseFeatures.map((feature) =>
				this.transform.move(feature, state.startPointer, pointer)
			)
		}

		updatedFeatures = updatedFeatures.map((feature) => this.normalizeFeature(feature))
		updatedFeatures.forEach((feature) => {
			this.features.set(feature.id, feature)
		})

		state.lastFeatures = updatedFeatures

		if (state.type === 'move') {
			const newCenter = this.getSelectionCentroid(updatedFeatures)
			if (newCenter) {
				state.center = newCenter
			}
		}

		this.render()
	}

	private finishTransformDrag(commit: boolean): void {
		const state = this.transformDragState
		if (!state) return

		this.transformDragState = undefined
		if (state.dragPanWasEnabled) {
			this.map.dragPan.enable()
		}
		this.map.getCanvas().style.cursor = ''

		if (commit && state.lastFeatures && state.lastFeatures.length > 0) {
			this.history.recordUpdate(state.lastFeatures, state.baseFeatures)
			this.emit('update', { type: 'update', features: state.lastFeatures })
			this.render()
		} else if (!commit) {
			state.baseFeatures.forEach((feature) => {
				this.features.set(feature.id, feature)
			})
			this.render()
		} else {
			this.renderGizmo()
		}
	}

	private onDoubleClick(_e: MapMouseEvent): void {
		// Finalize line or polygon drawing on double-click
		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onKeyDown({
				key: 'Enter'
			} as KeyboardEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				this.render()
			}
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onKeyDown({
				key: 'Enter'
			} as KeyboardEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				this.render()
			}
		}
	}

	private onMouseMove(e: MapMouseEvent): void {
		if (this.transformDragState) {
			this.handleTransformDrag(e)
			return
		}

		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) {
			return
		}

		if (this.mode === 'select') {
			if (this.selectionDragState) {
				this.updateSelectionDrag(e)
			}
			return
		}

		if (this.shouldShowCursorIndicator()) {
			const { position } = this.getAdjustedPointerPosition(e)
			this.updateCursorIndicator(position)
			if (this.mode === 'draw_linestring' || this.mode === 'draw_polygon') {
				e.lngLat.lng = position[0]
				e.lngLat.lat = position[1]
			}
		} else {
			this.updateCursorIndicator()
		}

		if (this.mode === 'draw_linestring') {
			this.drawLineMode.onMove(e)
			this.render()
		} else if (this.mode === 'draw_polygon') {
			this.drawPolygonMode.onMove(e)
			this.render()
		} else if (this.mode === 'edit') {
			const state = this.editMode.getState()
			if (state.draggingVertex) {
				const { featureId, coordinatePath } = state.draggingVertex
				const feature = this.features.get(featureId)

				if (feature) {
					const lngLat: Position = [e.lngLat.lng, e.lngLat.lat]
					const snapResult = this.snap.snap(lngLat, this.getSnappableFeatures(), [featureId])
					const newPosition = snapResult.snapped ? snapResult.point : lngLat

					const updated = this.editMode.updateVertexPosition(feature, coordinatePath, newPosition)
					this.features.set(featureId, updated)
					this.render()
					this.renderVertices()
				}
			}
		}
	}

	private onContextMenu(e: MapMouseEvent): void {
		e.preventDefault()

		// In edit mode, right-click on vertex deletes it
		if (this.mode === 'edit') {
			const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
				layers: [this.LAYER_VERTEX]
			})

			if (vertexFeatures.length > 0) {
				const vertex = vertexFeatures[0]
				const featureId = vertex.properties?.featureId as string
				const path = JSON.parse(vertex.properties?.path as string)
				const feature = this.features.get(featureId)

				if (feature) {
					const updated = this.editMode.removeVertex(feature, path)
					if (updated) {
						this.updateFeature(featureId, updated)
						this.renderVertices()
					}
				}
			}
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && this.transformDragState) {
			e.preventDefault()
			this.finishTransformDrag(false)
			return
		}

		// Handle undo/redo
		if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
			e.preventDefault()
			if (e.shiftKey) {
				this.redo()
			} else {
				this.undo()
			}
			return
		}

		// Handle delete
		if (
			e.key === 'Delete' ||
			(e.key === 'Backspace' && (this.mode === 'select' || this.mode === 'edit'))
		) {
			const selected = this.getSelectedFeatures()
			if (selected.length > 0) {
				e.preventDefault()
				this.deleteFeatures(selected.map((f: EditorFeature) => f.id))
				return
			}
		}

		// Pass to draw modes
		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onKeyDown(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.render()
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onKeyDown(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.render()
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (e.key === 'Shift' && this.selectionDragState) {
			this.completeSelectionDrag(true)
		}
	}

	// Public API Methods
	setMode(mode: EditorMode): void {
		const previousMode = this.mode
		this.mode = mode

		// Clear edit mode state when leaving edit mode
		if (previousMode === 'edit' && mode !== 'edit') {
			this.editMode.reset()
			this.renderVertices() // Clear vertices
		}

		// Render vertices when entering edit mode
		if (mode === 'edit') {
			this.renderVertices()
		}

		if (mode !== 'select' && this.selectionDragState) {
			this.completeSelectionDrag(true)
		}

		if (!this.shouldShowCursorIndicator()) {
			this.updateCursorIndicator()
		}

		this.updateDoubleClickZoomState()
		this.updatePanLockForMode()

		this.updateActiveStates()
		this.emit('mode.change', { type: 'mode.change', mode })
	}

	getMode(): EditorMode {
		return this.mode
	}

	toggleSnapping(): boolean {
		this.options.snapping = !this.options.snapping
		this.snap.setSnapping(this.options.snapping)
		return this.options.snapping
	}

	setSnapping(enabled: boolean): void {
		this.options.snapping = enabled
		this.snap.setSnapping(enabled)
	}

	isSnappingEnabled(): boolean {
		return this.options.snapping
	}

	canFinishDrawing(): boolean {
		if (this.mode === 'draw_linestring') {
			return this.drawLineMode.getCoordinates().length >= this.DRAW_MIN_LINE_POINTS
		}
		if (this.mode === 'draw_polygon') {
			return this.drawPolygonMode.getCoordinates().length >= this.DRAW_MIN_POLYGON_POINTS
		}
		return false
	}

	finishDrawing(): EditorFeature | null {
		if (!this.canFinishDrawing()) return null
		let feature: EditorFeature | null = null
		if (this.mode === 'draw_linestring') {
			feature = this.drawLineMode.onKeyDown({ key: 'Enter' } as KeyboardEvent) ?? null
		} else if (this.mode === 'draw_polygon') {
			feature = this.drawPolygonMode.onKeyDown({ key: 'Enter' } as KeyboardEvent) ?? null
		}
		if (feature) {
			this.addFeature(feature)
			this.emit('create', { type: 'create', features: [feature] })
			this.render()
			this.emitDrawChange()
		}
		return feature
	}

	setPanLocked(enabled: boolean): void {
		if (this.panLockEnabled === enabled) return
		this.panLockEnabled = enabled
		this.updatePanLockForMode()
	}

	isPanLocked(): boolean {
		return this.panLockEnabled
	}

	canCombineSelection(): boolean {
		const selected = this.getSelectedFeatures()
		if (selected.length < 2) return false
		const baseType = this.getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		return selected.every((feature) => this.getBaseGeometryType(feature.geometry.type) === baseType)
	}

	canSplitSelection(): boolean {
		return this.getSelectedFeatures().some((feature) => this.isMultiGeometry(feature.geometry.type))
	}

	combineSelectedFeatures(): boolean {
		const selected = this.getSelectedFeatures()
		if (selected.length < 2) return false

		const baseType = this.getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		if (
			!selected.every((feature) => this.getBaseGeometryType(feature.geometry.type) === baseType)
		) {
			return false
		}

		const multiType = this.toMultiGeometryType(baseType)
		if (!multiType) return false

		const parts = selected.flatMap((feature) =>
			this.extractGeometryParts(feature.geometry, baseType)
		)
		if (parts.length === 0) return false

		const template = this.cloneFeature(selected[0])
		const newFeature: EditorFeature = {
			...template,
			id: generateId(),
			geometry: {
				type: multiType,
				coordinates: JSON.parse(JSON.stringify(parts))
			} as Geometry
		}

		selected.forEach((feature) => this.features.delete(feature.id))
		const normalizedFeature = this.normalizeFeature(newFeature)
		this.features.set(normalizedFeature.id, normalizedFeature)
		this.selection.clearSelection()
		this.selection.select(normalizedFeature.id)
		this.history.recordUpdate([normalizedFeature], selected)
		this.render()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures()
		})
		this.emit('update', { type: 'update', features: [normalizedFeature] })
		return true
	}

	splitSelectedFeatures(): boolean {
		const selected = this.getSelectedFeatures().filter((feature) =>
			this.isMultiGeometry(feature.geometry.type)
		)
		if (selected.length === 0) return false

		const newFeatures: EditorFeature[] = []

		selected.forEach((feature) => {
			const baseType = this.getBaseGeometryType(feature.geometry.type)
			if (!baseType) return
			const parts = this.extractGeometryParts(feature.geometry, baseType)
			parts.forEach((coords) => {
				const clone = this.cloneFeature(feature)
				clone.id = generateId()
				clone.geometry = {
					type: baseType,
					coordinates: JSON.parse(JSON.stringify(coords))
				} as Geometry
				newFeatures.push(this.normalizeFeature(clone))
			})
		})

		if (newFeatures.length === 0) return false

		selected.forEach((feature) => this.features.delete(feature.id))
		newFeatures.forEach((feature) => this.features.set(feature.id, feature))
		this.selection.clearSelection()
		this.selection.select(newFeatures.map((feature) => feature.id))
		this.history.recordUpdate(newFeatures, selected)
		this.render()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures()
		})
		this.emit('update', { type: 'update', features: newFeatures })
		return true
	}

	addFeature(feature: EditorFeature): void {
		const normalized = this.normalizeFeature(feature)
		this.features.set(normalized.id, normalized)
		this.history.recordCreate([normalized])
		this.render()
	}

	updateFeature(featureId: string, feature: EditorFeature): void {
		const normalized = this.normalizeFeature(feature)
		const previous = this.features.get(featureId)
		if (previous) {
			this.history.recordUpdate([normalized], [previous])
		}
		this.features.set(featureId, normalized)
		this.render()
		this.emit('update', { type: 'update', features: [normalized] })
	}

	deleteFeature(featureId: string): void {
		this.deleteFeatures([featureId])
	}

	deleteFeatures(featureIds: string[]): void {
		const deleted = featureIds
			.map((id) => this.features.get(id))
			.filter((f): f is EditorFeature => f !== undefined)

		if (deleted.length > 0) {
			this.history.recordDelete(deleted)
			featureIds.forEach((id) => this.features.delete(id))
			this.selection.deselect(featureIds)
			this.updateActiveStates()
			if (this.mode === 'edit') {
				this.renderVertices()
			}
			this.emit('selection.change', {
				type: 'selection.change',
				features: this.getSelectedFeatures()
			})
			this.emit('delete', { type: 'delete', features: deleted })
		}
	}

	getFeature(featureId: string): EditorFeature | undefined {
		return this.features.get(featureId)
	}

	getAllFeatures(): EditorFeature[] {
		return Array.from(this.features.values())
	}

	selectFeature(featureId: string, additive: boolean = false): void {
		const feature = this.features.get(featureId)
		if (!feature) return
		if (!additive) {
			this.selection.clearSelection()
		}
		this.selection.select(featureId)
		this.updateActiveStates()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures()
		})
	}

	private getSnappableFeatures(): EditorFeature[] {
		return this.getAllFeatures().filter((feature) => feature.properties?.meta === 'feature')
	}

	private cloneFeature(feature: EditorFeature): EditorFeature {
		return JSON.parse(JSON.stringify(feature)) as EditorFeature
	}

	private getBaseGeometryType(type: string): 'Point' | 'LineString' | 'Polygon' | null {
		if (type === 'Point' || type === 'LineString' || type === 'Polygon') return type
		if (type === 'MultiPoint') return 'Point'
		if (type === 'MultiLineString') return 'LineString'
		if (type === 'MultiPolygon') return 'Polygon'
		return null
	}

	private toMultiGeometryType(type: 'Point' | 'LineString' | 'Polygon'): Geometry['type'] | null {
		if (type === 'Point') return 'MultiPoint'
		if (type === 'LineString') return 'MultiLineString'
		if (type === 'Polygon') return 'MultiPolygon'
		return null
	}

	private isMultiGeometry(type: string): boolean {
		return type === 'MultiPoint' || type === 'MultiLineString' || type === 'MultiPolygon'
	}

	private extractGeometryParts(
		geometry: Geometry,
		base: 'Point' | 'LineString' | 'Polygon'
	): any[] {
		if (base === 'Point') {
			if (geometry.type === 'Point') return [geometry.coordinates]
			if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
		} else if (base === 'LineString') {
			if (geometry.type === 'LineString') return [geometry.coordinates]
			if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][]
		} else if (base === 'Polygon') {
			if (geometry.type === 'Polygon') return [geometry.coordinates]
			if (geometry.type === 'MultiPolygon') return geometry.coordinates as Position[][][]
		}
		return []
	}

	private normalizeFeature(feature: EditorFeature): EditorFeature {
		feature.properties = {
			...feature.properties,
			meta: feature.properties?.meta ?? 'feature',
			featureId: feature.id
		}
		return feature
	}

	private applyPointerOffset(point: ScreenPoint): Position {
		const canvas = this.map.getCanvas()
		const maxX = canvas.clientWidth
		const maxY = canvas.clientHeight
		const x = Math.min(Math.max(point.x + this.pointerOffset.x, 0), maxX)
		const y = Math.min(Math.max(point.y + this.pointerOffset.y, 0), maxY)
		const lngLat = this.map.unproject({ x, y })
		return [lngLat.lng, lngLat.lat]
	}

	private isTouchLikeEvent(event: MapMouseEvent | MapTouchEvent): boolean {
		const original = (event as any).originalEvent
		if (!original) return false
		if (typeof (original as any).pointerType === 'string') {
			return (original as any).pointerType === 'touch' || (original as any).pointerType === 'pen'
		}
		if (typeof TouchEvent !== 'undefined' && original instanceof TouchEvent) {
			return true
		}
		if (typeof (original as any).touches === 'object') {
			return true
		}
		return false
	}

	private getAdjustedPointerPosition(
		event: MapMouseEvent,
		excludeFeatureIds: string[] = []
	): { position: Position; snapped: boolean } {
		const basePosition = this.isTouchLikeEvent(event)
			? this.applyPointerOffset({ x: event.point.x, y: event.point.y })
			: ([event.lngLat.lng, event.lngLat.lat] as Position)
		const snapResult = this.snap.snap(basePosition, this.getSnappableFeatures(), excludeFeatureIds)
		return {
			position: snapResult.snapped ? snapResult.point : basePosition,
			snapped: snapResult.snapped
		}
	}

	private getAdjustedPositionFromScreenPoint(
		point: ScreenPoint,
		excludeFeatureIds: string[] = []
	): Position {
		const basePosition = this.applyPointerOffset(point)
		const snapResult = this.snap.snap(basePosition, this.getSnappableFeatures(), excludeFeatureIds)
		return snapResult.snapped ? snapResult.point : basePosition
	}

	private handleDrawRelease(position: Position): void {
		if (this.mode === 'draw_point') {
			const feature = this.drawPointMode.onClick({
				lngLat: { lng: position[0], lat: position[1] }
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			return
		}

		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onClick({
				lngLat: { lng: position[0], lat: position[1] }
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
			return
		}

		if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onClick({
				lngLat: { lng: position[0], lat: position[1] }
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		}
	}

	private emitDrawChange(): void {
		this.emit('draw.change', { type: 'draw.change' })
	}

	private updatePanLockForMode(): void {
		if (!this.map.dragPan) return
		const shouldDisablePan = this.panLockEnabled
		if (shouldDisablePan) {
			if (this.map.dragPan.isEnabled()) {
				this.panLockDragPanWasEnabled = true
				this.map.dragPan.disable()
			}
		} else if (this.panLockDragPanWasEnabled && !this.map.dragPan.isEnabled()) {
			this.map.dragPan.enable()
			this.panLockDragPanWasEnabled = false
		}
	}

	private getRenderedFeatureId(feature: MapGeoJSONFeature): string | undefined {
		const propertyId = feature.properties?.featureId
		if (typeof propertyId === 'string' && propertyId.length > 0) {
			return propertyId
		}
		if (typeof propertyId === 'number') {
			return propertyId.toString()
		}
		if (typeof feature.id === 'string') {
			return feature.id
		}
		if (typeof feature.id === 'number') {
			return feature.id.toString()
		}
		return undefined
	}

	private getSelectionCentroid(
		features: EditorFeature[] = this.getSelectedFeatures()
	): Position | null {
		if (!features.length) return null
		try {
			const fc = turf.featureCollection(features as Feature[])
			const centroid = turf.centerOfMass(fc)
			return centroid.geometry?.coordinates as Position
		} catch {
			return null
		}
	}

	private detectMultiSelectModifier(): 'ctrl' | 'shift' {
		if (typeof navigator !== 'undefined') {
			const platform = navigator.platform || ''
			if (/Mac|iPod|iPhone|iPad/.test(platform)) {
				return 'ctrl'
			}
		}
		return 'shift'
	}

	private isMultiSelectEvent(event: MouseEvent): boolean {
		if (this.multiSelectModifier === 'ctrl') {
			return event.metaKey || event.ctrlKey
		}
		return event.shiftKey
	}

	public getMultiSelectModifierLabel(): string {
		return this.multiSelectModifier === 'ctrl' ? 'Ctrl' : 'Shift'
	}

	getSelectedFeatures(): EditorFeature[] {
		const selectedIds = this.selection.getSelected()
		return selectedIds
			.map((id) => this.features.get(id))
			.filter((f): f is EditorFeature => f !== undefined)
	}

	setFeatures(features: EditorFeature[]): void {
		this.features.clear()
		features.forEach((feature) => {
			const normalized = this.normalizeFeature(feature)
			this.features.set(normalized.id, normalized)
		})
		this.render()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
	}

	undo(): void {
		const action = this.history.undo()
		if (!action) return

		if (action.type === 'create') {
			action.features.forEach((f: EditorFeature) => this.features.delete(f.id))
		} else if (action.type === 'delete') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		} else if (action.type === 'update' && action.previousFeatures) {
			action.previousFeatures.forEach((f: EditorFeature) => this.features.set(f.id, f))
		}

		this.render()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
		this.emit('undo', { type: 'undo' })
	}

	redo(): void {
		const action = this.history.redo()
		if (!action) return

		if (action.type === 'create') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		} else if (action.type === 'delete') {
			action.features.forEach((f: EditorFeature) => this.features.delete(f.id))
		} else if (action.type === 'update') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		}

		this.render()
		if (this.mode === 'edit') {
			this.renderVertices()
		}
		this.emit('redo', { type: 'redo' })
	}

	on(eventType: EditorEventType, handler: EditorEventHandler): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, new Set())
		}
		this.eventHandlers.get(eventType)?.add(handler)
	}

	off(eventType: EditorEventType, handler: EditorEventHandler): void {
		const handlers = this.eventHandlers.get(eventType)
		if (handlers) {
			handlers.delete(handler)
		}
	}

	private emit(eventType: EditorEventType, event: EditorEvent): void {
		const handlers = this.eventHandlers.get(eventType)
		if (handlers) {
			handlers.forEach((handler: EditorEventHandler) => handler(event))
		}
	}

	private updateActiveStates(): void {
		const selectedIds = new Set(this.selection.getSelected())
		this.features.forEach((feature: EditorFeature) => {
			feature.properties = {
				...feature.properties,
				active: selectedIds.has(feature.id)
			}
		})
		this.render()
	}

	private shouldShowCursorIndicator(): boolean {
		return (
			this.mode === 'draw_point' || this.mode === 'draw_linestring' || this.mode === 'draw_polygon'
		)
	}

	private isDrawMode(mode: EditorMode): boolean {
		return mode === 'draw_point' || mode === 'draw_linestring' || mode === 'draw_polygon'
	}

	private updateDoubleClickZoomState(): void {
		if (!this.map.doubleClickZoom) {
			return
		}
		const shouldDisable = this.isDrawMode(this.mode)
		if (shouldDisable && !this.doubleClickZoomDisabled) {
			if (this.map.doubleClickZoom.isEnabled()) {
				this.map.doubleClickZoom.disable()
				this.doubleClickZoomDisabled = true
			}
		} else if (!shouldDisable && this.doubleClickZoomDisabled) {
			this.map.doubleClickZoom.enable()
			this.doubleClickZoomDisabled = false
		}
	}

	private updateCursorIndicator(position?: Position): void {
		const source = this.map.getSource(this.SOURCE_CURSOR) as GeoJSONSource | undefined
		if (!source) {
			return
		}

		if (
			position &&
			position[0] !== undefined &&
			position[1] !== undefined &&
			this.shouldShowCursorIndicator()
		) {
			source.setData({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: {
							type: 'Point',
							coordinates: position
						},
						properties: {}
					}
				]
			})
		} else {
			source.setData({ type: 'FeatureCollection', features: [] })
		}
	}

	private renderSelectionIndicator(): void {
		const source = this.map.getSource(this.SOURCE_SELECTION) as GeoJSONSource | undefined
		if (!source) {
			return
		}

		const selectedFeatures = this.getSelectedFeatures()
		const highlightFeatures: Feature[] = selectedFeatures.map((feature) => ({
			type: 'Feature',
			id: `${feature.id}-selection`,
			geometry: JSON.parse(JSON.stringify(feature.geometry)) as Geometry,
			properties: {
				featureId: feature.id
			}
		}))

		source.setData({
			type: 'FeatureCollection',
			features: highlightFeatures
		})
	}

	private getRotationHandlePosition(center: Position): Position {
		if (!this.map) return center
		const projected = this.map.project({ lng: center[0], lat: center[1] })
		const handlePoint = this.map.unproject([projected.x, projected.y - 60])
		return [handlePoint.lng, handlePoint.lat]
	}

	private getMoveHandlePosition(center: Position): Position {
		if (!this.map) return center
		const projected = this.map.project({ lng: center[0], lat: center[1] })
		const handlePoint = this.map.unproject([projected.x + 60, projected.y])
		return [handlePoint.lng, handlePoint.lat]
	}

	private renderGizmo(): void {
		const source = this.map.getSource(this.SOURCE_GIZMO) as GeoJSONSource | undefined
		if (!source) {
			return
		}

		if (this.mode !== 'select') {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const currentCenter = this.transformDragState?.center || this.getSelectionCentroid()
		if (!currentCenter) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const rotateHandle = this.getRotationHandlePosition(currentCenter)
		const moveHandle = this.getMoveHandlePosition(currentCenter)

		source.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [currentCenter, rotateHandle]
					},
					properties: {
						meta: 'gizmo-line'
					}
				},
				{
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [currentCenter, moveHandle]
					},
					properties: {
						meta: 'gizmo-line'
					}
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: currentCenter
					},
					properties: {
						meta: 'gizmo-center'
					}
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: rotateHandle
					},
					properties: {
						meta: 'gizmo-rotate'
					}
				},
				{
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: moveHandle
					},
					properties: {
						meta: 'gizmo-move'
					}
				}
			]
		})
	}

	private renderSelectionBox(): void {
		const source = this.map.getSource(this.SOURCE_SELECTION_BOX) as GeoJSONSource | undefined
		if (!source) {
			return
		}

		if (!this.selectionDragState || !this.selectionDragState.hasMoved) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		const minX = Math.min(this.selectionDragState.start.x, this.selectionDragState.current.x)
		const minY = Math.min(this.selectionDragState.start.y, this.selectionDragState.current.y)
		const maxX = Math.max(this.selectionDragState.start.x, this.selectionDragState.current.x)
		const maxY = Math.max(this.selectionDragState.start.y, this.selectionDragState.current.y)

		const nw = this.map.unproject([minX, minY])
		const ne = this.map.unproject([maxX, minY])
		const se = this.map.unproject([maxX, maxY])
		const sw = this.map.unproject([minX, maxY])

		const polygon: Position[] = [
			[nw.lng, nw.lat],
			[ne.lng, ne.lat],
			[se.lng, se.lat],
			[sw.lng, sw.lat],
			[nw.lng, nw.lat]
		]

		source.setData({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: {
						type: 'Polygon',
						coordinates: [polygon]
					},
					properties: {}
				}
			]
		})
	}

	private renderVertices(): void {
		if (this.mode !== 'edit') {
			// Clear vertices when not in edit mode
			const source = this.map.getSource(this.SOURCE_VERTICES) as GeoJSONSource
			if (source) {
				source.setData({ type: 'FeatureCollection', features: [] })
			}
			return
		}

		// Show vertices for ALL features when in edit mode
		const allFeatures = this.getAllFeatures()
		const vertexFeatures: Feature[] = []

		allFeatures.forEach((feature) => {
			// Add vertices
			const vertices = this.editMode.extractVerticesWithPaths(feature)
			vertices.forEach(({ position, path }) => {
				vertexFeatures.push({
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: position
					},
					properties: {
						meta: 'vertex',
						featureId: feature.id,
						path: JSON.stringify(path)
					}
				})
			})

			// Add midpoints
			const midpoints = this.editMode.extractMidpoints(feature)
			midpoints.forEach(({ position, path }) => {
				vertexFeatures.push({
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: position
					},
					properties: {
						meta: 'midpoint',
						featureId: feature.id,
						path: JSON.stringify(path)
					}
				})
			})
		})

		const source = this.map.getSource(this.SOURCE_VERTICES) as GeoJSONSource
		if (source) {
			source.setData({
				type: 'FeatureCollection',
				features: vertexFeatures
			})
		}
	}

	private getFeatureCollection(): FeatureCollection {
		const features: Feature[] = Array.from(this.features.values()) as Feature[]

		// Add current drawing feature if exists
		const currentDrawFeature =
			this.drawLineMode.getCurrentFeature() || this.drawPolygonMode.getCurrentFeature()

		if (currentDrawFeature) {
			features.push(currentDrawFeature as Feature)
		}

		return {
			type: 'FeatureCollection',
			features
		}
	}

	private render(): void {
		const source = this.map.getSource(this.SOURCE_ID) as GeoJSONSource
		if (source) {
			source.setData(this.getFeatureCollection())
		}
		this.renderSelectionIndicator()
		this.renderGizmo()
	}

	destroy(): void {
		try {
			if (this.doubleClickZoomDisabled && this.map.doubleClickZoom) {
				this.map.doubleClickZoom.enable()
				this.doubleClickZoomDisabled = false
			}
			if (this.map.dragPan && !this.map.dragPan.isEnabled()) {
				this.map.dragPan.enable()
			}
		} catch {
			// Map may have been removed
		}

		// Remove event listeners
		window.removeEventListener('keydown', this.keyDownHandler)
		window.removeEventListener('keyup', this.keyUpHandler)
		try {
			this.map.off('move', this.gizmoRenderHandler)
		} catch {
			// Map may have been removed
		}

		// Remove managers
		this.history.onRemove()
		this.snap.onRemove()
		this.selection.onRemove()
		this.transform.onRemove()

		// Remove modes
		this.drawPointMode.onRemove()
		this.drawLineMode.onRemove()
		this.drawPolygonMode.onRemove()
		this.editMode.onRemove()

		// Remove layers and sources - wrap in try-catch as map may have been removed
		try {
			if (this.map.getLayer(this.LAYER_SELECTION_BOX))
				this.map.removeLayer(this.LAYER_SELECTION_BOX)
			if (this.map.getLayer(this.LAYER_MIDPOINT)) this.map.removeLayer(this.LAYER_MIDPOINT)
			if (this.map.getLayer(this.LAYER_VERTEX)) this.map.removeLayer(this.LAYER_VERTEX)
			if (this.map.getLayer(this.LAYER_SELECTION_POINT))
				this.map.removeLayer(this.LAYER_SELECTION_POINT)
			if (this.map.getLayer(this.LAYER_CURSOR)) this.map.removeLayer(this.LAYER_CURSOR)
			if (this.map.getLayer(this.LAYER_SELECTION_LINE))
				this.map.removeLayer(this.LAYER_SELECTION_LINE)
			if (this.map.getLayer(this.LAYER_POINT)) this.map.removeLayer(this.LAYER_POINT)
			if (this.map.getLayer(this.LAYER_SELECTION_FILL))
				this.map.removeLayer(this.LAYER_SELECTION_FILL)
			if (this.map.getLayer(this.LAYER_GIZMO_ROTATE)) this.map.removeLayer(this.LAYER_GIZMO_ROTATE)
			if (this.map.getLayer(this.LAYER_GIZMO_MOVE)) this.map.removeLayer(this.LAYER_GIZMO_MOVE)
			if (this.map.getLayer(this.LAYER_GIZMO_CENTER)) this.map.removeLayer(this.LAYER_GIZMO_CENTER)
			if (this.map.getLayer(this.LAYER_GIZMO_LINE)) this.map.removeLayer(this.LAYER_GIZMO_LINE)
			if (this.map.getLayer(this.LAYER_LINE)) this.map.removeLayer(this.LAYER_LINE)
			if (this.map.getLayer(this.LAYER_FILL)) this.map.removeLayer(this.LAYER_FILL)

			// Remove sources
			if (this.map.getSource(this.SOURCE_ID)) {
				this.map.removeSource(this.SOURCE_ID)
			}
			if (this.map.getSource(this.SOURCE_VERTICES)) {
				this.map.removeSource(this.SOURCE_VERTICES)
			}
			if (this.map.getSource(this.SOURCE_SELECTION)) {
				this.map.removeSource(this.SOURCE_SELECTION)
			}
			if (this.map.getSource(this.SOURCE_SELECTION_BOX)) {
				this.map.removeSource(this.SOURCE_SELECTION_BOX)
			}
			if (this.map.getSource(this.SOURCE_CURSOR)) {
				this.map.removeSource(this.SOURCE_CURSOR)
			}
			if (this.map.getSource(this.SOURCE_GIZMO)) {
				this.map.removeSource(this.SOURCE_GIZMO)
			}
		} catch {
			// Map may have been removed during source switch
		}

		this.features.clear()
		this.eventHandlers.clear()
	}
}
