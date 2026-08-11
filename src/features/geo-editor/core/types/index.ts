import type { Feature, GeoJsonProperties, Position } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { MapCallout } from '@/lib/geo/callouts'

export type {
	MapCallout,
	MapCalloutLeader,
	MapCalloutMedia,
	MapCalloutSide,
} from '@/lib/geo/callouts'

export type EditorMode =
	| 'draw_point'
	| 'draw_linestring'
	| 'draw_polygon'
	| 'draw_primitive'
	| 'draw_annotation'
	| 'edit'
	| 'select'
	| 'box_select'
	| 'static'

export type DrawFeatureType = 'Point' | 'LineString' | 'Polygon'
export type PrimitiveShape = 'rectangle' | 'square' | 'circle' | 'triangle' | 'diamond'

export type GeometryInteractionKind =
	| 'split-line-point'
	| 'split-line-line'
	| 'split-polygon-line'
	| 'offset-polygon-drag'
	| 'offset-line-drag'
	| 'corridor-drag'

export interface ActiveGeometryInteraction {
	kind: GeometryInteractionKind
	targetFeatureId: string
	inputMode: 'draw' | 'drag'
	instruction: string
	distanceMeters?: number
	direction?: 'outward' | 'inward' | 'left' | 'right' | 'both'
	error?: string
}

export interface GeoEditorOptions {
	modes?: EditorMode[]
	defaultMode?: EditorMode
	features?: DrawFeatureType[]
	snapping?: boolean
	snapDistance?: number
	snapToVertices?: boolean
	snapToEdges?: boolean
	styles?: EditorStyles
	displayControlsDefault?: boolean
	touchEnabled?: boolean
	boxSelect?: boolean
	clickTolerance?: number
	pointerOffsetPx?: {
		x: number
		y: number
	}
}

export interface EditorStyles {
	vertex?: any
	vertexActive?: any
	vertexInactive?: any
	line?: any
	lineActive?: any
	lineInactive?: any
	polygon?: any
	polygonActive?: any
	polygonInactive?: any
	point?: any
	pointActive?: any
	pointInactive?: any
	midpoint?: any
}

export interface EditorFeature extends Feature {
	id: string
	properties: GeoJsonProperties & {
		meta?: string
		active?: boolean
		mode?: string
		parent?: string
		coord_path?: string
		featureId?: string
		name?: string
		description?: string
		customProperties?: Record<string, any>

		// ============================================================================
		// Style Properties (geometry-specific, used by MapLibre layers)
		// ============================================================================

		// Point style properties
		color?: string // Point fill color
		strokeColor?: string // Point/Line/Polygon stroke color
		strokeWidth?: number // Point/Line/Polygon stroke width (px)
		radius?: number // Point radius (px)

		// LineString style properties
		strokeOpacity?: number // Line opacity (0-1)
		lineDash?: 'solid' | 'dashed' | 'dotted' // Line dash pattern
		arrowStart?: boolean // Render an outward-facing arrowhead at the first coordinate
		arrowEnd?: boolean // Render an arrowhead at the final coordinate
		primitiveShape?: PrimitiveShape

		// Polygon style properties
		fillColor?: string // Polygon fill color
		fillOpacity?: number // Polygon fill opacity (0-1)

		// Label (all geometry types)
		label?: string // Text label displayed at centroid
		'earthly:callouts'?: MapCallout[]

		// ============================================================================
		// Annotation-specific properties (flat for MapLibre compatibility)
		// ============================================================================
		featureType?: 'annotation' | 'marker'
		text?: string
		textFontSize?: number
		textColor?: string
		textHaloColor?: string
		textHaloWidth?: number
	}
}

export interface HistoryAction {
	type: 'create' | 'update' | 'delete'
	features: EditorFeature[]
	previousFeatures?: EditorFeature[]
	timestamp: number
}

export interface SnapResult {
	snapped: boolean
	point: Position
	feature?: EditorFeature
	vertexIndex?: number
	edgeIndex?: number
}

export interface TransformOptions {
	center: Position
	angle?: number
	scale?: number
}

export interface SelectionBounds {
	north: number
	south: number
	east: number
	west: number
}

export type EditorEventType =
	| 'mode.change'
	| 'create'
	| 'update'
	| 'delete'
	| 'features.replace'
	| 'selection.change'
	| 'undo'
	| 'redo'
	| 'snap'
	| 'draw.change'
	| 'geometry.operation.change'

export interface EditorEvent {
	type: EditorEventType
	features?: EditorFeature[]
	mode?: EditorMode
	geometryOperation?: ActiveGeometryInteraction | null
}

export type EditorEventHandler = (event: EditorEvent) => void

export interface IManager {
	onAdd(map: MapLibreMap): void
	onRemove(): void
}

/** Minimal context passed to operation managers to avoid circular imports with GeoEditor. */
export interface EditorOperationContext {
	features: globalThis.Map<string, EditorFeature>
	getSelectedFeatures(): EditorFeature[]
	selection: {
		clearSelection(): void
		select(ids: string | string[]): void
		getSelected(): string[]
	}
	history: {
		recordUpdate(newFeatures: EditorFeature[], oldFeatures: EditorFeature[]): void
		recordCreate(features: EditorFeature[]): void
	}
	transform: {
		simplify(feature: EditorFeature, tolerance: number): EditorFeature
	}
	mode: EditorMode
	render(): void
	renderVertices(): void
	emit(event: EditorEventType, data: EditorEvent): void
}
