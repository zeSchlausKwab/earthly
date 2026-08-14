/**
 * Unified typed tool registry (D-01/D-02/D-03/D-04/D-06).
 *
 * ONE registry dispatches every chat tool. Each entry co-locates its OpenAI
 * function schema, its handler, and a MANDATORY `kind` discriminator. The
 * advertised tool list is derived from live registry state (D-04 dynamic,
 * D-06 serialization decoupled from dispatch). Unknown names and handler
 * failures become a structured `ToolError` (INFRA-01 / D-16) — never a silent
 * no-op or a bare throw.
 *
 * Geometry-mutating tools dispatch INTO the Authoring API (via
 * importFeaturesToEditor, which Plan 03 rerouted through createAuthoring) — the
 * registry never touches `editor.*` directly.
 */

import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { loadWorldLayer } from '@/lib/geo/worldData'
import { createAuthoring } from '@/features/geo-editor/api'
import { executeEditorAiTool, getEditorAiToolDefinitions } from '@/features/geo-editor/commands'
import { useEditorStore } from '@/features/geo-editor/store'
import { ensureDatasetDraftForMutation } from '@/features/geo-editor/authoringTaskBridge'
import {
	getMapContextSnapshot,
	getCompactMapContextForTool,
	mapSnapshotCache,
	pruneSnapshotCache,
} from './context'
import { isToolError, type ToolError } from './errors'
import { registerSandboxTools } from '@/features/chat/sandbox/runCode'
import { buildPostWriteValidation } from '@/features/chat/safeEditing/autoValidate'
import { gateEditorImport } from '@/features/chat/safeEditing/gateEditorImport'
import { registerBulkTools } from './bulk-tools'
import { registerEntityTools } from './entity-tools'
import { registerGeoAwarenessTools } from './geo-awareness-tools'
import { registerStoryTools } from './story-tools'
import { registerGeometryTools } from './geometry-tools'
import { registerCalloutTools } from './callout-tools'
import { registerIngestTools } from './ingest-tools'
import { registerPrimitiveTools } from './primitives-tools'
import { registerSearchTools } from './search-tools'
import {
	registerReferenceBoundaryTools,
	selectNaturalEarthCountries,
} from './reference-boundary-tools'
import { registerRoutingTools } from './routing-tools'
import { getWikipediaFetchRedirect } from './source-routing'
import { geoStaticToolSchemas } from './schemas'
import {
	asFeatureObject,
	clampLimit,
	clampPositiveInt,
	clampRadiusMeters,
	ensureBbox,
	expandOsmSemanticQuery,
	extractMcpToolResult,
	extractPolygonAreaFeatures,
	featureMatchesName,
	filterFeaturesToArea,
	getEditorViewportBbox,
	getFeatureCollectionBbox,
	getGeoClient,
	getSelectedAreaFeatures,
	hasExplicitBbox,
	hasExplicitPoint,
	importFeaturesToEditor,
	normalizeFilterSets,
	normalizeFilters,
	normalizeGeoJsonToFeatures,
	parseGeoJsonArg,
	parseSingleFeatureArg,
	prepareMapToolFeaturesForEditor,
	toFiniteNumber,
} from './helpers'
import {
	DEFAULT_IMPORT_LIMIT,
	DEFAULT_QUERY_LIMIT,
	DEFAULT_SNAPSHOT_MAX_HEIGHT,
	DEFAULT_SNAPSHOT_MAX_WIDTH,
	type Tool,
	type ToolExecutionContext,
} from './types'

/** The nature/origin of a tool — required on every entry (D-03, Pitfall 5). */
export type ToolKind =
	| 'editor'
	| 'host-builtin'
	| 'remote-mcp'
	| 'authoring-primitive'
	| 'nostr-scroll'
	| 'code-interpreter'

/** A tool handler. Receives parsed args + optional execution context. */
export type ToolHandler = (
	args: Record<string, unknown>,
	context?: ToolExecutionContext,
) => Promise<unknown> | unknown

/** A unified registry entry: schema + handler + mandatory kind (+ optional origin). */
export interface ToolEntry {
	name: string
	schema: Tool
	handler: ToolHandler
	/** REQUIRED — omitting it is a compile error (D-03 / T-02-13). */
	kind: ToolKind
	/** For remote-mcp entries: the originating server pubkey (failure attribution). */
	origin?: string
}

const REMOTE_MCP_ORIGIN = EarthlyGeoServerClient.SERVER_PUBKEY

/** The live registry. Module-level so self-registration (editor commands) works. */
export const registry = new Map<string, ToolEntry>()

/** Register (or replace) a tool entry by name. */
export function register(entry: ToolEntry): void {
	registry.set(entry.name, entry)
}

/** Remove a tool entry by name. Returns true if one was removed. */
export function unregister(name: string): boolean {
	return registry.delete(name)
}

/**
 * Dispatch a tool call through the single typed chokepoint.
 * - Unknown name → `ToolError(unknown_tool)` (INFRA-01, never a silent no-op).
 * - Handler throw → `ToolError(handler_error)` (D-16), with origin for remote-mcp.
 * - Success → the raw handler result.
 */
export async function dispatch(
	name: string,
	args: Record<string, unknown>,
	context?: ToolExecutionContext,
): Promise<unknown | ToolError> {
	const entry = registry.get(name)
	if (!entry) {
		return {
			ok: false,
			kind: 'unknown_tool',
			toolName: name,
			message: `Unknown tool: ${name}`,
		} satisfies ToolError
	}
	try {
		return await entry.handler(args, context)
	} catch (error) {
		return {
			ok: false,
			kind: 'handler_error',
			toolName: name,
			message: error instanceof Error ? error.message : 'Tool execution failed',
			code:
				error && typeof error === 'object' && 'code' in error
					? String((error as { code: unknown }).code)
					: 'tool_handler_error',
			retryable:
				error && typeof error === 'object' && 'retryable' in error
					? Boolean((error as { retryable: unknown }).retryable)
					: false,
			...(error && typeof error === 'object' && 'retryAfterMs' in error
				? { retryAfterMs: Number((error as { retryAfterMs: unknown }).retryAfterMs) }
				: {}),
			sideEffectsApplied: false,
			...(entry.origin ? { origin: entry.origin } : {}),
		} satisfies ToolError
	}
}

/**
 * Derive the advertised tool list from live registry state (D-04 / D-06).
 * Serialization is decoupled from dispatch — this never runs handlers.
 */
export function advertise(): Tool[] {
	return Array.from(registry.values()).map((entry) => entry.schema)
}

export { isToolError }

// ---------------------------------------------------------------------------
// OSM bbox query helpers (moved from execute.ts; used by several remote-mcp
// handlers). These are pure orchestration around the MCP client.
// ---------------------------------------------------------------------------

type OsmFilterObject = Record<string, string | string[]>

function shouldAvoidRelationQueriesForConcept(appliedConcept: string | null): boolean {
	return (
		appliedConcept === 'military_installation' ||
		appliedConcept === 'bench' ||
		appliedConcept === 'river'
	)
}

function getFeatureDedupeKey(feature: GeoJSON.Feature): string {
	if (feature.id != null) return String(feature.id)
	const osmId = feature.properties?.['@id']
	if (typeof osmId === 'string' && osmId) return osmId
	return JSON.stringify({
		type: feature.geometry?.type ?? 'Unknown',
		coordinates:
			feature.geometry && 'coordinates' in feature.geometry ? feature.geometry.coordinates : null,
	})
}

function dedupeGeoFeatures(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
	const seen = new Set<string>()
	const deduped: GeoJSON.Feature[] = []
	for (const feature of features) {
		const key = getFeatureDedupeKey(feature)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(feature)
	}
	return deduped
}

function splitBboxIntoTiles(
	bbox: [number, number, number, number],
	maxLonSpan = 6,
	maxLatSpan = 6,
): Array<[number, number, number, number]> {
	const [west, south, east, north] = bbox
	const lonSpan = Math.max(0, east - west)
	const latSpan = Math.max(0, north - south)
	const xTiles = Math.max(1, Math.ceil(lonSpan / maxLonSpan))
	const yTiles = Math.max(1, Math.ceil(latSpan / maxLatSpan))
	const lonStep = lonSpan / xTiles
	const latStep = latSpan / yTiles
	const tiles: Array<[number, number, number, number]> = []

	for (let y = 0; y < yTiles; y += 1) {
		for (let x = 0; x < xTiles; x += 1) {
			const tileWest = west + lonStep * x
			const tileEast = x === xTiles - 1 ? east : west + lonStep * (x + 1)
			const tileSouth = south + latStep * y
			const tileNorth = y === yTiles - 1 ? north : south + latStep * (y + 1)
			tiles.push([tileWest, tileSouth, tileEast, tileNorth])
		}
	}

	return tiles
}

async function queryOsmBboxWithFallback(
	client: ReturnType<typeof getGeoClient>,
	params: {
		bbox: [number, number, number, number]
		filters?: OsmFilterObject
		filterSets?: OsmFilterObject[]
		limit: number
		includeRelations: boolean
	},
): Promise<{
	features: GeoJSON.Feature[]
	usedTileCount: number
	usedTiledStrategy: boolean
	includeRelationsApplied: boolean
}> {
	const includeRelationsApplied = params.includeRelations
	const [west, south, east, north] = params.bbox
	const lonSpan = Math.abs(east - west)
	const latSpan = Math.abs(north - south)
	const shouldTile = lonSpan > 8 || latSpan > 8
	const tiles = shouldTile ? splitBboxIntoTiles(params.bbox) : [params.bbox]
	const collected: GeoJSON.Feature[] = []

	for (const tile of tiles) {
		const response = await client.QueryOsmBbox(
			tile[0],
			tile[1],
			tile[2],
			tile[3],
			params.filters,
			params.filterSets,
			params.limit,
			includeRelationsApplied,
		)
		const queryResult = extractMcpToolResult('query_osm_bbox', response)
		const validFeatures = Array.isArray(queryResult.features)
			? queryResult.features
					.map(asFeatureObject)
					.filter((feature): feature is GeoJSON.Feature => feature !== null)
			: []
		collected.push(...validFeatures)
	}

	return {
		features: dedupeGeoFeatures(collected),
		usedTileCount: tiles.length,
		usedTiledStrategy: shouldTile,
		includeRelationsApplied,
	}
}

// ---------------------------------------------------------------------------
// Schema lookup: reuse the hand-authored OpenAI function schemas from
// schemas.ts (a dependency-free module — avoids a circular import with
// definitions.ts, which now derives its advertised list from advertise()).
// ---------------------------------------------------------------------------

function schemaFor(name: string): Tool {
	const schema = geoStaticToolSchemas.find((tool) => tool.function.name === name)
	if (!schema) {
		throw new Error(`Missing schema for registered tool '${name}'`)
	}
	return schema
}

// ---------------------------------------------------------------------------
// Tool entry registration (the ~24 former execute.ts cases).
// kind map (Pitfall 5):
//   geometry writers / host snapshot+context / editor reads → host-builtin/editor
//   OSM / valhalla / web / wiki / fetch → remote-mcp (origin = SERVER_PUBKEY)
//   editor_* commands → editor (self-registered below)
// ---------------------------------------------------------------------------

function registerHostBuiltins(): void {
	register({
		name: 'get_editor_state',
		kind: 'host-builtin',
		schema: schemaFor('get_editor_state'),
		handler: (args) => {
			const detail = args.detail === 'full' ? 'full' : 'compact'
			const snapshot = getMapContextSnapshot()
			return detail === 'full' ? snapshot : { ...getCompactMapContextForTool(snapshot), detail }
		},
	})

	register({
		name: 'set_dataset_metadata',
		kind: 'host-builtin',
		schema: schemaFor('set_dataset_metadata'),
		handler: async (args) => {
			await ensureDatasetDraftForMutation()
			const editor = useEditorStore.getState().editor
			if (!editor) {
				throw new Error('Map editor is not ready. Open the map editor first, then try again.')
			}
			// Route through the Authoring facade's benign metadata op — the SAME
			// setCollectionMeta path the dataset-info panel + run_code use. This is
			// the discoverable, direct way to NAME a dataset (no run_code needed) and
			// avoids the model stamping dataset_name onto every feature.
			const meta: {
				name?: string
				description?: string
				properties?: Record<string, string | number | boolean>
			} = {}
			if (typeof args.name === 'string') meta.name = args.name
			if (typeof args.description === 'string') meta.description = args.description
			if (
				args.properties &&
				typeof args.properties === 'object' &&
				!Array.isArray(args.properties)
			) {
				const props: Record<string, string | number | boolean> = {}
				for (const [key, value] of Object.entries(args.properties as Record<string, unknown>)) {
					if (
						typeof value === 'string' ||
						typeof value === 'number' ||
						typeof value === 'boolean'
					) {
						props[key] = value
					}
				}
				meta.properties = props
			}
			const result = createAuthoring(editor).setDatasetMetadata(meta)
			return {
				ok: result.ok,
				name: result.name,
				description: result.description,
				customPropertyCount: result.customPropertyCount,
			}
		},
	})

	register({
		name: 'capture_map_snapshot',
		kind: 'host-builtin',
		schema: schemaFor('capture_map_snapshot'),
		handler: (args) => {
			const store = useEditorStore.getState()
			if (!store.editor) {
				throw new Error('Map editor is not ready. Open the map editor first, then try again.')
			}
			const mimeType = args.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
			const quality =
				typeof args.quality === 'number' ? Math.max(0, Math.min(1, args.quality)) : 0.9
			const maxWidth = clampPositiveInt(args.maxWidth, DEFAULT_SNAPSHOT_MAX_WIDTH, 4096)
			const maxHeight = clampPositiveInt(args.maxHeight, DEFAULT_SNAPSHOT_MAX_HEIGHT, 4096)
			const capture = store.editor.captureMapSnapshot({ mimeType, quality, maxWidth, maxHeight })
			const snapshot = getMapContextSnapshot()
			const snapshotId = crypto.randomUUID()
			mapSnapshotCache.set(snapshotId, {
				snapshotId,
				dataUrl: capture.dataUrl,
				mimeType,
				width: capture.width,
				height: capture.height,
				createdAt: Date.now(),
				mapCenter: snapshot.mapCenter,
				mapZoom: snapshot.mapZoom,
				mapBbox: snapshot.viewportBbox,
			})
			pruneSnapshotCache()
			return {
				snapshotId,
				mimeType,
				width: capture.width,
				height: capture.height,
				dataUrlLength: capture.dataUrl.length,
				mapView: snapshot.mapView,
			}
		},
	})
}

function registerEditorWriters(): void {
	register({
		name: 'write_geojson_to_editor',
		kind: 'editor',
		schema: schemaFor('write_geojson_to_editor'),
		handler: async (args) => {
			const payload = parseGeoJsonArg(args)
			const features = normalizeGeoJsonToFeatures(payload)
			const replaceExisting = Boolean(args.replaceExisting)
			// SAFE-03/04: route the AI write through the safe-editing gate (preview +
			// confirm per safety level) before the real interceptor-routed apply.
			const outcome = await gateEditorImport(features, replaceExisting, () =>
				importFeaturesToEditor(features, replaceExisting),
			)
			return {
				importedCount: outcome.importedCount,
				skippedDuplicates: outcome.skippedDuplicates,
				totalFeaturesInEditor: outcome.totalFeaturesInEditor,
				replaceExisting,
				cancelled: outcome.status === 'cancelled',
				// AI_GEO_AWARENESS §1: auto-append advisory topology + land/water
				// findings so the model can self-correct without being asked to check.
				...(outcome.status === 'applied'
					? { validation: await buildPostWriteValidation(features) }
					: {}),
			}
		},
	})

	register({
		name: 'add_feature_to_editor',
		kind: 'editor',
		schema: schemaFor('add_feature_to_editor'),
		handler: async (args) => {
			const feature = parseSingleFeatureArg(args)
			const replaceExisting = Boolean(args.replaceExisting)
			// SAFE-03/04: gate the single-feature AI write the same way.
			const outcome = await gateEditorImport([feature], replaceExisting, () =>
				importFeaturesToEditor([feature], replaceExisting),
			)
			return {
				geometryType: feature.geometry.type,
				providedFeatureId:
					typeof feature.id === 'string' || typeof feature.id === 'number'
						? String(feature.id)
						: null,
				importedCount: outcome.importedCount,
				skippedDuplicates: outcome.skippedDuplicates,
				totalFeaturesInEditor: outcome.totalFeaturesInEditor,
				replaceExisting,
				cancelled: outcome.status === 'cancelled',
				...(outcome.status === 'applied'
					? { validation: await buildPostWriteValidation([feature]) }
					: {}),
			}
		},
	})
}

function registerRemoteMcpTools(): void {
	register({
		name: 'search_location',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('search_location'),
		handler: async (args) => {
			const client = getGeoClient()
			const query = typeof args.query === 'string' ? args.query.trim() : ''
			if (!query) throw new Error('query must be a non-empty string')
			const response = await client.SearchLocation(query, clampLimit(args.limit, 5))
			return extractMcpToolResult('search_location', response)
		},
	})

	register({
		name: 'reverse_lookup',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('reverse_lookup'),
		handler: async (args) => {
			const client = getGeoClient()
			const lat = toFiniteNumber(args.lat)
			const lon = toFiniteNumber(args.lon)
			const zoom = toFiniteNumber(args.zoom)
			if (lat === undefined || lon === undefined) {
				throw new Error('lat and lon must be valid numbers')
			}
			const response = await client.ReverseLookup(lat, lon, zoom)
			return extractMcpToolResult('reverse_lookup', response)
		},
	})

	register({
		name: 'query_osm_by_id',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('query_osm_by_id'),
		handler: async (args) => {
			const client = getGeoClient()
			const osmId = toFiniteNumber(args.osmId)
			if (typeof args.osmType !== 'string' || !['node', 'way', 'relation'].includes(args.osmType)) {
				throw new Error('osmType must be one of: node, way, relation')
			}
			if (osmId === undefined) throw new Error('osmId must be a valid number')
			const response = await client.QueryOsmById(args.osmType, Math.floor(osmId))
			return extractMcpToolResult('query_osm_by_id', response)
		},
	})

	register({
		name: 'query_osm_nearby',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('query_osm_nearby'),
		handler: async (args) => {
			const client = getGeoClient()
			const lat = toFiniteNumber(args.lat)
			const lon = toFiniteNumber(args.lon)
			const radius = clampRadiusMeters(args.radius)
			const semanticQuery = expandOsmSemanticQuery({
				concept: typeof args.concept === 'string' ? args.concept : undefined,
				filters: normalizeFilters(args.filters),
				filterSets: normalizeFilterSets(args.filterSets),
			})
			if (lat === undefined || lon === undefined) {
				throw new Error('lat and lon must be valid numbers')
			}
			const response = await client.QueryOsmNearby(
				lat,
				lon,
				radius,
				semanticQuery.filters,
				semanticQuery.filterSets,
				clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
				Boolean(args.includeRelations),
			)
			return {
				...extractMcpToolResult('query_osm_nearby', response),
				appliedConcept: semanticQuery.appliedConcept,
			}
		},
	})

	register({
		name: 'query_osm_bbox',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('query_osm_bbox'),
		handler: async (args) => {
			const client = getGeoClient()
			const semanticQuery = expandOsmSemanticQuery({
				concept: typeof args.concept === 'string' ? args.concept : undefined,
				filters: normalizeFilters(args.filters),
				filterSets: normalizeFilterSets(args.filterSets),
			})
			if (!hasExplicitBbox(args)) {
				throw new Error('west, south, east, and north are required and must be numbers')
			}
			const west = toFiniteNumber(args.west) as number
			const south = toFiniteNumber(args.south) as number
			const east = toFiniteNumber(args.east) as number
			const north = toFiniteNumber(args.north) as number
			const includeRelations =
				Boolean(args.includeRelations) &&
				!shouldAvoidRelationQueriesForConcept(semanticQuery.appliedConcept)
			const queryResult = await queryOsmBboxWithFallback(client, {
				bbox: [west, south, east, north],
				filters: semanticQuery.filters,
				filterSets: semanticQuery.filterSets,
				limit: clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
				includeRelations,
			})
			return {
				features: queryResult.features.slice(0, clampLimit(args.limit, DEFAULT_QUERY_LIMIT)),
				count: Math.min(queryResult.features.length, clampLimit(args.limit, DEFAULT_QUERY_LIMIT)),
				appliedConcept: semanticQuery.appliedConcept,
				queryStrategy: queryResult.usedTiledStrategy ? 'tiled_bbox' : 'single_bbox',
				tileCount: queryResult.usedTileCount,
				includeRelationsApplied: includeRelations,
			}
		},
	})

	register({
		name: 'query_osm_area',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('query_osm_area'),
		handler: async (args, context) => {
			const client = getGeoClient()
			const name = typeof args.name === 'string' ? args.name.trim() : ''
			const semanticQuery = expandOsmSemanticQuery({
				concept: typeof args.concept === 'string' ? args.concept : undefined,
				name,
				filters: normalizeFilters(args.filters),
				filterSets: normalizeFilterSets(args.filterSets),
			})
			const relationId = toFiniteNumber(args.relationId)
			const countryCode =
				typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined
			const countryName = typeof args.countryName === 'string' ? args.countryName.trim() : undefined
			const spatialFilter = args.spatialFilter === 'point_within' ? 'point_within' : 'intersects'
			const outputGeometry =
				args.outputGeometry === 'centroid'
					? 'centroid'
					: args.outputGeometry === 'point_on_feature'
						? 'point_on_feature'
						: 'native'
			const clipLines = typeof args.clipLines === 'boolean' ? args.clipLines : true
			const includeRelations =
				(Boolean(args.includeRelations) || relationId !== undefined) &&
				!shouldAvoidRelationQueriesForConcept(semanticQuery.appliedConcept)

			let areaSource = 'selected'
			let areaFeatures: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] = []

			if (args.selectedOnly) {
				areaFeatures = getSelectedAreaFeatures()
				if (areaFeatures.length === 0 && context?.attachedGeometry) {
					areaSource = 'attached_geometry'
					areaFeatures = extractPolygonAreaFeatures(context.attachedGeometry)
				}
			} else if (args.areaGeojson && typeof args.areaGeojson === 'object') {
				areaSource = 'geojson'
				areaFeatures = extractPolygonAreaFeatures(args.areaGeojson)
			} else if (context?.attachedGeometry) {
				areaSource = 'attached_geometry'
				areaFeatures = extractPolygonAreaFeatures(context.attachedGeometry)
			} else if (relationId !== undefined) {
				areaSource = 'relation'
				const relationResponse = await client.GetOsmRelationGeometry(Math.floor(relationId))
				const relationResult = extractMcpToolResult('get_osm_relation_geometry', relationResponse)
				areaFeatures = extractPolygonAreaFeatures(relationResult.feature)
			} else if (countryCode || countryName) {
				areaSource = 'country_boundary'
				const boundaryResult = selectNaturalEarthCountries(
					await loadWorldLayer('countries_110m'),
					countryName ? [countryName] : [],
					countryCode ? [countryCode] : [],
				)
				areaFeatures = extractPolygonAreaFeatures({
					type: 'FeatureCollection',
					features: boundaryResult.features,
				})
			}

			if (areaFeatures.length === 0) {
				throw new Error(
					'query_osm_area requires polygon area input via selectedOnly, areaGeojson, relationId, countryCode, or countryName.',
				)
			}

			const areaBbox = getFeatureCollectionBbox(areaFeatures)
			if (!areaBbox) {
				throw new Error('Failed to compute a bounding box for the requested area.')
			}
			if (!semanticQuery.filters && !semanticQuery.filterSets?.length) {
				throw new Error(
					'query_osm_area requires filters, filterSets, or a semantic concept. Unfiltered area scans are too large for Overpass. Example: concept="military installation" or filters={"amenity":"bench"}.',
				)
			}

			const queryResult = await queryOsmBboxWithFallback(client, {
				bbox: areaBbox,
				filters: semanticQuery.filters,
				filterSets: semanticQuery.filterSets,
				limit: clampLimit(args.limit, DEFAULT_IMPORT_LIMIT),
				includeRelations,
			})
			const validFeatures = queryResult.features

			if (validFeatures.length === 0) {
				throw new Error('No OSM features matched the raw area query.')
			}

			const nameMatched = name
				? validFeatures.filter((feature) => featureMatchesName(feature, name))
				: validFeatures
			if (name && nameMatched.length === 0) {
				throw new Error(`No OSM features named "${name}" matched within the requested area.`)
			}

			const processedFeatures = filterFeaturesToArea(nameMatched, areaFeatures, {
				spatialFilter,
				outputGeometry,
				clipLines,
			})

			if (processedFeatures.length === 0) {
				throw new Error('No OSM features remained after polygon area filtering.')
			}

			return {
				areaSource,
				areaFeatureCount: areaFeatures.length,
				areaBbox,
				appliedConcept: semanticQuery.appliedConcept,
				name: name || null,
				filters: semanticQuery.filters ?? null,
				filterSets: semanticQuery.filterSets ?? null,
				rawQueryCount: validFeatures.length,
				nameMatchedCount: name ? nameMatched.length : null,
				returnedFeatureCount: processedFeatures.length,
				queryStrategy: queryResult.usedTiledStrategy ? 'tiled_bbox' : 'single_bbox',
				tileCount: queryResult.usedTileCount,
				includeRelationsApplied: includeRelations,
				spatialFilter,
				outputGeometry,
				clipLines,
				features: processedFeatures,
			}
		},
	})

	register({
		name: 'resolve_osm_entity',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('resolve_osm_entity'),
		handler: async (args) => {
			const client = getGeoClient()
			const query = typeof args.query === 'string' ? args.query.trim() : ''
			if (!query) throw new Error('query must be a non-empty string')
			const response = await client.ResolveOsmEntity(
				query,
				clampPositiveInt(args.limit, 5, 10),
				typeof args.preferredOsmType === 'string' ? args.preferredOsmType : undefined,
				toFiniteNumber(args.adminLevel),
				typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined,
			)
			return extractMcpToolResult('resolve_osm_entity', response)
		},
	})

	register({
		name: 'get_osm_relation_geometry',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('get_osm_relation_geometry'),
		handler: async (args) => {
			const client = getGeoClient()
			const relationId = toFiniteNumber(args.relationId)
			if (relationId === undefined) throw new Error('relationId must be a valid number')
			const precision =
				toFiniteNumber(args.coordinatePrecision) !== undefined
					? Math.max(3, Math.min(7, Math.floor(toFiniteNumber(args.coordinatePrecision) as number)))
					: undefined
			const maxPoints =
				toFiniteNumber(args.maxPointsPerRing) !== undefined
					? Math.max(
							50,
							Math.min(20000, Math.floor(toFiniteNumber(args.maxPointsPerRing) as number)),
						)
					: undefined
			const response = await client.GetOsmRelationGeometry(
				Math.floor(relationId),
				precision,
				maxPoints,
			)
			return extractMcpToolResult('get_osm_relation_geometry', response)
		},
	})

	register({
		name: 'get_country_boundary',
		kind: 'host-builtin',
		schema: schemaFor('get_country_boundary'),
		handler: async (args) => {
			const countryCode =
				typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined
			const name = typeof args.name === 'string' ? args.name.trim() : undefined
			if (!countryCode && !name) throw new Error('countryCode or name is required')
			const result = selectNaturalEarthCountries(
				await loadWorldLayer('countries_110m'),
				name ? [name] : [],
				countryCode ? [countryCode] : [],
			)
			const feature = result.features[0]
			if (!feature)
				throw new Error(`No bundled Natural Earth country matched ${name ?? countryCode}`)
			return {
				query: name ?? countryCode,
				source: 'natural_earth_countries_110m',
				feature,
			}
		},
	})

	register({
		name: 'valhalla_route',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('valhalla_route'),
		handler: async (args) => {
			const client = getGeoClient()
			const locations = Array.isArray(args.locations) ? args.locations : []
			if (locations.length < 2) {
				throw new Error('locations must contain at least two {lat, lon} points')
			}
			const normalizedLocations = locations
				.map((location) => {
					if (!location || typeof location !== 'object') return null
					const lat = toFiniteNumber((location as Record<string, unknown>).lat)
					const lon = toFiniteNumber((location as Record<string, unknown>).lon)
					if (lat === undefined || lon === undefined) return null
					return { lat, lon }
				})
				.filter((location): location is { lat: number; lon: number } => location !== null)
			if (normalizedLocations.length < 2) {
				throw new Error('locations must contain at least two valid {lat, lon} points')
			}
			const response = await client.ValhallaRoute(
				normalizedLocations,
				typeof args.profile === 'string' ? args.profile : undefined,
				typeof args.units === 'string' ? args.units : undefined,
				typeof args.baseUrl === 'string' ? args.baseUrl : undefined,
			)
			const result = extractMcpToolResult('valhalla_route', response)
			const feature = asFeatureObject(result.feature)
			return {
				...result,
				...(feature
					? {
							feature: {
								...feature,
								properties: {
									...(feature.properties ?? {}),
									geometryPrecision: 'network-derived',
									mappingBasis: 'Valhalla route over the configured transport network',
								},
							},
						}
					: {}),
			}
		},
	})

	register({
		name: 'valhalla_isochrone',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('valhalla_isochrone'),
		handler: async (args) => {
			const client = getGeoClient()
			const location = args.location
			if (!location || typeof location !== 'object') {
				throw new Error('location must be an object with lat and lon')
			}
			const lat = toFiniteNumber((location as Record<string, unknown>).lat)
			const lon = toFiniteNumber((location as Record<string, unknown>).lon)
			if (lat === undefined || lon === undefined) {
				throw new Error('location.lat and location.lon must be valid numbers')
			}
			const contours = Array.isArray(args.contoursMinutes)
				? args.contoursMinutes
						.map((value) => toFiniteNumber(value))
						.filter((value): value is number => value !== undefined)
				: undefined
			const response = await client.ValhallaIsochrone(
				{ lat, lon },
				contours,
				typeof args.profile === 'string' ? args.profile : undefined,
				typeof args.polygons === 'boolean' ? args.polygons : undefined,
				typeof args.baseUrl === 'string' ? args.baseUrl : undefined,
			)
			return extractMcpToolResult('valhalla_isochrone', response)
		},
	})

	register({
		name: 'import_osm_to_editor',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('import_osm_to_editor'),
		handler: async (args) => {
			const client = getGeoClient()
			const name = typeof args.name === 'string' ? args.name.trim() : ''
			const relationId = toFiniteNumber(args.relationId)
			const limit = clampLimit(args.limit, DEFAULT_IMPORT_LIMIT)
			const replaceExisting = Boolean(args.replaceExisting)
			const semanticQuery = expandOsmSemanticQuery({
				concept: typeof args.concept === 'string' ? args.concept : undefined,
				name,
				filters: normalizeFilters(args.filters),
				filterSets: normalizeFilterSets(args.filterSets),
			})
			const includeRelations =
				(Boolean(args.includeRelations) || relationId !== undefined) &&
				!shouldAvoidRelationQueriesForConcept(semanticQuery.appliedConcept)

			let source = 'viewport'
			let usedBbox: [number, number, number, number] | null = null
			let rawFeatures: unknown[] = []
			let usedSearchFallback = false

			const queryBbox = async (bbox: [number, number, number, number]) => {
				const queryResult = await queryOsmBboxWithFallback(client, {
					bbox,
					filters: semanticQuery.filters,
					filterSets: semanticQuery.filterSets,
					limit,
					includeRelations,
				})
				return queryResult.features
			}

			if (relationId !== undefined) {
				source = 'relation'
				const relationResponse = await client.GetOsmRelationGeometry(Math.floor(relationId))
				const relationResult = extractMcpToolResult('get_osm_relation_geometry', relationResponse)
				rawFeatures = relationResult.feature ? [relationResult.feature] : []
			} else if (hasExplicitPoint(args)) {
				source = 'nearby'
				const lat = toFiniteNumber(args.lat) as number
				const lon = toFiniteNumber(args.lon) as number
				const response = await client.QueryOsmNearby(
					lat,
					lon,
					clampRadiusMeters(args.radius),
					semanticQuery.filters,
					semanticQuery.filterSets,
					limit,
					includeRelations,
				)
				const nearbyResult = extractMcpToolResult('query_osm_nearby', response)
				rawFeatures = Array.isArray(nearbyResult.features)
					? (nearbyResult.features as unknown[])
					: []
			} else {
				if (hasExplicitBbox(args)) {
					source = 'bbox'
					usedBbox = [
						toFiniteNumber(args.west) as number,
						toFiniteNumber(args.south) as number,
						toFiniteNumber(args.east) as number,
						toFiniteNumber(args.north) as number,
					]
				} else {
					usedBbox = getEditorViewportBbox()
					if (!usedBbox) {
						if (!name) {
							throw new Error(
								'No viewport bbox available. Provide explicit bbox/point arguments or a name for search fallback.',
							)
						}
						source = 'search_location'
						const searchResponse = await client.SearchLocation(name, 1)
						const searchResult = extractMcpToolResult('search_location', searchResponse)
						const searchCandidates = Array.isArray(searchResult.results) ? searchResult.results : []
						const first = searchCandidates[0] as Record<string, unknown> | undefined
						usedBbox = ensureBbox(first?.boundingbox)
						if (!usedBbox) {
							throw new Error(
								'No map viewport available and location search did not return a bounding box.',
							)
						}
					}
				}
				rawFeatures = await queryBbox(usedBbox)
			}

			let validFeatures = rawFeatures
				.map(asFeatureObject)
				.filter((feature): feature is GeoJSON.Feature => feature !== null)
			if (
				name &&
				validFeatures.length === 0 &&
				relationId === undefined &&
				!hasExplicitPoint(args) &&
				!hasExplicitBbox(args)
			) {
				const searchResponse = await client.SearchLocation(name, 1)
				const searchResult = extractMcpToolResult('search_location', searchResponse)
				const candidates = Array.isArray(searchResult.results) ? searchResult.results : []
				const fallbackBbox = ensureBbox(
					(candidates[0] as Record<string, unknown> | undefined)?.boundingbox,
				)
				if (fallbackBbox) {
					source = 'search_location'
					usedSearchFallback = true
					usedBbox = fallbackBbox
					rawFeatures = await queryBbox(fallbackBbox)
					validFeatures = rawFeatures
						.map(asFeatureObject)
						.filter((feature): feature is GeoJSON.Feature => feature !== null)
				}
			}
			if (validFeatures.length === 0) {
				throw new Error(
					'No OSM features matched this import query. Run query_osm_bbox/query_osm_nearby first, refine filters, then import.',
				)
			}

			const matchedByName = name
				? validFeatures.filter((feature) => featureMatchesName(feature, name))
				: validFeatures
			const selected = prepareMapToolFeaturesForEditor(
				'import_osm_to_editor',
				matchedByName.length > 0 ? matchedByName : validFeatures,
			)

			const importResult = importFeaturesToEditor(selected, replaceExisting)

			return {
				source,
				appliedConcept: semanticQuery.appliedConcept,
				name: name || null,
				filters: semanticQuery.filters ?? null,
				filterSets: semanticQuery.filterSets ?? null,
				usedBbox,
				queryResultCount: validFeatures.length,
				nameMatchedCount: name ? matchedByName.length : null,
				importedCount: importResult.importedCount,
				skippedDuplicates: importResult.skippedDuplicates,
				totalFeaturesInEditor: importResult.totalFeaturesInEditor,
				replaceExisting,
				usedSearchFallback,
				includeRelations,
				warning:
					name && matchedByName.length === 0
						? 'No name-matching features found; imported unfiltered query results.'
						: null,
			}
		},
	})

	register({
		name: 'web_search',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('web_search'),
		handler: async (args) => {
			const client = getGeoClient()
			const query = typeof args.query === 'string' ? args.query.trim() : ''
			if (!query) throw new Error('query must be a non-empty string')
			const response = await client.WebSearch(
				query,
				clampLimit(args.limit, 5),
				typeof args.categories === 'string' ? args.categories : undefined,
				typeof args.language === 'string' ? args.language : undefined,
			)
			return extractMcpToolResult('web_search', response)
		},
	})

	register({
		name: 'fetch_url',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('fetch_url'),
		handler: async (args) => {
			const url = typeof args.url === 'string' ? args.url.trim() : ''
			if (!url) throw new Error('url must be a non-empty string')
			const wikipediaRedirect = getWikipediaFetchRedirect(url)
			if (wikipediaRedirect) return wikipediaRedirect

			const client = getGeoClient()
			const maxLength = toFiniteNumber(args.maxLength)
			const response = await client.FetchUrl(url, maxLength)
			return extractMcpToolResult('fetch_url', response)
		},
	})

	register({
		name: 'wikipedia_lookup',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('wikipedia_lookup'),
		handler: async (args) => {
			const client = getGeoClient()
			const query =
				typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined
			const title =
				typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined
			const lat = toFiniteNumber(args.lat)
			const lon = toFiniteNumber(args.lon)
			const radius = toFiniteNumber(args.radius)
			const limit = toFiniteNumber(args.limit)
			const language = typeof args.language === 'string' ? args.language : undefined
			if (!query && !title && (lat === undefined || lon === undefined)) {
				throw new Error("Either 'query', 'title', or both 'lat' and 'lon' are required")
			}
			const response = await client.WikipediaLookup(query, title, lat, lon, radius, limit, language)
			return extractMcpToolResult('wikipedia_lookup', response)
		},
	})

	register({
		name: 'wikipedia_extract',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('wikipedia_extract'),
		handler: async (args) => {
			const client = getGeoClient()
			const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : undefined
			const title =
				typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined
			if (!url && !title) throw new Error("Either 'url' or 'title' is required")
			const language = typeof args.language === 'string' ? args.language : undefined
			const mode = args.mode === 'table' ? 'table' : args.mode === 'outline' ? 'outline' : undefined
			const tableIndex = toFiniteNumber(args.tableIndex)
			const rowOffset = toFiniteNumber(args.rowOffset)
			const rowLimit = toFiniteNumber(args.rowLimit)
			if (mode === 'table' && tableIndex === undefined) {
				throw new Error('tableIndex is required in table mode')
			}
			const response = await client.WikipediaExtract(
				url,
				title,
				language,
				mode,
				tableIndex,
				rowOffset,
				rowLimit,
			)
			return extractMcpToolResult('wikipedia_extract', response)
		},
	})
}

/** Editor `editor_*` commands self-register into the central registry (kind:'editor'). */
function registerEditorCommands(): void {
	for (const def of getEditorAiToolDefinitions()) {
		const toolName = def.name
		register({
			name: toolName,
			kind: 'editor',
			schema: {
				type: 'function',
				function: {
					name: def.name,
					description: def.description,
					parameters: def.parameters,
				},
			},
			handler: (args) => {
				const result = executeEditorAiTool(toolName, args)
				if (result === null) {
					// Should be unreachable — the command is registered by definition.
					throw new Error(`Editor command '${toolName}' is not available.`)
				}
				return result
			},
		})
	}
}

/** Populate the registry once, on module load. */
function bootstrapRegistry(): void {
	registerHostBuiltins()
	registerEditorWriters()
	registerRemoteMcpTools()
	registerEditorCommands()
	// `register` is injected (not imported by primitives-tools) to keep the
	// registry ↔ primitives-tools edge one-way and avoid a dev-bundler circular
	// init crash (null `./registry` at bootstrap). See primitives-tools.ts.
	registerPrimitiveTools(register)
	// Same injected-`register` idiom: ingest-tools registers place_dataset_features
	// (host-builtin) + batch_geocode (remote-mcp) without importing `./registry`
	// back (one-way edge; avoids the dev-bundler circular-init crash).
	registerIngestTools(register)
	// Same injected-`register` idiom: sandbox/runCode registers run_code
	// (code-interpreter). Importing it here ALSO pulls the QuickJS sandbox
	// transport into the app graph so the `.wasm` becomes reachable in the build.
	registerSandboxTools(register)
	// Same injected-`register` idiom: bulk-tools registers the read-only bulk tools
	// (select_features + validate_geometry; Plan 06-05 extends with the destructive
	// ones). bulk-tools imports ONLY a type from `./registry` back, so this edge is
	// one-way and does not form the Phase-2 circular-init cycle (Pitfall 4).
	registerBulkTools(register)
	// Same injected-`register` idiom: geometry-tools registers the gated
	// optimize_geometry tool (Phase 7, GEO-01/02/03). It imports ONLY a type from
	// `./registry` back, so this edge is one-way and does not form the Phase-2
	// circular-init cycle (Pitfall 6).
	registerGeometryTools(register)
	// Source selection and line-network pathfinding are host-owned facades: the
	// model asks for the result instead of orchestrating low-level plumbing.
	registerReferenceBoundaryTools(register)
	registerRoutingTools(register)
	registerCalloutTools(register)
	// Same injected-`register` idiom: search-tools registers search_entities +
	// query_entities_in_area (host-builtin relay queries over the src/lib/search
	// facade). It imports ONLY a type from `./registry` back (one-way edge).
	registerSearchTools(register)
	// Same injected-`register` idiom: geo-awareness-tools registers the read-only
	// measure + describe_location primitives (AI_GEO_AWARENESS §2/§5).
	registerGeoAwarenessTools(register)
	// Same injected-`register` idiom: entity-tools registers read_entity (the
	// full-content follow-up to search_entities' compact summaries).
	registerEntityTools(register)
	// Same injected-`register` idiom: story-tools registers the local-draft
	// composition pair read_story_draft + write_story_draft. Publishing a story
	// remains a user action in the StoryEditorPanel — no publish tool exists.
	registerStoryTools(register)
}

bootstrapRegistry()
