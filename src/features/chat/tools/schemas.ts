/**
 * Static OpenAI function-call schemas for the built-in geo/editor/remote-mcp
 * tools. These are the hand-authored schemas the registry co-locates with each
 * handler (`registry.ts` looks them up by name). Editor `editor_*` command
 * schemas are NOT here — those are derived from `getEditorAiToolDefinitions()`
 * at registration time. Keeping these in a dependency-free module avoids a
 * circular import between `registry.ts` and `definitions.ts`.
 */

import type { Tool } from './types'

/**
 * Look up a hand-authored OpenAI function schema by tool name. Shared by the
 * registry bootstrap and the injected tool modules (e.g. ingest-tools) so every
 * registered tool resolves its schema from this single dependency-free module.
 */
export function schemaFor(name: string): Tool {
	const schema = geoStaticToolSchemas.find((tool) => tool.function.name === name)
	if (!schema) {
		throw new Error(`Missing schema for registered tool '${name}'`)
	}
	return schema
}

export const geoStaticToolSchemas: Tool[] = [
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
			name: 'set_dataset_metadata',
			description:
				'Set DATASET-level metadata for the current dataset: its name, description, and arbitrary collection-level properties. ' +
				'Use this to NAME a dataset — do NOT stamp dataset_name/dataset_description onto every feature. ' +
				'Only provided fields are changed; properties are MERGED into the existing collection properties. Read current values via get_editor_state.',
			parameters: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description: 'Dataset name (the collection title shown in the dataset info panel).',
					},
					description: {
						type: 'string',
						description: 'Dataset description.',
					},
					properties: {
						type: 'object',
						description:
							'Arbitrary FeatureCollection-level properties (string/number/boolean values). Merged into existing properties; provide only the keys you want to set.',
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
				'Find OpenStreetMap features constrained to a polygonal area. The area can come from the current selected polygon(s), explicit areaGeojson, transient chat-attached geometry for the current request, a country boundary, or an OSM relation. Can also clip matching lines to the area or convert results to representative points. Always provide filters, filterSets, or concept; unfiltered area scans are too large for Overpass.',
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
						description:
							'Maximum raw OSM features to fetch before area filtering (default 100, max 100).',
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
	{
		type: 'function',
		function: {
			name: 'place_dataset_features',
			description:
				'Place ALL rows of an ingested dataset (referenced by its handle) onto the map as features, using a column-mapping rule. The host applies the mapping to every parsed row (not just the sampled rows you saw) and writes through the editor. Provide exactly one geometry source per row: lat+lon, a wkt column, or a geometry (GeoJSON) column. Rows whose coordinates are missing can be geocoded from a placeNameColumn. Coordinates are range-validated (lat -90..90, lon -180..180); out-of-range rows are skipped. Returns counts only.',
			parameters: {
				type: 'object',
				properties: {
					handleId: {
						type: 'string',
						description: 'The ingest handle id of the dataset to place (from the file summary).',
					},
					mapping: {
						type: 'object',
						description:
							'Which columns supply geometry and properties. Pick ONE geometry source: (lat AND lon) | wkt | geometry. name/description map to feature properties. placeNameColumn enables geocoding for rows lacking coordinates.',
						properties: {
							lat: { type: 'string', description: 'Column holding the latitude value.' },
							lon: { type: 'string', description: 'Column holding the longitude value.' },
							wkt: { type: 'string', description: 'Column holding a WKT geometry string.' },
							geometry: {
								type: 'string',
								description: 'Column holding a GeoJSON geometry (object or JSON string).',
							},
							name: { type: 'string', description: 'Column to map to the feature name property.' },
							description: {
								type: 'string',
								description: 'Column to map to the feature description property.',
							},
							placeNameColumn: {
								type: 'string',
								description:
									'Column with a place name to geocode when a row has no coordinates (single-row fallback uses search_location; for many rows prefer batch_geocode).',
							},
						},
					},
				},
				required: ['handleId', 'mapping'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'batch_geocode',
			description:
				'Geocode a place-name column of an ingested dataset in bulk, then place the located rows on the map. Bounded (max 50 rows per call), throttled to ~1 request/second to respect the geocoder usage policy, and de-duped (identical names are looked up once). Uses skip-and-report: rows that cannot be geocoded are reported, not placed. For a single pasted location, use search_location instead.',
			parameters: {
				type: 'object',
				properties: {
					handleId: {
						type: 'string',
						description: 'The ingest handle id of the dataset to geocode + place.',
					},
					placeNameColumn: {
						type: 'string',
						description: 'Column holding the place name to geocode for each row.',
					},
					mapping: {
						type: 'object',
						description: 'Optional name/description column mapping for the placed features.',
						properties: {
							name: { type: 'string', description: 'Column to map to the feature name property.' },
							description: {
								type: 'string',
								description: 'Column to map to the feature description property.',
							},
						},
					},
				},
				required: ['handleId', 'placeNameColumn'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'select_features',
			description:
				'READ-ONLY targeting tool (TOOLS-03 select). Returns which features in the ENTIRE bound dataset match a predicate — matched count, total, the matched feature ids, and a small name/id sample. Does NOT change the map (no style, no edit, no delete). The host reads the full dataset itself: you supply ONLY a predicate, never a feature/id list. Use this to scope before a batch edit, style, or dedup.',
			parameters: {
				type: 'object',
				properties: {
					predicate: {
						type: 'object',
						description:
							'A flat AND-list of clauses evaluated over each feature’s properties. Empty/omitted matches every feature.',
						properties: {
							all: {
								type: 'array',
								description:
									'Every clause must match (logical AND). Omit or use [] to match all features.',
								items: {
									type: 'object',
									properties: {
										field: {
											type: 'string',
											description:
												'The feature property key to test (read directly off properties; no nesting).',
										},
										op: {
											type: 'string',
											description:
												'Comparison operator. exists/missing take no value; in takes an array value; lt/lte/gt/gte take a number.',
											enum: [
												'eq',
												'neq',
												'exists',
												'missing',
												'contains',
												'in',
												'lt',
												'lte',
												'gt',
												'gte',
											],
										},
										value: {
											description:
												'The value to compare against (omit for exists/missing; array for in; number for lt/lte/gt/gte).',
										},
									},
									required: ['field', 'op'],
								},
							},
						},
						required: ['all'],
					},
				},
				required: ['predicate'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'validate_geometry',
			description:
				'READ-ONLY geometry validator (TOOLS-04). Scans the ENTIRE bound dataset (or an optional predicate-scoped subset) and reports topology problems: self-intersections, near-zero-area slivers, and invalid rings. Returns a report only — it does NOT fix or change anything on the map.',
			parameters: {
				type: 'object',
				properties: {
					predicate: {
						type: 'object',
						description:
							'Optional flat AND-list to limit the check to a subset. Omit to validate the whole dataset.',
						properties: {
							all: {
								type: 'array',
								description: 'Every clause must match (logical AND).',
								items: {
									type: 'object',
									properties: {
										field: {
											type: 'string',
											description: 'The feature property key to test.',
										},
										op: {
											type: 'string',
											description: 'Comparison operator.',
											enum: [
												'eq',
												'neq',
												'exists',
												'missing',
												'contains',
												'in',
												'lt',
												'lte',
												'gt',
												'gte',
											],
										},
										value: { description: 'The value to compare against (operator-dependent).' },
									},
									required: ['field', 'op'],
								},
							},
						},
						required: ['all'],
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'batch_edit_features',
			description:
				'Edit feature properties in BULK across the bound dataset (TOOLS-02). TWO modes. ' +
				'DECLARATIVE mode (mode:"declarative") is the default and is UNBOUNDED — you supply ONLY a ' +
				'predicate + a list of ops and the HOST applies them to EVERY matching feature in the full ' +
				'dataset (including features you never saw); you NEVER pass a feature/id list. Use this for ' +
				'rule-shaped edits ("set reviewed=true on all ports", "fill missing labels"). ' +
				'INTELLIGENCE mode (mode:"intelligence") is for per-feature values only YOU can compute ' +
				'(e.g. translating each name): supply `field` + a `valuesById` map of { featureId: value }. ' +
				'It is CAPPED at 100 edits per call — extra ids are reported and you rerun with the rest; ' +
				'unknown ids are skipped and counted. Every edit passes through the diff/preview safety gate.',
			parameters: {
				type: 'object',
				properties: {
					mode: {
						type: 'string',
						enum: ['declarative', 'intelligence'],
						description:
							'declarative = predicate + ops over ALL matching features (unbounded); intelligence = explicit id→value map (capped at 100).',
					},
					predicate: {
						type: 'object',
						description:
							'DECLARATIVE only. Flat AND-list selecting which features to edit. Empty/omitted matches every feature.',
						properties: {
							all: {
								type: 'array',
								description: 'Every clause must match (logical AND).',
								items: {
									type: 'object',
									properties: {
										field: { type: 'string', description: 'The feature property key to test.' },
										op: {
											type: 'string',
											description: 'Comparison operator.',
											enum: [
												'eq',
												'neq',
												'exists',
												'missing',
												'contains',
												'in',
												'lt',
												'lte',
												'gt',
												'gte',
											],
										},
										value: { description: 'The value to compare against (operator-dependent).' },
									},
									required: ['field', 'op'],
								},
							},
						},
						required: ['all'],
					},
					ops: {
						type: 'array',
						description:
							'DECLARATIVE only. The edit operations applied to every matching feature, in order.',
						items: {
							type: 'object',
							properties: {
								kind: {
									type: 'string',
									enum: ['set', 'copy', 'template', 'fillIfMissing'],
									description:
										'set: write `value` to `field`. copy: copy property `source` into `field`. template: write `template` with {propKey} interpolated from properties (missing key → empty). fillIfMissing: write `value` to `field` only when the existing value is absent/null/blank.',
								},
								field: { type: 'string', description: 'The target property key to write.' },
								value: { description: 'For set / fillIfMissing: the value to write.' },
								source: { type: 'string', description: 'For copy: the property key to read from.' },
								template: {
									type: 'string',
									description: 'For template: a string with {propKey} placeholders.',
								},
							},
							required: ['kind', 'field'],
						},
					},
					field: {
						type: 'string',
						description:
							'INTELLIGENCE only. The single property key each value in `valuesById` is written to.',
					},
					valuesById: {
						type: 'object',
						description:
							'INTELLIGENCE only. A map of { featureId: value }. Capped at 100 per call; unknown ids are skipped and counted; the remainder is reported so you can rerun.',
						additionalProperties: true,
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'dedup_features',
			description:
				'Delete duplicate features, keeping the FIRST of each duplicate group (TOOLS-03 dedup). ' +
				'Compare by `geometry` (default), by an attribute tuple (`attributes` + `keys`), or `both`. ' +
				'An optional predicate pre-scopes which features are considered. Deletions go through the ' +
				'diff/preview safety gate as a delete intent (you will be asked to confirm at the destructive level).',
			parameters: {
				type: 'object',
				properties: {
					by: {
						type: 'string',
						enum: ['geometry', 'attributes', 'both'],
						description:
							'How two features count as duplicates. Default geometry (identical shape). attributes/both require `keys`.',
					},
					keys: {
						type: 'array',
						items: { type: 'string' },
						description:
							'For by=attributes/both: the property keys whose tuple must match for two features to be duplicates.',
					},
					predicate: {
						type: 'object',
						description:
							'Optional flat AND-list to pre-scope dedup to a subset. Omit to consider the whole dataset.',
						properties: {
							all: {
								type: 'array',
								description: 'Every clause must match (logical AND).',
								items: {
									type: 'object',
									properties: {
										field: { type: 'string', description: 'The feature property key to test.' },
										op: {
											type: 'string',
											description: 'Comparison operator.',
											enum: [
												'eq',
												'neq',
												'exists',
												'missing',
												'contains',
												'in',
												'lt',
												'lte',
												'gt',
												'gte',
											],
										},
										value: { description: 'The value to compare against (operator-dependent).' },
									},
									required: ['field', 'op'],
								},
							},
						},
						required: ['all'],
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'style_by_attribute',
			description:
				'Apply data-driven styling to the bound dataset in ONE call (STYLE-01/STYLE-02). You supply ' +
				'`buckets`: each is a predicate + a style bag, and the HOST applies the matching style to ' +
				'every matching feature across the full dataset — this is ONE rule pass, NOT a per-feature ' +
				'recolor loop. Features matching no bucket are LEFT UNTOUCHED unless you supply a `fallback`. ' +
				'Style keys MUST be canonical: color, fillColor, strokeColor, fillOpacity, strokeOpacity, ' +
				'strokeWidth, radius, label (aliases fill/stroke/width/opacity are accepted). An unknown key ' +
				'is rejected so you can correct it. Styles persist as plain properties and survive save/reload. ' +
				'Changes pass through the diff/preview safety gate.',
			parameters: {
				type: 'object',
				properties: {
					buckets: {
						type: 'array',
						description: 'Each bucket styles every feature its predicate matches.',
						items: {
							type: 'object',
							properties: {
								predicate: {
									type: 'object',
									description: 'Flat AND-list selecting this bucket’s features.',
									properties: {
										all: {
											type: 'array',
											items: {
												type: 'object',
												properties: {
													field: {
														type: 'string',
														description: 'The feature property key to test.',
													},
													op: {
														type: 'string',
														description: 'Comparison operator.',
														enum: [
															'eq',
															'neq',
															'exists',
															'missing',
															'contains',
															'in',
															'lt',
															'lte',
															'gt',
															'gte',
														],
													},
													value: { description: 'The value to compare against.' },
												},
												required: ['field', 'op'],
											},
										},
									},
									required: ['all'],
								},
								style: {
									type: 'object',
									description:
										'Canonical style keys: color, fillColor, strokeColor, fillOpacity, strokeOpacity, strokeWidth, radius, label.',
									additionalProperties: true,
								},
							},
							required: ['predicate', 'style'],
						},
					},
					fallback: {
						type: 'object',
						description:
							'OPTIONAL. Applied ONLY to features no bucket matched. Omit to leave unmatched features untouched.',
						properties: {
							style: {
								type: 'object',
								description: 'Canonical style keys (same set as a bucket style).',
								additionalProperties: true,
							},
						},
						required: ['style'],
					},
				},
				required: ['buckets'],
			},
		},
	},
]
