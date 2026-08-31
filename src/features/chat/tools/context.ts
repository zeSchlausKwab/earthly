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
import type { CachedMapSnapshot, ToolExecutionTarget } from './types'
import { MAX_SNAPSHOT_CACHE_SIZE } from './types'
import { countFeaturesByGeometry } from './helpers'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import { getFeatureCallouts, type MapCallout } from '@/lib/geo/callouts'
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

const MAX_CALLOUT_FEATURE_SUMMARIES = 40
const MAX_CALLOUTS_PER_FEATURE_SUMMARY = 5
const MAX_CALLOUT_SUMMARIES = 60
const MAX_CALLOUT_SUMMARY_TEXT_CHARS = 180

function summarizeCallout(callout: MapCallout) {
	const textTruncated = callout.text.length > MAX_CALLOUT_SUMMARY_TEXT_CHARS
	return {
		id: callout.id,
		...(callout.title ? { title: callout.title } : {}),
		text: textTruncated
			? `${callout.text.slice(0, MAX_CALLOUT_SUMMARY_TEXT_CHARS)}…`
			: callout.text,
		...(textTruncated ? { textTruncated: true } : {}),
		...(callout.media?.length ? { mediaCount: callout.media.length } : {}),
		...(callout.placement?.side ? { placementSide: callout.placement.side } : {}),
	}
}

function summarizeDatasetCallouts(features: readonly EditorFeature[]) {
	let total = 0
	let featureCount = 0
	let summarizedCalloutCount = 0
	let truncated = false
	const byFeature: Array<{
		featureId: string
		featureName?: string
		count: number
		callouts: ReturnType<typeof summarizeCallout>[]
		calloutsTruncated: boolean
	}> = []

	for (const feature of features) {
		const callouts = getFeatureCallouts(feature)
		if (callouts.length === 0) continue
		total += callouts.length
		featureCount += 1
		if (byFeature.length >= MAX_CALLOUT_FEATURE_SUMMARIES) {
			truncated = true
			continue
		}
		const availableSummaries = Math.max(0, MAX_CALLOUT_SUMMARIES - summarizedCalloutCount)
		const summarizedCallouts = callouts.slice(
			0,
			Math.min(MAX_CALLOUTS_PER_FEATURE_SUMMARY, availableSummaries),
		)
		summarizedCalloutCount += summarizedCallouts.length
		const calloutsTruncated = summarizedCallouts.length < callouts.length
		if (calloutsTruncated) truncated = true
		const featureName =
			typeof feature.properties?.name === 'string' ? feature.properties.name : undefined
		byFeature.push({
			featureId: String(feature.id),
			...(featureName ? { featureName } : {}),
			count: callouts.length,
			callouts: summarizedCallouts.map(summarizeCallout),
			calloutsTruncated,
		})
	}

	return { total, featureCount, byFeature, truncated }
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
		callouts: summarizeDatasetCallouts(store.features),
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

/**
 * Capture the textual context for the immutable authoring target selected at
 * Send. If that Dataset is retained in the background, derive context from its
 * draft instead of whichever workspace is currently visible.
 */
export function getMapContextSnapshotForTarget(
	target: ToolExecutionTarget,
): ReturnType<typeof getMapContextSnapshot> {
	if (target.entityType !== 'dataset') return getMapContextSnapshot()

	const store = useEditorStore.getState()
	const workspace = target.workspaceId ? store.workspaces[target.workspaceId] : null
	const draft = target.draftId ? store.geoEditDrafts[target.draftId] : null
	const exactTargetVisible =
		store.activeWorkspaceId === target.workspaceId &&
		store.activeGeoEditDraftId === target.draftId &&
		workspace?.activeDraftId === target.draftId &&
		workspace.sourceId === target.sourceId &&
		draft?.sourceId === target.sourceId
	if (exactTargetVisible) return getMapContextSnapshot()

	const features = draft?.sourceId === target.sourceId ? draft.features : []
	const selectedFeatureIds = draft?.sourceId === target.sourceId ? draft.selectedFeatureIds : []
	const selectedIds = new Set(selectedFeatureIds)
	const selectedEditorFeatures = features.filter((feature) => selectedIds.has(feature.id))
	const selectedSummary = selectedEditorFeatures.slice(0, 20).map((feature) => {
		const measurements = summarizeFeatureMeasurements(feature)
		return {
			id: feature.id,
			geometryType: feature.geometry?.type ?? 'Unknown',
			name: typeof feature.properties?.name === 'string' ? feature.properties.name : undefined,
			lengthKm: measurements?.lengthKm,
			areaKm2: measurements?.areaKm2,
		}
	})
	const serializedBytes = getDatasetSerializedBytes(features)
	const datasetCoordinate = target.entityId

	return {
		editorReady: Boolean(draft),
		mode: 'static',
		datasetMetadata: {
			name: draft?.collectionMeta.name ?? '',
			description: draft?.collectionMeta.description ?? '',
			color: draft?.collectionMeta.color ?? '',
			customProperties: draft?.collectionMeta.customProperties ?? {},
		},
		activeDataset:
			datasetCoordinate && target.baseRevisionId
				? {
						address: `37515:${datasetCoordinate}`,
						eventId: target.baseRevisionId,
						version: null,
					}
				: null,
		localDraftDirty: target.wasDirty,
		featureCount: features.length,
		callouts: summarizeDatasetCallouts(features),
		datasetSize: {
			serializedBytes,
			limitBytes: BLOSSOM_UPLOAD_THRESHOLD_BYTES,
			overLimit: serializedBytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		},
		datasetMeasurements: getDatasetMeasurements(features),
		selectedFeatureCount: selectedFeatureIds.length,
		selectedFeatures: selectedSummary,
		selectedFeatureGeometryCounts: countFeaturesByGeometry(selectedEditorFeatures),
		featureGeometryCounts: countFeaturesByGeometry(features),
		viewportBbox: null,
		mapCenter: null,
		mapZoom: null,
		mapView: { center: null, zoom: null, bbox: null },
		viewportAnchors: null,
		visibleLayers: [],
		visibleDatasets: datasetCoordinate ? [datasetCoordinate] : [],
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
		callouts: {
			total: snapshot.callouts.total,
			featureCount: snapshot.callouts.featureCount,
			byFeature: snapshot.callouts.byFeature.slice(0, 8).map((entry) => ({
				...entry,
				callouts: entry.callouts.slice(0, 3),
				calloutsTruncated: entry.calloutsTruncated || entry.callouts.length > 3,
			})),
			truncated: snapshot.callouts.truncated || snapshot.callouts.byFeature.length > 8,
		},
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

const GEO_CATALOG_SOURCE_MANIFEST_PREFIX = 'earthly:geoCatalogSourceManifest:'

function compactDatasetMetadataForTool(
	metadata: ReturnType<typeof getMapContextSnapshot>['datasetMetadata'],
) {
	const customProperties: typeof metadata.customProperties = {}
	const geoCatalogSnapshotIds: string[] = []
	for (const [key, value] of Object.entries(metadata.customProperties)) {
		if (key.startsWith(GEO_CATALOG_SOURCE_MANIFEST_PREFIX)) {
			geoCatalogSnapshotIds.push(key.slice(GEO_CATALOG_SOURCE_MANIFEST_PREFIX.length))
			continue
		}
		customProperties[key] = value
	}
	return {
		...metadata,
		customProperties,
		geoCatalogSourceManifests: {
			count: geoCatalogSnapshotIds.length,
			snapshotIds: geoCatalogSnapshotIds,
		},
	}
}

export function getCompactMapContextForTool(snapshot: ReturnType<typeof getMapContextSnapshot>) {
	return {
		editorReady: snapshot.editorReady,
		mode: snapshot.mode,
		datasetMetadata: compactDatasetMetadataForTool(snapshot.datasetMetadata),
		featureCount: snapshot.featureCount,
		callouts: snapshot.callouts,
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
	/**
	 * A send-time snapshot pins the request to the entity/map the user actually
	 * addressed. Without it, clicking into another retained editor while the
	 * model is between rounds silently changes the next round's system context.
	 */
	mapSnapshot?: ReturnType<typeof getMapContextSnapshot>
	/** `null` deliberately captures "no session publishes" at send time. */
	sessionPublishContextMessage?: string | null
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

function currentDateInstruction(now = new Date()): string {
	return `CURRENT DATE — ${now.toISOString().slice(0, 10)}. Treat earlier dates as past events and later dates as future events when researching time-sensitive claims.`
}

function createLegacyMapContextSystemMessage(
	options: MapContextPromptOptions = {},
): ChatMessage | null {
	const snapshot = options.mapSnapshot ?? getMapContextSnapshot()
	const compact = getCompactMapContextForPrompt(snapshot)
	const sessionPublishBlock =
		options.sessionPublishContextMessage === undefined
			? buildSessionPublishContextMessage()
			: (options.sessionPublishContextMessage ?? undefined)
	return {
		role: 'system',
		content: [
			'You have map-editing tool access in this chat.',
			currentDateInstruction(),
			...(continuationInstruction(options) ? [continuationInstruction(options) as string] : []),
			firstVisibleGeometryInstruction(),
			'BASEMAP IS CONTEXT — roads, place names, terrain, water, and surrounding political geography already visible in the basemap do not need to become editor features. Author a surrounding country/state boundary only when it is requested or materially encodes the map theme; never import neighboring places merely to provide background context.',
			'DATA SOURCE ORDER — pick the FIRST tier that can answer: (1) query_geography for fast, self-hosted administrative areas, localities, places, waterways, and infrastructure. Road and rail are optional coverage packs; kind_unavailable for either is intentional and MUST NOT trigger an OSM fallback. Categories are exact filters: start with name and kind, and only add a category already observed in results or category suggestions; use adminLevels for hierarchy. Discover human-readable queries first, then import the chosen results by their returned stable ids with toEditor=true; if stable ids are already known, resolve and import them directly without remote re-search. (2) BUNDLED WORLD LAYERS via run_code for generalized global computation: coastlines, offshore work, major named rivers/lakes, land-vs-water tests, world cities, and sea routing. (3) remote OSM tools only as a last resort when the local catalog and world layers genuinely lack requested local detail in a baseline kind; they are slow and failure-prone upstream, so keep any fallback query bounded. An exact user-supplied OSM element or relation id remains valid for the corresponding exact-id tool. (4) wikipedia_lookup/web_search for facts, never geometry; use fetch_url only for non-Wikipedia pages. Do not re-query a settled local result merely to verify it.',
			'REFERENCE BOUNDARIES — query the local catalog with kinds=["admin"] first, choose area results, then request their geometry by stable id. Country and admin-1 results can be batched by ids in one query. If the snapshot reports missing coverage, use get_reference_boundaries as the generalized compatibility fallback. Low-level OSM boundary calls are a last resort, never a verification step after a catalog hit. Do not author boundaries that only duplicate basemap context.',
			'ROUTE ALIGNMENT — use valhalla_route for a road, bus, bicycle, pedestrian, or truck journey through 2–25 coordinate waypoints. Valhalla is not road-name search or full-relation retrieval and does not route rail. For rail, use route_over_network only when an actual LineString network was supplied by the user, attached as source data, or is already in the editor; otherwise report rail routing as unsupported. Default to route_over_network automatically for maritime lanes or an actual supplied/editor rail, river, canal, or custom LineString network, without waiting for the user to ask for routing, and prefer the dedicated host tool over sandbox pathfinder. Optional catalog transport packs may provide named corridors; their absence never authorizes an OSM fallback. Air links and explicitly schematic/historical corridors may be stylized, but mark mappingBasis and geometryPrecision="schematic". Never silently substitute coarse hand-drawn or nearly straight lines for available routing.',
			'MAP CALLOUTS — an Earthly map callout is authored contextual content that belongs to and is stored on an existing geometry. It is always visible without hover or selection. Use add_feature_callout or one atomic add_feature_callouts batch. Never simulate a map callout by creating a Point, label, icon, popup, annotation, or a feature with type="callout".',
			'SOURCE-PROVIDED SPATIAL DATA — before geocoding, inspect structured source rows, files, and API results for usable spatial fields such as latitude/longitude, coordinate pairs, GeoJSON, WKT, or geohashes. Normalize those values and preserve their source precision and provenance. Geocode only rows whose source genuinely lacks usable spatial data.',
			'RESEARCH BUDGET — keep research proportional to the requested map. Batch independent lookups when a tool supports it, reuse facts and coordinates already returned, and stop researching once authoritative sources are sufficient to build the requested result. Do not repeatedly verify the same settled fact through different search tools.',
			'WORKFLOW COMPLETION — carry an agreed multi-step request through to its final artifact unless a real blocker requires user input. Do not pause after an intermediate map write merely to ask whether to continue. If the user asked for both a dataset and a Story, finish the dataset first and then write or update the Story draft in the same workflow.',
			'STRUCTURED EXTRACTION PAGINATION — for Wikipedia prose, only textPagination.status="complete" contains all requested article or section text; status="more" requires textPagination.nextOffset with the returned revisionId. Never probe alternate raw/API Wikipedia URLs. For tables, pagination.status="complete" is the only full-table result; status="more" requires the nextOffset page and status="final_page" still omits earlier rows. Outline sampleRows are previews.',
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
			'Only after query_geography confirms a genuine baseline-kind coverage gap: for many OSM features in an area, use one bounded import_osm_to_editor call with filters and bbox/point instead of embedding large GeoJSON argument strings. Missing optional road or rail coverage is not such a gap; an exact user-supplied OSM id remains valid.',
			'Only after a confirmed baseline-kind catalog gap: use query_osm_area for polygon-constrained OSM searches, and always include filters, filterSets, or concept.',
			'For requested administrative reference boundaries, use query_geography first. Use get_reference_boundaries only when the catalog reports missing coverage, and use low-level resolve_osm_entity/get_osm_relation_geometry only for an explicit OSM entity or relation.',
			'For supported road/bus/bicycle/pedestrian/truck routing use valhalla_route with 2–25 coordinate waypoints. For maritime or an actual supplied/editor line network use route_over_network; without such a network, report rail routing as unsupported. For travel-time polygons use valhalla_isochrone.',
			'Measurements are delivered passively: datasetMeasurements holds dataset totals and selected-feature hints carry lengthKm/areaKm2 — read those first. Call measure (one operation per call) only for something not already in context (distance/bearing between points, perimeter, centroid, bbox, nearest_point).',
			'To ground coordinates in named places (country, nearest city, on-land/on-water, distance to coast), call describe_location with a point or bbox. Use it to sanity-check where drawn geometry actually landed.',
			'viewportAnchors in the map state names what the user is looking at (countries in view, center description, geohash) — trust it over guessing from raw coordinates.',
			'Use toEditor=true only on exact, explicitly selected geometry results whose tool schema advertises it. Human-readable GeoCatalog searches and broad OSM nearby/bbox/area queries are discovery steps; never treat every candidate as an editor import.',
			'For an OSM fallback constrained to the current selection, query_osm_area may use selectedOnly=true; transient chat geometry can supply that area even when nothing is selected.',
			'Within an OSM fallback, use concept when tagging is inconsistent, outputGeometry="point_on_feature" when only representative points are needed, and clipLines=true for a specific local stream, canal, road, or trail inside a border. Never query OSM for a country-scale coastline or major river.',
			'If a border-constrained or polygon-constrained query fails, do not replace it with an unconstrained bbox import. Retry with the same area constraint or report the failure.',
			'Do not attempt interactive toolbar operations from a background chat run. Use authoring-native geometry operations, including delete-by-id, for changes to the bound Dataset.',
			'For add_feature_to_editor, send one feature per call with compact JSON.',
			'Do not ask the user for intermediate geometry parameters unless they explicitly want to customize shape details.',
			'After a confirmed baseline-kind catalog coverage gap, an OSM fallback should first query candidates with query_osm_bbox/query_osm_nearby, verify non-empty results, then import with explicit bbox/point and filters. Never treat unavailable optional road or rail coverage as that gap.',
			'Within that last-resort OSM call, use array-valued filters or filterSets when exact tags are brittle.',
			'When calling a tool, output strict JSON arguments only.',
			'For well-known places (capitals, countries, major cities), use their known coordinates directly instead of geocoding. Only call search_location for genuinely ambiguous or unknown places.',
			'Do not fetch OSM relation geometry or query OSM unless the task explicitly needs real boundary or feature geometry. For a simple shape (arc, circle, line between known points), compute it yourself or with run_code+turf.',
			'In run_code, the result is the final bare expression OR a top-level `return <value>` (both work). Only `data`, `turf`, `authoring`, `console`, `world`, and `pathfinder` exist — there is no fetch/Buffer/process/require/window/document.',
			'For a route along a real network, prefer route_over_network over sandbox pathfinder. Use pathfinder inside run_code only when routing must be part of a larger atomic computation that the dedicated tool cannot express; never hand-emit long coordinate streams from memory.',
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
	const snapshot = options.mapSnapshot ?? getMapContextSnapshot()
	const compact = getCompactMapContextForPrompt(snapshot)
	const sessionPublishBlock =
		options.sessionPublishContextMessage === undefined
			? buildSessionPublishContextMessage()
			: (options.sessionPublishContextMessage ?? undefined)
	const hasStoryTools = toolNames.some((name) => name.includes('story'))
	const hasResearchTools = toolNames.some((name) =>
		['web_search', 'wikipedia_lookup', 'wikipedia_extract', 'fetch_url'].includes(name),
	)
	const hasAuthoringTools = toolNames.some((name) =>
		/^(write_|add_|set_|batch_|style_|draw_|buffer_|offset_|split_|create_|import_)/.test(name),
	)
	const hasAdministrativeBoundaryTools = toolNames.some((name) =>
		['query_geography', 'get_reference_boundaries'].includes(name),
	)
	const hasRoutingTools = toolNames.some((name) =>
		['valhalla_route', 'route_over_network'].includes(name),
	)
	const hasCalloutTools = toolNames.some((name) => name.includes('feature_callout'))

	return {
		role: 'system',
		content: [
			"You are Earthly's spatial assistant. Tool descriptions are authoritative; use only the advertised tools.",
			currentDateInstruction(),
			...(continuationInstruction(options) ? [continuationInstruction(options) as string] : []),
			firstVisibleGeometryInstruction(),
			'INTENT GATE — answer advisory, explanatory, and planning questions without changing the map. Mutate only when the user explicitly asks to create, add, draw, import, edit, update, or delete something.',
			'BASEMAP IS CONTEXT — do not author surrounding countries, regions, roads, labels, terrain, or water merely as background. Add a boundary only when requested or thematically meaningful.',
			"SOURCE ORDER — use query_geography first for administrative areas, localities, places, waterways, and infrastructure from Earthly's fast baseline catalog. Road and rail are optional coverage packs; kind_unavailable for either is intentional and MUST NOT trigger remote OSM. Categories are exact filters: start with name and kind, and only add a category already observed in results or category suggestions; use adminLevels for hierarchy. Discover human-readable queries first, then import selected results by their returned stable ids; known stable ids may be imported directly. Use bundled world layers for generalized global coastline/major-river/world-city computation. Use remote OSM only as a last resort when those sources genuinely lack required local detail in a baseline kind; an exact user-supplied OSM element or relation id remains valid for its exact-id tool. Use web/Wikipedia for facts, never geometry. Inspect source-provided coordinates/GeoJSON/WKT before geocoding, and do not repeatedly verify an authoritative result.",
			'PRECISION — preserve provenance and coordinate precision. Label geometry as schematic, generalized, network-derived, or exact as appropriate; never imply remembered or hand-drawn geometry follows a real network. Historical maps must state whether modern boundaries are proxies.',
			'EXECUTION — complete the requested artifact unless genuinely blocked. Prefer one atomic batch write. Trust a successful authoring result; do not re-read the editor merely to verify it. If a tool fails, change approach instead of repeating identical calls.',
			...(hasAuthoringTools
				? [
						'AUTHORING — when the user asks for a map change, use the advertised write tools; never claim the editor is read-only. Set collection metadata at dataset level, not on every feature. Keep literal labels sparse, use meaningful bundled Lucide icons for semantic points, and validate the complete result before committing.',
					]
				: []),
			...(hasAdministrativeBoundaryTools
				? [
						'REFERENCE BOUNDARIES — use query_geography with kinds=["admin"] first. Choose area results, then import their exact geometries by stable id; country and admin-1 ids can be batched in one query. If the catalog reports missing coverage, use get_reference_boundaries as a generalized fallback; low-level OSM calls are last resort only.',
					]
				: []),
			...(hasRoutingTools
				? [
						'ROUTING — default to network-derived geometry automatically, without waiting for the user to ask. Use valhalla_route for road/bus/bicycle/pedestrian/truck journeys through 2–25 coordinate waypoints; it is not road-name search or full-relation retrieval and does not route rail. Use route_over_network for maritime or an actual supplied/editor rail, river, canal, or custom LineString network, and prefer route_over_network over sandbox pathfinder. Without an actual supplied/editor network, report rail routing as unsupported. Air or explicitly schematic/historical links may be stylized only when clearly marked schematic. Never silently draw coarse straight substitutes or use OSM because an optional transport pack is absent.',
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
