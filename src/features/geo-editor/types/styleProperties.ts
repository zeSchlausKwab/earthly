import type { Feature, GeoJsonProperties } from 'geojson'

// ============================================================================
// Geometry Types
// ============================================================================

export type GeometryCategory = 'Point' | 'LineString' | 'Polygon'

// ============================================================================
// Style Properties by Geometry Type
// ============================================================================

export interface PointStyleProperties {
	color: string
	strokeColor: string
	strokeWidth: number
	radius: number
	label?: string
	/**
	 * Namespaced icon id rendered INSTEAD of the plain circle. Phase 1 accepts
	 * only bundled Lucide ids (`lucide:<name>`, e.g. `lucide:anchor`) — see
	 * `src/features/geo-editor/icons/`. The namespace keeps the value
	 * forward-compatible with remote URL icons in a later phase.
	 */
	displayIcon?: string
}

export interface LineStringStyleProperties {
	strokeColor: string
	strokeWidth: number
	strokeOpacity: number
	lineDash: 'solid' | 'dashed' | 'dotted'
	label?: string
}

export interface PolygonStyleProperties {
	fillColor: string
	fillOpacity: number
	strokeColor: string
	strokeWidth: number
	label?: string
}

export type StyleProperties =
	| PointStyleProperties
	| LineStringStyleProperties
	| PolygonStyleProperties

// Union of all possible style property keys
export type StylePropertyKey =
	| keyof PointStyleProperties
	| keyof LineStringStyleProperties
	| keyof PolygonStyleProperties

// ============================================================================
// Style Property Keys (for filtering from custom properties)
// ============================================================================

export const STYLE_PROPERTY_KEYS: StylePropertyKey[] = [
	'color',
	'strokeColor',
	'strokeWidth',
	'radius',
	'fillColor',
	'fillOpacity',
	'strokeOpacity',
	'lineDash',
	'label',
	'displayIcon',
]

export function isStyleProperty(key: string): key is StylePropertyKey {
	return STYLE_PROPERTY_KEYS.includes(key as StylePropertyKey)
}

// ============================================================================
// Default Style Values
// ============================================================================

export const DEFAULT_POINT_STYLE: PointStyleProperties = {
	color: '#1d4ed8',
	strokeColor: '#ffffff',
	strokeWidth: 2,
	radius: 6,
}

export const DEFAULT_LINESTRING_STYLE: LineStringStyleProperties = {
	strokeColor: '#1d4ed8',
	strokeWidth: 2,
	strokeOpacity: 1,
	lineDash: 'solid',
}

export const DEFAULT_POLYGON_STYLE: PolygonStyleProperties = {
	fillColor: '#1d4ed8',
	fillOpacity: 0.15,
	strokeColor: '#1d4ed8',
	strokeWidth: 2,
}

export function getDefaultStyles(geometryType: GeometryCategory | string): StyleProperties {
	switch (geometryType) {
		case 'Point':
		case 'MultiPoint':
			return { ...DEFAULT_POINT_STYLE }
		case 'LineString':
		case 'MultiLineString':
			return { ...DEFAULT_LINESTRING_STYLE }
		case 'Polygon':
		case 'MultiPolygon':
			return { ...DEFAULT_POLYGON_STYLE }
		default:
			return { ...DEFAULT_POLYGON_STYLE }
	}
}

export function getGeometryCategory(geometryType: string): GeometryCategory {
	if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'Point'
	if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'LineString'
	return 'Polygon'
}

// ============================================================================
// Line Dash Patterns for MapLibre
// ============================================================================

export const LINE_DASH_PATTERNS: Record<LineStringStyleProperties['lineDash'], number[]> = {
	solid: [],
	dashed: [4, 2],
	dotted: [1, 2],
}
