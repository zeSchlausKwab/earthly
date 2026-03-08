/**
 * Tool call executor - dispatches tool calls to the appropriate handler.
 */

import { useEditorStore } from '@/features/geo-editor/store'
import type { ToolCall, ToolResult } from './types'
import {
	DEFAULT_QUERY_LIMIT,
	DEFAULT_IMPORT_LIMIT,
	DEFAULT_SNAPSHOT_MAX_WIDTH,
	DEFAULT_SNAPSHOT_MAX_HEIGHT,
	TO_EDITOR_COMPATIBLE_TOOLS,
} from './types'
import {
	getGeoClient,
	serializeToolResult,
	extractMcpToolResult,
	toFiniteNumber,
	hasExplicitBbox,
	hasExplicitPoint,
	clampLimit,
	clampPositiveInt,
	clampRadiusMeters,
	normalizeFilters,
	normalizeFilterSets,
	asFeatureObject,
	ensureBbox,
	getEditorViewportBbox,
	featureMatchesName,
	normalizeGeoJsonToFeatures,
	parseGeoJsonArg,
	parseSingleFeatureArg,
	parseToolCallArguments,
	importFeaturesToEditor,
	toEditorFromToolResultValue,
	compactToolResultAfterBake,
} from './helpers'
import {
	getMapContextSnapshot,
	getCompactMapContextForTool,
	mapSnapshotCache,
	pruneSnapshotCache,
} from './context'
import { executeEditorAiTool } from './definitions'

export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
	const client = getGeoClient()

	try {
		const args = parseToolCallArguments(toolCall.function.arguments)

		let result: unknown

		switch (toolCall.function.name) {
			case 'get_editor_state': {
				const detail = args.detail === 'full' ? 'full' : 'compact'
				const snapshot = getMapContextSnapshot()
				result =
					detail === 'full'
						? snapshot
						: {
								...getCompactMapContextForTool(snapshot),
								detail,
							}
				break
			}
			case 'write_geojson_to_editor': {
				const payload = parseGeoJsonArg(args)
				const features = normalizeGeoJsonToFeatures(payload)
				const replaceExisting = Boolean(args.replaceExisting)
				const importResult = importFeaturesToEditor(features, replaceExisting)
				result = {
					importedCount: importResult.importedCount,
					skippedDuplicates: importResult.skippedDuplicates,
					totalFeaturesInEditor: importResult.totalFeaturesInEditor,
					replaceExisting,
				}
				break
			}
			case 'add_feature_to_editor': {
				const feature = parseSingleFeatureArg(args)
				const replaceExisting = Boolean(args.replaceExisting)
				const importResult = importFeaturesToEditor([feature], replaceExisting)
				result = {
					geometryType: feature.geometry.type,
					providedFeatureId:
						typeof feature.id === 'string' || typeof feature.id === 'number'
							? String(feature.id)
							: null,
					importedCount: importResult.importedCount,
					skippedDuplicates: importResult.skippedDuplicates,
					totalFeaturesInEditor: importResult.totalFeaturesInEditor,
					replaceExisting,
				}
				break
			}
			case 'capture_map_snapshot': {
				const store = useEditorStore.getState()
				if (!store.editor) {
					throw new Error('Map editor is not ready. Open the map editor first, then try again.')
				}

				const mimeType = args.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
				const quality =
					typeof args.quality === 'number' ? Math.max(0, Math.min(1, args.quality)) : 0.9
				const maxWidth = clampPositiveInt(args.maxWidth, DEFAULT_SNAPSHOT_MAX_WIDTH, 4096)
				const maxHeight = clampPositiveInt(args.maxHeight, DEFAULT_SNAPSHOT_MAX_HEIGHT, 4096)
				const capture = store.editor.captureMapSnapshot({
					mimeType,
					quality,
					maxWidth,
					maxHeight,
				})
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

				result = {
					snapshotId,
					mimeType,
					width: capture.width,
					height: capture.height,
					dataUrlLength: capture.dataUrl.length,
					mapView: snapshot.mapView,
				}
				break
			}
			case 'search_location': {
				const query = typeof args.query === 'string' ? args.query.trim() : ''
				if (!query) {
					throw new Error('query must be a non-empty string')
				}
				const response = await client.SearchLocation(query, clampLimit(args.limit, 5))
				result = extractMcpToolResult('search_location', response)
				break
			}
			case 'reverse_lookup': {
				const lat = toFiniteNumber(args.lat)
				const lon = toFiniteNumber(args.lon)
				const zoom = toFiniteNumber(args.zoom)
				if (lat === undefined || lon === undefined) {
					throw new Error('lat and lon must be valid numbers')
				}
				const response = await client.ReverseLookup(lat, lon, zoom)
				result = extractMcpToolResult('reverse_lookup', response)
				break
			}
			case 'query_osm_by_id': {
				const osmId = toFiniteNumber(args.osmId)
				if (
					typeof args.osmType !== 'string' ||
					!['node', 'way', 'relation'].includes(args.osmType)
				) {
					throw new Error('osmType must be one of: node, way, relation')
				}
				if (osmId === undefined) {
					throw new Error('osmId must be a valid number')
				}
				const response = await client.QueryOsmById(args.osmType, Math.floor(osmId))
				result = extractMcpToolResult('query_osm_by_id', response)
				break
			}
			case 'query_osm_nearby': {
				const lat = toFiniteNumber(args.lat)
				const lon = toFiniteNumber(args.lon)
				const radius = clampRadiusMeters(args.radius)
				const filters = normalizeFilters(args.filters)
				const filterSets = normalizeFilterSets(args.filterSets)
				if (lat === undefined || lon === undefined) {
					throw new Error('lat and lon must be valid numbers')
				}
				const response = await client.QueryOsmNearby(
					lat,
					lon,
					radius,
					filters,
					filterSets,
					clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
					Boolean(args.includeRelations),
				)
				result = extractMcpToolResult('query_osm_nearby', response)
				break
			}
			case 'query_osm_bbox': {
				const filters = normalizeFilters(args.filters)
				const filterSets = normalizeFilterSets(args.filterSets)
				if (!hasExplicitBbox(args)) {
					throw new Error('west, south, east, and north are required and must be numbers')
				}
				const west = toFiniteNumber(args.west) as number
				const south = toFiniteNumber(args.south) as number
				const east = toFiniteNumber(args.east) as number
				const north = toFiniteNumber(args.north) as number
				const response = await client.QueryOsmBbox(
					west,
					south,
					east,
					north,
					filters,
					filterSets,
					clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
					Boolean(args.includeRelations),
				)
				result = extractMcpToolResult('query_osm_bbox', response)
				break
			}
			case 'resolve_osm_entity': {
				const query = typeof args.query === 'string' ? args.query.trim() : ''
				if (!query) {
					throw new Error('query must be a non-empty string')
				}
				const response = await client.ResolveOsmEntity(
					query,
					clampPositiveInt(args.limit, 5, 10),
					typeof args.preferredOsmType === 'string' ? args.preferredOsmType : undefined,
					toFiniteNumber(args.adminLevel),
					typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined,
				)
				result = extractMcpToolResult('resolve_osm_entity', response)
				break
			}
			case 'get_osm_relation_geometry': {
				const relationId = toFiniteNumber(args.relationId)
				if (relationId === undefined) {
					throw new Error('relationId must be a valid number')
				}
				const precision =
					toFiniteNumber(args.coordinatePrecision) !== undefined
						? Math.max(
								3,
								Math.min(7, Math.floor(toFiniteNumber(args.coordinatePrecision) as number)),
							)
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
				result = extractMcpToolResult('get_osm_relation_geometry', response)
				break
			}
			case 'get_country_boundary': {
				const countryCode =
					typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined
				const name = typeof args.name === 'string' ? args.name.trim() : undefined
				if (!countryCode && !name) {
					throw new Error('countryCode or name is required')
				}
				const response = await client.GetCountryBoundary(
					countryCode || undefined,
					name || undefined,
					toFiniteNumber(args.adminLevel),
					toFiniteNumber(args.coordinatePrecision),
					toFiniteNumber(args.maxPointsPerRing),
				)
				result = extractMcpToolResult('get_country_boundary', response)
				break
			}
			case 'valhalla_route': {
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
				result = extractMcpToolResult('valhalla_route', response)
				break
			}
			case 'valhalla_isochrone': {
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
				result = extractMcpToolResult('valhalla_isochrone', response)
				break
			}
			case 'import_osm_to_editor': {
				const name = typeof args.name === 'string' ? args.name.trim() : ''
				const relationId = toFiniteNumber(args.relationId)

				const limit = clampLimit(args.limit, DEFAULT_IMPORT_LIMIT)
				const replaceExisting = Boolean(args.replaceExisting)
				const filters = normalizeFilters(args.filters)
				const filterSets = normalizeFilterSets(args.filterSets)
				const includeRelations = Boolean(args.includeRelations) || relationId !== undefined

				let source = 'viewport'
				let usedBbox: [number, number, number, number] | null = null
				let rawFeatures: unknown[] = []
				let usedSearchFallback = false

				const queryBbox = async (bbox: [number, number, number, number]) => {
					const response = await client.QueryOsmBbox(
						bbox[0],
						bbox[1],
						bbox[2],
						bbox[3],
						filters ?? undefined,
						filterSets,
						limit,
						includeRelations,
					)
					const queryResult = extractMcpToolResult('query_osm_bbox', response)
					return Array.isArray(queryResult.features) ? (queryResult.features as unknown[]) : []
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
						filters ?? undefined,
						filterSets,
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
							const searchCandidates = Array.isArray(searchResult.results)
								? searchResult.results
								: []
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
				const selected = matchedByName.length > 0 ? matchedByName : validFeatures

				const importResult = importFeaturesToEditor(selected, replaceExisting)

				result = {
					source,
					name: name || null,
					filters: filters ?? null,
					filterSets: filterSets ?? null,
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
				break
			}
			case 'web_search': {
				const query = typeof args.query === 'string' ? args.query.trim() : ''
				if (!query) {
					throw new Error('query must be a non-empty string')
				}
				const response = await client.WebSearch(
					query,
					clampLimit(args.limit, 5),
					typeof args.categories === 'string' ? args.categories : undefined,
					typeof args.language === 'string' ? args.language : undefined,
				)
				result = extractMcpToolResult('web_search', response)
				break
			}
			case 'fetch_url': {
				const url = typeof args.url === 'string' ? args.url.trim() : ''
				if (!url) {
					throw new Error('url must be a non-empty string')
				}
				const maxLength = toFiniteNumber(args.maxLength)
				const response = await client.FetchUrl(url, maxLength)
				result = extractMcpToolResult('fetch_url', response)
				break
			}
			case 'wikipedia_lookup': {
				const title =
					typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined
				const lat = toFiniteNumber(args.lat)
				const lon = toFiniteNumber(args.lon)
				const radius = toFiniteNumber(args.radius)
				const limit = toFiniteNumber(args.limit)
				const language = typeof args.language === 'string' ? args.language : undefined

				if (!title && (lat === undefined || lon === undefined)) {
					throw new Error("Either 'title' or both 'lat' and 'lon' are required")
				}
				const response = await client.WikipediaLookup(title, lat, lon, radius, limit, language)
				result = extractMcpToolResult('wikipedia_lookup', response)
				break
			}
			default: {
				const editorCommandResult = executeEditorAiTool(toolCall.function.name, args)
				if (editorCommandResult) {
					result = editorCommandResult
					break
				}
				throw new Error(`Unknown tool: ${toolCall.function.name}`)
			}
		}

		if (Boolean(args.toEditor) && TO_EDITOR_COMPATIBLE_TOOLS.has(toolCall.function.name)) {
			const bakeResult = toEditorFromToolResultValue(result, Boolean(args.replaceExisting))
			result = {
				...compactToolResultAfterBake(result),
				editorImport: bakeResult,
				toEditor: true,
			}
		}

		console.log('tool result', result)

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: serializeToolResult(result),
		}
	} catch (error) {
		const rawArguments =
			typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : ''
		const argumentPreview =
			rawArguments.length > 240 ? `${rawArguments.slice(0, 240)}...` : rawArguments
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify({
				tool: toolCall.function.name,
				error: error instanceof Error ? error.message : 'Tool execution failed',
				argumentsPreview: argumentPreview,
			}),
		}
	}
}
