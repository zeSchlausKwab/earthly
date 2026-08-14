/** OpenAI function calling tool definition */
export interface Tool {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: {
			type: 'object'
			properties: Record<
				string,
				{
					type: string
					description: string
					enum?: string[]
				}
			>
			required?: string[]
		}
	}
}

/** Tool call from API response */
export interface ToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

/** Tool call result to send back */
export interface ToolResult {
	tool_call_id: string
	role: 'tool'
	content: string
}

export interface ToolExecutionContext {
	attachedGeometry?: GeoJSON.FeatureCollection | null
	/** The user-authored text that initiated this tool loop. */
	userMessage?: string
}

export interface GeometryBakeAnalysis {
	canBake: boolean
	featureCount: number
	geometryTypeCounts: Record<string, number>
	reason?: string
}

export interface GeometryBakeResult {
	importedCount: number
	skippedDuplicates: number
	totalFeaturesInEditor: number
	replaceExisting: boolean
	extractedFeatureCount: number
	geometryTypeCounts: Record<string, number>
}

export interface CachedMapSnapshot {
	snapshotId: string
	dataUrl: string
	mimeType: 'image/png' | 'image/jpeg'
	width: number
	height: number
	createdAt: number
	mapCenter: { lat: number; lon: number } | null
	mapZoom: number | null
	mapBbox: [number, number, number, number] | null
}

// --- Constants ---

export const DEFAULT_QUERY_LIMIT = 50
export const DEFAULT_IMPORT_LIMIT = 100
export const DEFAULT_NEARBY_RADIUS_METERS = 500
export const MAX_NEARBY_RADIUS_METERS = 5000
export const MAX_QUERY_LIMIT = 100
export const DEFAULT_SNAPSHOT_MAX_WIDTH = 1024
export const DEFAULT_SNAPSHOT_MAX_HEIGHT = 768
export const MAX_SNAPSHOT_CACHE_SIZE = 5
export const MAX_GEOJSON_TEXT_CHARS = 200000

export const TO_EDITOR_COMPATIBLE_TOOLS = new Set([
	'query_osm_by_id',
	'query_osm_nearby',
	'query_osm_bbox',
	'query_osm_area',
	'get_osm_relation_geometry',
	'get_country_boundary',
	'valhalla_route',
	'valhalla_isochrone',
	'route_over_network',
	'get_reference_boundaries',
])

export const NAME_MATCH_KEYS = [
	'name',
	'name:en',
	'name:de',
	'name:fr',
	'int_name',
	'official_name',
	'short_name',
	'alt_name',
]
