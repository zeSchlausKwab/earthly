/**
 * Map context snapshot helpers for chat tool system messages.
 */

import {
	aggregateMeasurements,
	type DatasetMeasurements,
	summarizeFeatureMeasurements,
} from '@/features/geo-editor/api/measure'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { useEditorStore } from '@/features/geo-editor/store'
import { describeViewport } from '@/lib/geo/describeLocation'
import { getLoadedWorldLayer } from '@/lib/geo/worldData'
import { getSessionPublishes } from '@/lib/nostr/sessionPublishes'
import { lonLatToWorldGeohash } from '@/lib/worldGeohash'
import type { ChatMessage } from '../routstr'
import type { CachedMapSnapshot } from './types'
import { MAX_SNAPSHOT_CACHE_SIZE } from './types'
import { countFeaturesByGeometry } from './helpers'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import { serializedFeatureCollectionBytes } from '@/lib/geo/serializedSize'

export const mapSnapshotCache = new Map<string, CachedMapSnapshot>()

/**
 * Passive-companion dataset totals (AI_GEO_AWARENESS §2): delivered in every
 * context message so the model usually needn't call `measure` at all. Cached
 * by the store's features-array IDENTITY — Zustand replaces the array on any
 * mutation, so a WeakMap entry is exactly as fresh as the dataset.
 */
const datasetMeasurementCache = new WeakMap<EditorFeature[], DatasetMeasurements | null>()
const datasetSizeCache = new WeakMap<EditorFeature[], number>()

function getDatasetMeasurements(features: EditorFeature[]): DatasetMeasurements | null {
	if (datasetMeasurementCache.has(features)) {
		return datasetMeasurementCache.get(features) ?? null
	}
	const aggregates = aggregateMeasurements(features)
	datasetMeasurementCache.set(features, aggregates)
	return aggregates
}

function getDatasetSerializedBytes(features: EditorFeature[]): number {
	const cached = datasetSizeCache.get(features)
	if (cached !== undefined) return cached
	const bytes = serializedFeatureCollectionBytes(features)
	datasetSizeCache.set(features, bytes)
	return bytes
}

/**
 * Named viewport anchors (AI_GEO_AWARENESS §5): countries in view, a textual
 * description of the center, and the center geohash. Built synchronously from
 * the eagerly-preloaded world layers (absent until they resolve — the context
 * message simply omits the anchors then) and cached per rounded viewport so a
 * static map costs one computation, not one per message.
 */
interface ViewportAnchorSummary {
	countriesInView: string[]
	center: string
	geohash: string
}

const viewportAnchorCache = new Map<string, ViewportAnchorSummary | null>()
const MAX_ANCHOR_CACHE_SIZE = 16

function getViewportAnchors(
	viewport: [number, number, number, number] | null | undefined,
): ViewportAnchorSummary | null {
	if (!viewport || viewport.some((value) => !Number.isFinite(value))) return null
	const countries = getLoadedWorldLayer('countries_110m')
	const cities = getLoadedWorldLayer('cities_110m')
	const land = getLoadedWorldLayer('land_50m')
	const coastline = getLoadedWorldLayer('coastline_110m')
	if (!countries && !cities && !land) return null

	const key = viewport.map((value) => value.toFixed(2)).join(',')
	const cached = viewportAnchorCache.get(key)
	if (cached !== undefined) return cached

	const anchors = describeViewport({ land, countries, cities, coastline }, viewport)
	const centerLon = (viewport[0] + viewport[2]) / 2
	const centerLat = (viewport[1] + viewport[3]) / 2
	const summary: ViewportAnchorSummary = {
		countriesInView: anchors.countriesInView,
		center: anchors.center.text,
		geohash: lonLatToWorldGeohash(6, centerLon, centerLat),
	}
	if (viewportAnchorCache.size >= MAX_ANCHOR_CACHE_SIZE) {
		const oldestKey = viewportAnchorCache.keys().next().value
		if (oldestKey !== undefined) viewportAnchorCache.delete(oldestKey)
	}
	viewportAnchorCache.set(key, summary)
	return summary
}

export function getMapContextSnapshot() {
	const store = useEditorStore.getState()
	const viewport = store.editor?.getMapBounds() ?? store.currentBbox
	const center = store.editor?.getMapCenter() ?? null
	const zoom = store.editor?.getMapZoom() ?? null
	const selectedFeatures = new Set(store.selectedFeatureIds)
	const selectedEditorFeatures = store.features.filter((feature) =>
		selectedFeatures.has(feature.id),
	)
	const selectedSummary = selectedEditorFeatures.slice(0, 20).map((feature) => {
		// Passive measurements (AI_GEO_AWARENESS §2): the model frequently needs
		// length/area of what the user selected — injecting them here means it
		// often doesn't have to call `measure` at all. (undefined keys drop out
		// of the JSON serialization.)
		const measurements = summarizeFeatureMeasurements(feature)
		return {
			id: feature.id,
			geometryType: feature.geometry?.type ?? 'Unknown',
			name: typeof feature.properties?.name === 'string' ? feature.properties?.name : undefined,
			lengthKm: measurements?.lengthKm,
			areaKm2: measurements?.areaKm2,
		}
	})
	const visibleMapLayers = store.mapLayers
		.filter((layer) => layer.enabled)
		.map((layer) => ({
			id: layer.id,
			title: layer.title,
			kind: layer.kind,
			opacity: layer.opacity,
		}))
	// Round D.3: visibility is no longer a separate slice — the map stack is
	// the single source of truth. A dataset is "visible" iff it has an entry
	// on the stack (including curated datasets surfaced via context entries).
	const visibleDatasetIds = store.mapStackOrder
		.map((entryId) => store.mapStackEntries[entryId])
		.filter(
			(entry): entry is NonNullable<typeof entry> =>
				entry !== undefined && entry.entityType === 'dataset' && entry.visible !== false,
		)
		.map((entry) => entry.entityKey)

	// Dataset-level (FeatureCollection-level) metadata the model can READ before
	// changing it via set_dataset_metadata / authoring.setDatasetMetadata. Lets the
	// model see the existing dataset name/description instead of guessing.
	const datasetMetadata = {
		name: store.collectionMeta.name,
		description: store.collectionMeta.description,
		color: store.collectionMeta.color,
		customProperties: store.collectionMeta.customProperties,
	}
	const activeDataset = store.activeDataset
		? {
				address: `37515:${store.activeDataset.pubkey}:${store.activeDataset.dTag ?? ''}`,
				eventId: store.activeDataset.event.id,
				version: store.activeDataset.version ?? null,
			}
		: null
	const serializedBytes = getDatasetSerializedBytes(store.features)

	return {
		editorReady: Boolean(store.editor),
		mode: store.mode,
		datasetMetadata,
		activeDataset,
		localDraftDirty: store.isDirty,
		featureCount: store.features.length,
		datasetSize: {
			serializedBytes,
			limitBytes: BLOSSOM_UPLOAD_THRESHOLD_BYTES,
			overLimit: serializedBytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		},
		datasetMeasurements: getDatasetMeasurements(store.features),
		selectedFeatureCount: store.selectedFeatureIds.length,
		selectedFeatures: selectedSummary,
		selectedFeatureGeometryCounts: countFeaturesByGeometry(selectedEditorFeatures),
		featureGeometryCounts: countFeaturesByGeometry(store.features),
		viewportBbox: viewport,
		mapCenter: center,
		mapZoom: zoom,
		mapView: {
			center,
			zoom,
			bbox: viewport,
		},
		viewportAnchors: getViewportAnchors(viewport),
		visibleLayers: visibleMapLayers,
		visibleDatasets: visibleDatasetIds,
		mapSource: store.mapSource,
	}
}

export function getCompactMapContextForPrompt(snapshot: ReturnType<typeof getMapContextSnapshot>) {
	const selectedFeatureHints = snapshot.selectedFeatures.slice(0, 4).map((feature) => ({
		geometryType: feature.geometryType,
		name: feature.name ?? null,
		...(feature.lengthKm !== undefined ? { lengthKm: feature.lengthKm } : {}),
		...(feature.areaKm2 !== undefined ? { areaKm2: feature.areaKm2 } : {}),
	}))

	const visibleLayerIds = snapshot.visibleLayers.map((layer) => layer.id).slice(0, 8)

	return {
		editorReady: snapshot.editorReady,
		mode: snapshot.mode,
		activeDataset: snapshot.activeDataset,
		localDraftDirty: snapshot.localDraftDirty,
		featureCount: snapshot.featureCount,
		datasetSize: snapshot.datasetSize,
		datasetMeasurements: snapshot.datasetMeasurements,
		selectedFeatureCount: snapshot.selectedFeatureCount,
		mapView: snapshot.mapView,
		viewportAnchors: snapshot.viewportAnchors,
		featureGeometryCounts: snapshot.featureGeometryCounts,
		selectedFeatureGeometryCounts: snapshot.selectedFeatureGeometryCounts,
		mapSource: snapshot.mapSource,
		enabledLayerCount: snapshot.visibleLayers.length,
		visibleLayerIds,
		visibleDatasetCount: snapshot.visibleDatasets.length,
		selectedFeatureHints,
	}
}

export function getCompactMapContextForTool(snapshot: ReturnType<typeof getMapContextSnapshot>) {
	return {
		editorReady: snapshot.editorReady,
		mode: snapshot.mode,
		datasetMetadata: snapshot.datasetMetadata,
		featureCount: snapshot.featureCount,
		datasetSize: snapshot.datasetSize,
		datasetMeasurements: snapshot.datasetMeasurements,
		selectedFeatureCount: snapshot.selectedFeatureCount,
		featureGeometryCounts: snapshot.featureGeometryCounts,
		selectedFeatureGeometryCounts: snapshot.selectedFeatureGeometryCounts,
		viewportBbox: snapshot.viewportBbox,
		mapCenter: snapshot.mapCenter,
		mapZoom: snapshot.mapZoom,
		mapView: snapshot.mapView,
		mapSource: snapshot.mapSource,
		enabledLayerCount: snapshot.visibleLayers.length,
		visibleLayerIds: snapshot.visibleLayers.map((layer) => layer.id).slice(0, 8),
		visibleDatasetCount: snapshot.visibleDatasets.length,
		selectedFeatureHints: snapshot.selectedFeatures.slice(0, 6).map((feature) => ({
			id: feature.id,
			geometryType: feature.geometryType,
			name: feature.name ?? null,
		})),
	}
}

export type PromptProfile = 'compact' | 'legacy'

interface MapContextPromptOptions {
	isContinuation?: boolean
	continuationRequest?: string
}

function continuationInstruction(options: MapContextPromptOptions): string | null {
	if (!options.isContinuation) return null
	const request = options.continuationRequest?.trim().slice(0, 4_000)
	return [
		'CONTINUATION — resume the latest unfinished user request from the CURRENT map state. Preserve completed work, do not restart or duplicate it, change strategy if the previous run looped, and finish the remaining parts.',
		...(request ? [`Original user request to finish: ${JSON.stringify(request)}`] : []),
	].join('\n')
}

function firstVisibleGeometryInstruction(): string {
	return [
		'FIRST VISIBLE GEOMETRY — authoring requests are judged by map progress, not the amount researched.',
		'Before open-ended research, establish the first visible geometry within the first few tool rounds.',
		'A small accurate scaffold is valid: write verified anchors or points already supported by the source, set useful metadata, then continue research and replace or enhance that scaffold with higher-quality boundaries and network-derived routes. Never invent geometry merely to satisfy this milestone.',
	].join(' ')
}

function createLegacyMapContextSystemMessage(
	options: MapContextPromptOptions = {},
): ChatMessage | null {
	const snapshot = getMapContextSnapshot()
	const compact = getCompactMapContextForPrompt(snapshot)
	const sessionPublishBlock = buildSessionPublishContextMessage()
	return {
		role: 'system',
		content: [
			'You have map-editing tool access in this chat.',
			...(continuationInstruction(options) ? [continuationInstruction(options) as string] : []),
			firstVisibleGeometryInstruction(),
			'BASEMAP IS CONTEXT — roads, place names, terrain, water, and surrounding political geography already visible in the basemap do not need to become editor features. Author a surrounding country/state boundary only when it is requested or materially encodes the map theme; never import neighboring places merely to provide background context.',
			'DATA SOURCE ORDER — pick the FIRST tier that can answer: (1) BUNDLED WORLD LAYERS via run_code (instant, local, no network): country outlines/areas/borders, coastlines, offshore work, major named rivers/lakes, land-vs-water tests, world cities, sea routing. (2) OSM tools ONLY for what world layers do not carry: POIs, streets, buildings, small/local admin areas, fine local geometry — they are SLOW remote calls, so keep queries bounded; CEP-22 transports complete large results but cannot prevent upstream Overpass timeouts. (3) wikipedia_lookup/web_search for facts; when a Wikipedia table is the actual dataset, use wikipedia_extract outline then paged table rows instead of fetch_url. (4) fetch_url for non-Wikipedia pages. Never use web text as geometry. Do NOT "verify" world-layer computations against OSM or the web — state the resolution caveat instead.',
			'REFERENCE BOUNDARIES — use get_reference_boundaries as the source-selecting facade. Nation-state/country outlines ALWAYS come from its bundled Natural Earth country layer, never OSM, and may be batched. States/provinces/admin-1 regions use a slower OSM-backed path and may also be batched in one call. If it remains unavailable, continue with accurate verified anchors and other map content, clearly noting the omitted boundary; do not hunt the web for raw boundary GeoJSON. Do not author boundaries that only duplicate basemap context.',
			'ROUTE ALIGNMENT — when the user expects a route or corridor to follow transport geography, geometry must be network-derived: use valhalla_route for road, bus, bicycle, pedestrian, and truck alignments; use route_over_network for maritime lanes or an actual rail/river/canal/custom LineString network in the editor. Import the needed line network first when necessary. Air links and explicitly schematic/historical corridors may be stylized, but mark mappingBasis and geometryPrecision="schematic". Never silently substitute coarse hand-drawn or nearly straight lines for available routing.',
			'MAP CALLOUTS — an Earthly map callout is authored contextual content that belongs to and is stored on an existing geometry. It is always visible without hover or selection. Use add_feature_callout or one atomic add_feature_callouts batch. Never simulate a map callout by creating a Point, label, icon, popup, annotation, or a feature with type="callout".',
			'SOURCE-PROVIDED SPATIAL DATA — before geocoding, inspect structured source rows, files, and API results for usable spatial fields such as latitude/longitude, coordinate pairs, GeoJSON, WKT, or geohashes. Normalize those values and preserve their source precision and provenance. Geocode only rows whose source genuinely lacks usable spatial data.',
			'RESEARCH BUDGET — keep research proportional to the requested map. Batch independent lookups when a tool supports it, reuse facts and coordinates already returned, and stop researching once authoritative sources are sufficient to build the requested result. Do not repeatedly verify the same settled fact through different search tools.',
			'WORKFLOW COMPLETION — carry an agreed multi-step request through to its final artifact unless a real blocker requires user input. Do not pause after an intermediate map write merely to ask whether to continue. If the user asked for both a dataset and a Story, finish the dataset first and then write or update the Story draft in the same workflow.',
			'STRUCTURED EXTRACTION PAGINATION — in a table result, pagination.status="complete" is the only status that means the response contains the full table. status="more" requires the nextOffset page; status="final_page" still omits earlier rows. Outline sampleRows are previews, but table rows accompanied by status="complete" are not.',
			'RESEARCHED DATASETS — preserve provenance on every derived feature: sourceUrl, sourceTitle, sourceRevisionId, sourceSection, sourceTable, sourceRow, sourceRetrievedAt, and coordinatePrecision (exact, approximate, or representative). Keep the source classification verbatim; do not silently broaden terms such as exclave to enclave, disputed territory, or historical case. After the first accurate scaffold is visible, build and validate each bounded enhancement before an atomic authoring.commitDataset(...) replacement or update.',
			'HISTORICAL PRECISION — distinguish historical administrative entities from present-day boundary proxies and special-status cities. State the mapping basis in dataset metadata instead of presenting modern boundaries as exact historical jurisdictions.',
			'World layers are GENERALIZED cartography (1:110m / 1:50m). Rankings, topology, routing, and anchoring are reliable; ABSOLUTE lengths of fractal features (coastlines!) are systematic underestimates — say so when reporting them instead of hunting for other sources.',
			'If the user asks to draw/create/edit map features, call tools instead of replying that you cannot edit the map.',
			'For simple draw requests that are not real-world network alignments, generate GeoJSON yourself and call add_feature_to_editor or write_geojson_to_editor directly.',
			'To name or describe the dataset (or set collection-level properties), call set_dataset_metadata — or authoring.setDatasetMetadata(...) inside run_code. Do NOT stamp dataset_name/dataset_description onto every feature. Read the current dataset name/description from get_editor_state (datasetMetadata) before changing it.',
			'For a Point icon, style the feature with displayIcon using a bundled Lucide id such as `lucide:tree-pine` or `lucide:anchor`; do not substitute emoji labels, colors, or image URLs. In a semantic POI map, every imported Point must receive a meaningful category icon rather than remaining a plain colored dot—for example `lucide:trees` for parks, `lucide:store` for groceries, `lucide:train-front` for rail/metro, and `lucide:landmark` for a destination anchor.',
			'MAP LEGIBILITY — `label` is literal display text, never a template. Do not write `{name}`, dollar-braced name expressions, or other placeholders into it. Keep the real feature name in `name`; omit `label` on dense/bulk results and label only a small set of anchors that remain readable at the current zoom.',
			'For multi-category POI or amenity maps, make the overview useful rather than exhaustive unless the user explicitly asks for every result: keep roughly 6–12 nearest or representative named features per category, give categories distinct colors/icons, and avoid importing hundreds of overlapping markers.',
			'TRAVEL-TIME OVERLAYS — keep isochrones visually subordinate to the POIs and basemap. Unless the user requests another palette, use a cool blue/cyan fill (never yellow or orange), fillOpacity 0.08–0.12, strokeOpacity 0.45–0.65, and strokeWidth no greater than 2. The overlay should remain readable without washing out streets or icons.',
			'For many OSM features in an area (e.g. all military bases in viewport), prefer import_osm_to_editor with filters and bbox/point instead of embedding large GeoJSON argument strings.',
			'For polygon-constrained searches (selected polygon, country border, custom area), prefer query_osm_area.',
			'Do not call query_osm_area as an unfiltered scan. Always include filters, filterSets, or concept.',
			'For requested administrative reference boundaries, use get_reference_boundaries. Use low-level resolve_osm_entity/get_osm_relation_geometry only when the user explicitly needs a particular OSM entity or relation.',
			'For network routing use valhalla_route or route_over_network; for travel-time polygons use valhalla_isochrone.',
			'Measurements are delivered passively: datasetMeasurements holds dataset totals and selected-feature hints carry lengthKm/areaKm2 — read those first. Call measure (one operation per call) only for something not already in context (distance/bearing between points, perimeter, centroid, bbox, nearest_point).',
			'To ground coordinates in named places (country, nearest city, on-land/on-water, distance to coast), call describe_location with a point or bbox. Use it to sanity-check where drawn geometry actually landed.',
			'viewportAnchors in the map state names what the user is looking at (countries in view, center description, geohash) — trust it over guessing from raw coordinates.',
			'When a geometry-producing tool supports it, set toEditor=true to import directly and keep tool results compact.',
			'If the user says "within this polygon" or explicitly attaches the current selection, use query_osm_area with selectedOnly=true.',
			'If the user attached transient chat geometry, query_osm_area can use that attached geometry directly for the current request even when nothing is selected in the editor.',
			'Use the concept argument when the user intent is semantic but OSM tagging is likely inconsistent. High-value examples: concept="military installation", concept="river", concept="bench".',
			'If the user asks for points only, set outputGeometry="point_on_feature" unless exact point features already exist.',
			'If the user asks for a LOCAL line feature within a border (a specific stream, canal, road, trail), use query_osm_area with clipLines=true to keep geometry inside the area. NEVER query OSM for a country-scale coastline or a major river — that is world.get("coastline_110m") / world.get("rivers_50m") territory.',
			'If a border-constrained or polygon-constrained query fails, do not replace it with an unconstrained bbox import. Retry with the same area constraint or report the failure.',
			'For toolbar-like operations (undo/redo/mode/selection ops), use editor_* tools.',
			'For add_feature_to_editor, send one feature per call with compact JSON.',
			'Do not ask the user for intermediate geometry parameters unless they explicitly want to customize shape details.',
			'For OSM imports, first query candidates with query_osm_bbox/query_osm_nearby, verify non-empty results, then import with explicit bbox/point and filters.',
			'When exact OSM tags are brittle, prefer filters with array values or filterSets to cover multiple tagging variants in one query.',
			'Think in OSM tags and aliases: military often spans military=*, landuse=military, and building=bunker; local rivers are waterway=river (MAJOR rivers come from world.get("rivers_50m") instead); benches are usually amenity=bench.',
			'When calling a tool, output strict JSON arguments only.',
			'For well-known places (capitals, countries, major cities), use their known coordinates directly instead of geocoding. Only call search_location for genuinely ambiguous or unknown places.',
			'Do not fetch OSM relation geometry or query OSM unless the task explicitly needs real boundary or feature geometry. For a simple shape (arc, circle, line between known points), compute it yourself or with run_code+turf.',
			'In run_code, the result is the final bare expression OR a top-level `return <value>` (both work). Only `data`, `turf`, `authoring`, `console`, `world`, and `pathfinder` exist — there is no fetch/Buffer/process/require/window/document.',
			'For a route along a real network (sea lanes, rivers), use run_code with pathfinder("maritime_network", from, to) or another world layer/line dataset — never hand-emit long coordinate streams from memory.',
			'For MAJOR named natural features (big rivers like the Danube/Rhine/Nile, coastlines, country outlines), use the bundled world layers in run_code (e.g. world.get("rivers_50m") filtered by properties.name, world.get("countries_110m")) — NOT OSM. Continent-scale OSM relations remain slow and failure-prone upstream even though CEP-22 can transport their complete results. Use OSM only for local/detailed features.',
			'For land/water splitting (offshore lines, "how much crosses land"), use world.isOnLand([lon,lat]) per vertex inside run_code — do not marshal the land mask yourself.',
			'Recipe — offshore offset line ("follow the coastline of X, N km out to sea"), ONE run_code call, no OSM: take the country polygon from world.get("countries_110m"), ring = turf.polygonToLine(turf.buffer(country, N, {units:"kilometers"})), split the ring into segments and keep those whose midpoint has world.isOnLand(mid) === false, then authoring.writeGeoJSON the kept segments.',
			'Trust tool results: after a successful authoring write (a tool result with created/updated/deleted counts), do NOT re-verify with capture_map_snapshot or get_editor_state. The write result is authoritative.',
			'To compose a long-form article/story, use write_story_draft. Omit storyReference for a new Story; pass the existing Story naddr to update it in edit mode. Use read_entity first to pull the published Story and dataset inventory. Prefer the ready-to-cite feature references returned in that inventory; coordinates use geo:latitude,longitude and OSM elements use canonical openstreetmap.org URLs. If you refine cited dataset features later in the request, refresh the same Story draft rather than stopping to ask whether it should be updated. You cannot publish — the user reviews and publishes in the Story editor.',
			...(sessionPublishBlock ? [sessionPublishBlock] : []),
			`Current map state JSON:\n${JSON.stringify(compact)}`,
		].join('\n\n'),
	}
}

/**
 * The compact prompt deliberately leaves tool-specific behavior in the tool
 * descriptions. This keeps the invariant-bearing policy here, while avoiding
 * paying for dozens of recipes on every model round.
 */
function createCompactMapContextSystemMessage(
	toolNames: readonly string[],
	options: MapContextPromptOptions = {},
): ChatMessage | null {
	const snapshot = getMapContextSnapshot()
	const compact = getCompactMapContextForPrompt(snapshot)
	const sessionPublishBlock = buildSessionPublishContextMessage()
	const hasStoryTools = toolNames.some((name) => name.includes('story'))
	const hasResearchTools = toolNames.some((name) =>
		['web_search', 'wikipedia_lookup', 'wikipedia_extract', 'fetch_url'].includes(name),
	)
	const hasAuthoringTools = toolNames.some((name) =>
		/^(write_|add_|set_|batch_|style_|draw_|buffer_|offset_|split_|create_|import_)/.test(name),
	)
	const hasAdministrativeBoundaryTools = toolNames.includes('get_reference_boundaries')
	const hasRoutingTools = toolNames.some((name) =>
		['valhalla_route', 'route_over_network'].includes(name),
	)
	const hasCalloutTools = toolNames.some((name) => name.includes('feature_callout'))

	return {
		role: 'system',
		content: [
			"You are Earthly's spatial assistant. Tool descriptions are authoritative; use only the advertised tools.",
			...(continuationInstruction(options) ? [continuationInstruction(options) as string] : []),
			firstVisibleGeometryInstruction(),
			'INTENT GATE — answer advisory, explanatory, and planning questions without changing the map. Mutate only when the user explicitly asks to create, add, draw, import, edit, update, or delete something.',
			'BASEMAP IS CONTEXT — do not author surrounding countries, regions, roads, labels, terrain, or water merely as background. Add a boundary only when requested or thematically meaningful.',
			'SOURCE ORDER — use bundled world layers for generalized country/coastline/major-river/world-city work; OSM for local POIs, streets, buildings, and detailed local geometry; web/Wikipedia for facts, never geometry. Nation-state boundaries always use bundled Natural Earth through get_reference_boundaries, never OSM. Inspect source-provided coordinates/GeoJSON/WKT before geocoding. Do not repeatedly verify an authoritative result.',
			'PRECISION — preserve provenance and coordinate precision. Label geometry as schematic, generalized, network-derived, or exact as appropriate; never imply remembered or hand-drawn geometry follows a real network. Historical maps must state whether modern boundaries are proxies.',
			'EXECUTION — complete the requested artifact unless genuinely blocked. Prefer one atomic batch write. Trust a successful authoring result; do not re-read the editor merely to verify it. If a tool fails, change approach instead of repeating identical calls.',
			...(hasAuthoringTools
				? [
						'AUTHORING — when the user asks for a map change, use the advertised write tools; never claim the editor is read-only. Set collection metadata at dataset level, not on every feature. Keep literal labels sparse, use meaningful bundled Lucide icons for semantic points, and validate the complete result before committing.',
					]
				: []),
			...(hasAdministrativeBoundaryTools
				? [
						'REFERENCE BOUNDARIES — use level=country for nation states and batch them freely. Requested states/provinces/regions may also be batched in one level=admin1 call, though that path is remote. If it remains unavailable, continue with accurate verified anchors and note the omission; do not search the web for GeoJSON or orchestrate low-level OSM calls.',
					]
				: []),
			...(hasRoutingTools
				? [
						'ROUTING — expected transport alignments must be network-derived. Use valhalla_route for road/bus/bicycle/pedestrian/truck and route_over_network for maritime or actual rail/river/canal/custom line networks. Import a needed network first. Air or explicitly schematic/historical links may be stylized only when clearly marked schematic. Never silently draw coarse straight substitutes.',
					]
				: []),
			...(hasCalloutTools
				? [
						'MAP CALLOUTS — a map callout belongs to and is stored on an existing geometry; it is always visible without hover or selection. Use add_feature_callout or one atomic add_feature_callouts batch. Never simulate one with a Point, label, icon, popup, annotation, or a feature whose type is "callout".',
					]
				: []),
			...(hasResearchTools
				? [
						'RESEARCH — keep calls proportional, batch when supported, reuse returned facts and coordinates, preserve source URLs/revisions/rows, and stop once sources are sufficient.',
					]
				: []),
			...(hasStoryTools
				? [
						'STORIES — read the published Story or local draft before updating it, preserve existing content unless replacement is explicit, and use canonical encoded Nostr feature references. Warn when cited dataset edits are still unpublished.',
					]
				: []),
			...(sessionPublishBlock ? [sessionPublishBlock] : []),
			`Current map state JSON:\n${JSON.stringify(compact)}`,
		].join('\n\n'),
	}
}

export function createMapContextSystemMessage(
	profile: PromptProfile = 'legacy',
	toolNames: readonly string[] = [],
	options: MapContextPromptOptions = {},
): ChatMessage | null {
	return profile === 'legacy'
		? createLegacyMapContextSystemMessage(options)
		: createCompactMapContextSystemMessage(toolNames, options)
}

/** Compact model-facing breadcrumb block for the current request. */
export function buildSessionPublishContextMessage(): string | undefined {
	const sessionPublishes = getSessionPublishes()
	if (sessionPublishes.length === 0) return undefined
	return `Entities the user published THIS session (freshest references — prefer these when the user refers to "what I just published"):\n${sessionPublishes
		.map((entry) => `- [${entry.type}] "${entry.name}" → ${entry.mention ?? entry.coordinate}`)
		.join('\n')}`
}

export function pruneSnapshotCache() {
	if (mapSnapshotCache.size <= MAX_SNAPSHOT_CACHE_SIZE) return
	const oldest = [...mapSnapshotCache.values()]
		.sort((a, b) => a.createdAt - b.createdAt)
		.slice(0, mapSnapshotCache.size - MAX_SNAPSHOT_CACHE_SIZE)
	for (const entry of oldest) {
		mapSnapshotCache.delete(entry.snapshotId)
	}
}

export function consumeMapSnapshot(snapshotId: string): CachedMapSnapshot | null {
	const snapshot = mapSnapshotCache.get(snapshotId)
	if (!snapshot) return null
	mapSnapshotCache.delete(snapshotId)
	return snapshot
}
