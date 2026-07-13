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

export const mapSnapshotCache = new Map<string, CachedMapSnapshot>()

/**
 * Passive-companion dataset totals (AI_GEO_AWARENESS §2): delivered in every
 * context message so the model usually needn't call `measure` at all. Cached
 * by the store's features-array IDENTITY — Zustand replaces the array on any
 * mutation, so a WeakMap entry is exactly as fresh as the dataset.
 */
const datasetMeasurementCache = new WeakMap<EditorFeature[], DatasetMeasurements | null>()

function getDatasetMeasurements(features: EditorFeature[]): DatasetMeasurements | null {
	if (datasetMeasurementCache.has(features)) {
		return datasetMeasurementCache.get(features) ?? null
	}
	const aggregates = aggregateMeasurements(features)
	datasetMeasurementCache.set(features, aggregates)
	return aggregates
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
				Boolean(entry) && entry.entityType === 'dataset' && entry.visible !== false,
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

	return {
		editorReady: Boolean(store.editor),
		mode: store.mode,
		datasetMetadata,
		featureCount: store.features.length,
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
		featureCount: snapshot.featureCount,
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

export function createMapContextSystemMessage(): ChatMessage | null {
	const snapshot = getMapContextSnapshot()
	const compact = getCompactMapContextForPrompt(snapshot)
	const sessionPublishBlock = buildSessionPublishContextMessage()
	return {
		role: 'system',
		content: [
			'You have map-editing tool access in this chat.',
			'DATA SOURCE ORDER — pick the FIRST tier that can answer: (1) BUNDLED WORLD LAYERS via run_code (instant, local, no network): country outlines/areas/borders, coastlines, offshore work, major named rivers/lakes, land-vs-water tests, world cities, sea routing. (2) OSM tools ONLY for what world layers do not carry: POIs, streets, buildings, small/local admin areas, fine local geometry — they are SLOW remote calls with tight size budgets that TRUNCATE big geometries. (3) web_search/fetch_url as a last resort for facts, never for geometry. Do NOT "verify" world-layer computations against OSM or the web — state the resolution caveat instead.',
			'World layers are GENERALIZED cartography (1:110m / 1:50m). Rankings, topology, routing, and anchoring are reliable; ABSOLUTE lengths of fractal features (coastlines!) are systematic underestimates — say so when reporting them instead of hunting for other sources.',
			'If the user asks to draw/create/edit map features, call tools instead of replying that you cannot edit the map.',
			'For draw requests, generate GeoJSON yourself and call add_feature_to_editor or write_geojson_to_editor directly.',
			'To name or describe the dataset (or set collection-level properties), call set_dataset_metadata — or authoring.setDatasetMetadata(...) inside run_code. Do NOT stamp dataset_name/dataset_description onto every feature. Read the current dataset name/description from get_editor_state (datasetMetadata) before changing it.',
			'For a Point icon, style the feature with displayIcon using a bundled Lucide id such as `lucide:tree-pine` or `lucide:anchor`; do not substitute emoji labels, colors, or image URLs.',
			'For many OSM features in an area (e.g. all military bases in viewport), prefer import_osm_to_editor with filters and bbox/point instead of embedding large GeoJSON argument strings.',
			'For polygon-constrained searches (selected polygon, country border, custom area), prefer query_osm_area.',
			'Do not call query_osm_area as an unfiltered scan. Always include filters, filterSets, or concept.',
			'For LOCAL admin boundaries (cities, districts, regions), prefer resolve_osm_entity -> get_osm_relation_geometry, then import using relationId. For COUNTRY outlines use world.get("countries_110m") in run_code — get_country_boundary is a slow remote call whose geometry gets transport-simplified to ~250 points per ring; reach for it only when the user explicitly needs OSM-precision national borders.',
			'For routing and travel-time polygons, use valhalla_route and valhalla_isochrone.',
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
			'For MAJOR named natural features (big rivers like the Danube/Rhine/Nile, coastlines, country outlines), use the bundled world layers in run_code (e.g. world.get("rivers_50m") filtered by properties.name, world.get("countries_110m")) — NOT OSM. Continent-scale OSM relations exceed the transport budget and fail. Use OSM only for local/detailed features.',
			'For land/water splitting (offshore lines, "how much crosses land"), use world.isOnLand([lon,lat]) per vertex inside run_code — do not marshal the land mask yourself.',
			'Recipe — offshore offset line ("follow the coastline of X, N km out to sea"), ONE run_code call, no OSM: take the country polygon from world.get("countries_110m"), ring = turf.polygonToLine(turf.buffer(country, N, {units:"kilometers"})), split the ring into segments and keep those whose midpoint has world.isOnLand(mid) === false, then authoring.writeGeoJSON the kept segments.',
			'Trust tool results: after a successful authoring write (a tool result with created/updated/deleted counts), do NOT re-verify with capture_map_snapshot or get_editor_state. The write result is authoritative.',
			'To compose a long-form article/story, write it into the local draft with write_story_draft (Markdown body; cite datasets/entities inline as nostr:naddr1…, optionally #featureId). You cannot publish anything — the user reviews and publishes the draft in the Story editor. Use read_entity first to pull the full content of anything you cite; use search_entities to discover references.',
			...(sessionPublishBlock ? [sessionPublishBlock] : []),
			`Current map state JSON:\n${JSON.stringify(compact)}`,
		].join('\n\n'),
	}
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
