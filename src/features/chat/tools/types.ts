/** Recursive JSON Schema subset used by OpenAI function-calling tools. */
export interface ToolJsonSchema {
	type?: string | string[]
	description?: string
	enum?: Array<string | number | boolean | null>
	properties?: Record<string, ToolJsonSchema>
	items?: ToolJsonSchema
	required?: string[]
	additionalProperties?: boolean | ToolJsonSchema
	[key: string]: unknown
}

/** OpenAI function calling tool definition */
export interface Tool {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: {
			type: 'object'
			properties: Record<string, ToolJsonSchema>
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
	/**
	 * Immutable identity of the model run that owns this call. Tool handlers must
	 * not infer ownership from whichever conversation or editor happens to be
	 * visible when an awaited call eventually resumes.
	 */
	run?: ToolExecutionRunIdentity
}

export type ToolExecutionTargetEntityType = 'dataset' | 'story' | 'context'

export interface ToolExecutionTarget {
	readonly entityType: ToolExecutionTargetEntityType | null
	/** Durable local draft captured when the user sent the turn, when one exists. */
	readonly draftId: string | null
	/** Published event/source identifier captured with the draft. */
	readonly entityId: string | null
	/** Draft source id captured independently from the active editor surface. */
	readonly sourceId: string | null
	/** Exact published revision the local draft was based on, when applicable. */
	readonly baseRevisionId: string | null
	/** Draft revision marker captured before the model run starts. */
	readonly draftUpdatedAt: number | null
	/** Whether that exact draft already had unpublished changes at send time. */
	readonly wasDirty: boolean
	/** Retained editor surface that owned the draft at send time. */
	readonly workspaceId: string | null
}

export interface ToolExecutionRunIdentity {
	readonly runId: number
	readonly chatId: string
	readonly target: ToolExecutionTarget
	readonly startedAt: number
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
	'query_geography',
	'query_osm_by_id',
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
