/**
 * Tool definitions for AI chat.
 * Maps EarthlyGeoServer tools + local map editor actions
 * to OpenAI function calling format.
 */

import { executeEditorAiTool, getEditorAiToolDefinitions } from '@/features/geo-editor/commands'
import type { Tool } from './types'

export const editorCommandTools: Tool[] = getEditorAiToolDefinitions().map((tool) => ({
	type: 'function',
	function: {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	},
}))

export { executeEditorAiTool }

export const geoTools: Tool[] = [
	{
		type: 'function',
		function: {
			name: 'get_editor_state',
			description:
				"Get current map editor context (center, zoom, viewport bbox, feature count, mode). Returns compact output by default; use detail='full' only when needed.",
			parameters: {
				type: 'object',
				properties: {
					detail: {
						type: 'string',
						description:
							"Response detail level. 'compact' (default) omits large arrays like visible dataset ids. 'full' returns the full snapshot.",
						enum: ['compact', 'full'],
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'capture_map_snapshot',
			description:
				'Capture the current map viewport as a PNG/JPEG snapshot. Returns a snapshotId that can be forwarded to vision-capable models.',
			parameters: {
				type: 'object',
				properties: {
					mimeType: {
						type: 'string',
						description: 'Output image type',
						enum: ['image/png', 'image/jpeg'],
					},
					quality: {
						type: 'number',
						description: 'JPEG quality from 0 to 1 (ignored for PNG, default 0.9).',
					},
					maxWidth: {
						type: 'number',
						description: 'Optional max output width in pixels (default 1024).',
					},
					maxHeight: {
						type: 'number',
						description: 'Optional max output height in pixels (default 768).',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'write_geojson_to_editor',
			description:
				'Create features in the editor from GeoJSON. Accepts FeatureCollection, Feature, or Geometry. Use this for custom shapes and direct map edits. Prefer geojson object arguments; avoid large escaped JSON strings in geojsonText.',
			parameters: {
				type: 'object',
				properties: {
					geojson: {
						type: 'object',
						description:
							'GeoJSON payload. Can be a FeatureCollection, Feature, or Geometry object.',
					},
					geojsonText: {
						type: 'string',
						description:
							'GeoJSON payload as a JSON string. Use as fallback if object arguments are hard to produce.',
					},
					replaceExisting: {
						type: 'boolean',
						description:
							'If true, replace all current editor features with the provided GeoJSON. Default false (append).',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'add_feature_to_editor',
			description:
				'Add one generated GeoJSON feature to the editor. Preferred for direct LLM-authored geometry edits. Keep arguments compact and strictly valid JSON.',
			parameters: {
				type: 'object',
				properties: {
					feature: {
						type: 'object',
						description:
							'Optional full GeoJSON Feature object. If provided, geometry/properties/id fields are ignored.',
					},
					geometry: {
						type: 'object',
						description:
							'GeoJSON Geometry object (Point, LineString, Polygon, etc). Use this when passing a feature piecemeal.',
					},
					properties: {
						type: 'object',
						description: 'Optional GeoJSON feature properties object.',
					},
					id: {
						type: 'string',
						description: 'Optional feature id (string/number accepted; converted to string).',
					},
					replaceExisting: {
						type: 'boolean',
						description:
							'If true, replace existing editor features before adding this feature. Default false (append).',
					},
				},
			},
		},
	},
	...editorCommandTools,
	{
		type: 'function',
		function: {
			name: 'search_location',
			description:
				'Search for locations by name using OpenStreetMap. Returns coordinates, bounding boxes, and addresses.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The location query (e.g., "New York City", "Eiffel Tower")',
					},
					limit: {
						type: 'number',
						description: 'Maximum number of results (default: 5, max: 50)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reverse_lookup',
			description:
				'Get address information for coordinates. Useful for identifying what is at a specific location.',
			parameters: {
				type: 'object',
				properties: {
					lat: {
						type: 'number',
						description: 'Latitude coordinate in WGS84',
					},
					lon: {
						type: 'number',
						description: 'Longitude coordinate in WGS84',
					},
					zoom: {
						type: 'number',
						description: 'Level of detail (0-18, default 18). Lower = less detail.',
					},
				},
				required: ['lat', 'lon'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_by_id',
			description: 'Fetch one exact OpenStreetMap element by type and ID (node/way/relation).',
			parameters: {
				type: 'object',
				properties: {
					osmType: {
						type: 'string',
						description: 'OSM element type',
						enum: ['node', 'way', 'relation'],
					},
					osmId: {
						type: 'number',
						description: 'OSM element numeric ID',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import returned geometry directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['osmType', 'osmId'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_nearby',
			description:
				'Find OpenStreetMap features near a point. Can filter by tags like amenity=cafe, shop=supermarket. Set includeRelations=true for boundaries and route relations.',
			parameters: {
				type: 'object',
				properties: {
					lat: {
						type: 'number',
						description: 'Latitude coordinate',
					},
					lon: {
						type: 'number',
						description: 'Longitude coordinate',
					},
					radius: {
						type: 'number',
						description: 'Search radius in meters (1-5000, default 500)',
					},
					concept: {
						type: 'string',
						description:
							'Optional semantic concept to expand into common OSM tag families before querying, e.g. "military installation", "river", or "bench".',
					},
					filters: {
						type: 'object',
						description:
							'OSM tag filters like {"amenity":"cafe"} or {"military":["base","air_base"]}. Array values mean OR.',
					},
					filterSets: {
						type: 'array',
						description:
							'Optional OR-style filter groups. Pass an array of filter objects when one exact tag pattern is not enough.',
					},
					limit: {
						type: 'number',
						description: 'Maximum results to return (default 10, max 100)',
					},
					includeRelations: {
						type: 'boolean',
						description:
							'If true, include OSM relations in results (heavier but required for many boundaries).',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import returned geometries directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['lat', 'lon'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_bbox',
			description:
				'Find OpenStreetMap features within a bounding box. Can filter by tags. Set includeRelations=true for administrative boundaries.',
			parameters: {
				type: 'object',
				properties: {
					west: {
						type: 'number',
						description: 'Western longitude of bounding box',
					},
					south: {
						type: 'number',
						description: 'Southern latitude of bounding box',
					},
					east: {
						type: 'number',
						description: 'Eastern longitude of bounding box',
					},
					north: {
						type: 'number',
						description: 'Northern latitude of bounding box',
					},
					concept: {
						type: 'string',
						description:
							'Optional semantic concept to expand into common OSM tag families before querying, e.g. "military installation", "river", or "bench".',
					},
					filters: {
						type: 'object',
						description:
							'OSM tag filters like {"amenity":"restaurant"} or {"natural":["water","wetland"]}. Array values mean OR.',
					},
					filterSets: {
						type: 'array',
						description:
							'Optional OR-style filter groups. Use this when OSM uses multiple tagging patterns for the same thing.',
					},
					limit: {
						type: 'number',
						description: 'Maximum results to return (default 10, max 100)',
					},
					includeRelations: {
						type: 'boolean',
						description:
							'If true, include OSM relations (recommended for administrative boundaries).',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import returned geometries directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['west', 'south', 'east', 'north'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_area',
			description:
				'Find OpenStreetMap features constrained to a polygonal area. The area can come from the current selected polygon(s), an explicit polygon GeoJSON payload, a country boundary, or an OSM relation. Can also clip matching lines to the area or convert results to representative points. Always provide filters, filterSets, or concept; unfiltered area scans are too large for Overpass.',
			parameters: {
				type: 'object',
				properties: {
					selectedOnly: {
						type: 'boolean',
						description:
							'Use the currently selected polygon or multipolygon editor features as the query area.',
					},
					areaGeojson: {
						type: 'object',
						description:
							'Polygon or MultiPolygon GeoJSON area payload (Feature, FeatureCollection, or Geometry).',
					},
					countryCode: {
						type: 'string',
						description:
							'ISO alpha-2 country code for an administrative boundary area, e.g. "DE" or "SA".',
					},
					countryName: {
						type: 'string',
						description: 'Fallback country name when countryCode is not available.',
					},
					relationId: {
						type: 'number',
						description: 'Optional OSM relation id to use as the area geometry.',
					},
					concept: {
						type: 'string',
						description:
							'Optional semantic concept to expand into common OSM tag families before querying, e.g. "military installation", "river", or "bench".',
					},
					filters: {
						type: 'object',
						description:
							'OSM tag filters like {"amenity":"bench"} or {"military":["base","air_base"]}. Array values mean OR.',
					},
					filterSets: {
						type: 'array',
						description:
							'Optional OR-style filter groups. Use this when multiple OSM tagging patterns are likely.',
					},
					name: {
						type: 'string',
						description:
							'Optional feature name to match after the area query. Matching normalizes common whitespace, hyphenation, and alias variants.',
					},
					limit: {
						type: 'number',
						description: 'Maximum raw OSM features to fetch before area filtering (default 100, max 100).',
					},
					includeRelations: {
						type: 'boolean',
						description:
							'If true, include OSM relations in the raw query results (heavier but useful for routes/boundaries).',
					},
					spatialFilter: {
						type: 'string',
						description:
							'"intersects" keeps features touching the area. "point_within" keeps only features whose representative point lies inside the area.',
						enum: ['intersects', 'point_within'],
					},
					outputGeometry: {
						type: 'string',
						description:
							'"native" preserves geometry, "point_on_feature" converts each result to an interior representative point, "centroid" converts to centroid points.',
						enum: ['native', 'point_on_feature', 'centroid'],
					},
					clipLines: {
						type: 'boolean',
						description:
							'When outputGeometry="native", clip matching LineString/MultiLineString features to the polygon area. Default true.',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import filtered results directly into the editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'resolve_osm_entity',
			description:
				'Resolve a name/place to concrete OSM IDs before importing (best first step for administrative boundaries).',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: "Entity name, e.g. 'Vienna', 'Germany', 'Rhine'.",
					},
					limit: {
						type: 'number',
						description: 'Maximum candidates (default 5, max 10).',
					},
					preferredOsmType: {
						type: 'string',
						description: 'Prefer this OSM type.',
						enum: ['node', 'way', 'relation'],
					},
					adminLevel: {
						type: 'number',
						description: 'Optional admin level filter (2 country, 4 region/state, etc).',
					},
					countryCode: {
						type: 'string',
						description: "Optional ISO-2 country code to constrain matches, e.g. 'AT'.",
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_osm_relation_geometry',
			description:
				'Fetch one OSM relation by id and assemble geometry. Use after resolve_osm_entity for clean boundary imports.',
			parameters: {
				type: 'object',
				properties: {
					relationId: {
						type: 'number',
						description: 'OSM relation id.',
					},
					coordinatePrecision: {
						type: 'number',
						description: 'Optional coordinate decimal precision (3-7).',
					},
					maxPointsPerRing: {
						type: 'number',
						description: 'Optional max vertices per ring/path (50-20000).',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import the relation geometry directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['relationId'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_country_boundary',
			description:
				'Get a country administrative boundary relation (admin_level=2 by default) with cleaner geometry than generic bbox lookup.',
			parameters: {
				type: 'object',
				properties: {
					countryCode: {
						type: 'string',
						description: "ISO alpha-2 code, e.g. 'AT'.",
					},
					name: {
						type: 'string',
						description: "Fallback country name when countryCode isn't provided.",
					},
					adminLevel: {
						type: 'number',
						description: 'Boundary admin level (default 2).',
					},
					coordinatePrecision: {
						type: 'number',
						description: 'Optional coordinate precision (3-7).',
					},
					maxPointsPerRing: {
						type: 'number',
						description: 'Optional max vertices per ring/path.',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import the boundary geometry directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'valhalla_route',
			description:
				'Compute a route polyline from waypoints using Valhalla. Returns GeoJSON line geometry and summary.',
			parameters: {
				type: 'object',
				properties: {
					locations: {
						type: 'array',
						description: 'Route points as [{lat, lon}, ...] with at least two points.',
					},
					profile: {
						type: 'string',
						description: 'Travel profile/costing.',
						enum: ['auto', 'bicycle', 'pedestrian', 'bus', 'truck'],
					},
					units: {
						type: 'string',
						description: 'Distance units.',
						enum: ['kilometers', 'miles'],
					},
					baseUrl: {
						type: 'string',
						description: 'Optional Valhalla base URL override.',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import route geometry directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['locations'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'valhalla_isochrone',
			description:
				'Compute travel-time contours around a location using Valhalla. Returns GeoJSON contour features.',
			parameters: {
				type: 'object',
				properties: {
					location: {
						type: 'object',
						description: 'Center location as {lat, lon}.',
					},
					contoursMinutes: {
						type: 'array',
						description: 'Minute contours, e.g. [10,20,30].',
					},
					profile: {
						type: 'string',
						description: 'Travel profile/costing.',
						enum: ['auto', 'bicycle', 'pedestrian'],
					},
					polygons: {
						type: 'boolean',
						description: 'Return polygons if true (default true).',
					},
					baseUrl: {
						type: 'string',
						description: 'Optional Valhalla base URL override.',
					},
					toEditor: {
						type: 'boolean',
						description:
							'If true, import isochrone geometries directly into editor and return a compact import summary.',
					},
					replaceExisting: {
						type: 'boolean',
						description: 'Used when toEditor=true. If true, replaces current editor features.',
					},
				},
				required: ['location'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'import_osm_to_editor',
			description:
				'Import OSM features directly into the editor after narrowing candidates. Recommended flow: run query_osm_bbox/query_osm_nearby first, then import with explicit bbox/point + filters. Name is optional; omit it to import all matched features in the selected area.',
			parameters: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description:
							'Optional target feature name to match (example: "Rhine"). Omit to import all matched features.',
					},
					concept: {
						type: 'string',
						description:
							'Optional semantic concept to expand into common OSM tag families before querying, e.g. "military installation", "river", or "bench".',
					},
					relationId: {
						type: 'number',
						description:
							'Optional direct OSM relation id to import. Best for boundaries after resolve_osm_entity.',
					},
					west: {
						type: 'number',
						description: 'Optional bbox west longitude.',
					},
					south: {
						type: 'number',
						description: 'Optional bbox south latitude.',
					},
					east: {
						type: 'number',
						description: 'Optional bbox east longitude.',
					},
					north: {
						type: 'number',
						description: 'Optional bbox north latitude.',
					},
					lat: {
						type: 'number',
						description: 'Optional point latitude (uses nearby query when paired with lon).',
					},
					lon: {
						type: 'number',
						description: 'Optional point longitude (uses nearby query when paired with lat).',
					},
					radius: {
						type: 'number',
						description: 'Nearby query radius in meters (default 500).',
					},
					filters: {
						type: 'object',
						description:
							'Optional OSM tag filters (example: {"waterway":"river"} or {"military":["base","air_base"]}).',
					},
					filterSets: {
						type: 'array',
						description:
							'Optional OR-style filter groups for broader recall across multiple OSM tagging variants.',
					},
					limit: {
						type: 'number',
						description:
							'Max OSM features to fetch before filtering by name (default 100, max 100).',
					},
					includeRelations: {
						type: 'boolean',
						description:
							'If true, include relation results (recommended for boundaries and administrative areas).',
					},
					replaceExisting: {
						type: 'boolean',
						description:
							'If true, replace all editor features with imported set. Default false (append).',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'web_search',
			description:
				'Search the web for information. Returns titles, URLs, and content snippets. Useful for finding current information, facts, and context about places, topics, or anything else.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Search query string',
					},
					limit: {
						type: 'number',
						description: 'Maximum results (default 5, max 20)',
					},
					categories: {
						type: 'string',
						description: 'Search categories: "general", "science", "it", etc. (default: "general")',
					},
					language: {
						type: 'string',
						description: 'Language code (default: "en")',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'fetch_url',
			description:
				'Fetch a URL and extract its readable text content. Useful for reading articles, documentation, or any web page. Returns cleaned text with title and description.',
			parameters: {
				type: 'object',
				properties: {
					url: {
						type: 'string',
						description: 'The URL to fetch',
					},
					maxLength: {
						type: 'number',
						description: 'Max characters of text to return (default 10000, max 50000)',
					},
				},
				required: ['url'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'wikipedia_lookup',
			description:
				'Look up Wikipedia articles by title or geographic coordinates. For geo-mapping context, use lat/lon to find articles about nearby landmarks and places. Returns article summaries.',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Article title (e.g., "Mount Everest")',
					},
					lat: {
						type: 'number',
						description: 'Latitude for geographic search',
					},
					lon: {
						type: 'number',
						description: 'Longitude for geographic search',
					},
					radius: {
						type: 'number',
						description: 'Search radius in meters for geo lookup (default 1000)',
					},
					limit: {
						type: 'number',
						description: 'Max articles for geo search (default 5, max 10)',
					},
					language: {
						type: 'string',
						description: 'Wikipedia language code (default: "en")',
					},
				},
			},
		},
	},
]
