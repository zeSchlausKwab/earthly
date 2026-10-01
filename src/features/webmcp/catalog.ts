/** Curated map capabilities from the shared chat registry. No arbitrary synced server tools. */
export const BROWSER_EDITOR_TOOLS = [
	'find_features',
	'measure',
	'validate_geometry',
	'select_features',
	'write_geojson_to_editor',
	'add_feature_to_editor',
	'batch_edit_features',
	'dedup_features',
	'style_by_attribute',
	'extrude_line',
	'split_feature',
	'offset_feature',
	'create_line_corridor',
	'simplify_features',
	'optimize_geometry',
	'add_feature_callout',
	'add_feature_callouts',
	'update_feature_callout',
	'remove_feature_callout',
	'capture_map_snapshot',
	'set_dataset_metadata',
	'draw_circle',
	'buffer_feature',
	'route_over_network',
	'get_country_boundary',
	'get_reference_boundaries',
	'describe_location',
	'set_map_view',
	'fit_map_view',
	'set_basemap_style',
] as const

export const BROWSER_EXTERNAL_TOOLS = [
	'query_geography',
	'search_location',
	'reverse_lookup',
	'query_osm_by_id',
	'query_osm_nearby',
	'query_osm_bbox',
	'query_osm_area',
	'resolve_osm_entity',
	'get_osm_relation_geometry',
	'valhalla_route',
	'valhalla_isochrone',
	'import_osm_to_editor',
	'web_search',
	'fetch_url',
	'wikipedia_lookup',
	'wikipedia_extract',
] as const

export const READ_ONLY_TOOLS = new Set([
	'find_features',
	'measure',
	'validate_geometry',
	'capture_map_snapshot',
	'describe_location',
	'search_location',
	'reverse_lookup',
	'query_osm_nearby',
	'query_osm_bbox',
	'query_osm_area',
	'resolve_osm_entity',
	'web_search',
	'fetch_url',
	'wikipedia_lookup',
	'wikipedia_extract',
])

export const VIEW_TOOLS = new Set(['set_map_view', 'fit_map_view', 'set_basemap_style'])

export function needsExternalQueries(name: string, args: Record<string, unknown>): boolean {
	return (
		(BROWSER_EXTERNAL_TOOLS as readonly string[]).includes(name) ||
		(name === 'get_reference_boundaries' && args.level === 'admin1')
	)
}

export function mutatesDraft(name: string, args: Record<string, unknown>): boolean {
	if (READ_ONLY_TOOLS.has(name) || VIEW_TOOLS.has(name)) return false
	if (
		[
			'route_over_network',
			'get_country_boundary',
			'get_reference_boundaries',
			'query_geography',
			'query_osm_by_id',
			'get_osm_relation_geometry',
			'valhalla_route',
			'valhalla_isochrone',
		].includes(name)
	)
		return args.toEditor === true
	return true
}
