/**
 * Map context snapshot helpers for chat tool system messages.
 */

import { useEditorStore } from '@/features/geo-editor/store'
import type { ChatMessage } from '../routstr'
import type { CachedMapSnapshot } from './types'
import { MAX_SNAPSHOT_CACHE_SIZE } from './types'
import { countFeaturesByGeometry } from './helpers'

export const mapSnapshotCache = new Map<string, CachedMapSnapshot>()

export function getMapContextSnapshot() {
	const store = useEditorStore.getState()
	const viewport = store.editor?.getMapBounds() ?? store.currentBbox
	const center = store.editor?.getMapCenter() ?? null
	const zoom = store.editor?.getMapZoom() ?? null
	const selectedFeatures = new Set(store.selectedFeatureIds)
	const selectedEditorFeatures = store.features.filter((feature) =>
		selectedFeatures.has(feature.id),
	)
	const selectedSummary = selectedEditorFeatures.slice(0, 20).map((feature) => ({
		id: feature.id,
		geometryType: feature.geometry?.type ?? 'Unknown',
		name: typeof feature.properties?.name === 'string' ? feature.properties?.name : undefined,
	}))
	const visibleMapLayers = store.mapLayers
		.filter((layer) => layer.enabled)
		.map((layer) => ({
			id: layer.id,
			title: layer.title,
			kind: layer.kind,
			opacity: layer.opacity,
		}))
	const visibleDatasetIds = Object.entries(store.datasetVisibility)
		.filter(([, visible]) => visible)
		.map(([datasetId]) => datasetId)

	return {
		editorReady: Boolean(store.editor),
		mode: store.mode,
		featureCount: store.features.length,
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
		visibleLayers: visibleMapLayers,
		visibleDatasets: visibleDatasetIds,
		mapSource: store.mapSource,
	}
}

export function getCompactMapContextForPrompt(snapshot: ReturnType<typeof getMapContextSnapshot>) {
	const selectedFeatureHints = snapshot.selectedFeatures.slice(0, 4).map((feature) => ({
		geometryType: feature.geometryType,
		name: feature.name ?? null,
	}))

	const visibleLayerIds = snapshot.visibleLayers.map((layer) => layer.id).slice(0, 8)

	return {
		editorReady: snapshot.editorReady,
		mode: snapshot.mode,
		featureCount: snapshot.featureCount,
		selectedFeatureCount: snapshot.selectedFeatureCount,
		mapView: snapshot.mapView,
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
		featureCount: snapshot.featureCount,
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
	return {
		role: 'system',
		content: [
			'You have map-editing tool access in this chat.',
			'If the user asks to draw/create/edit map features, call tools instead of replying that you cannot edit the map.',
			'For draw requests, generate GeoJSON yourself and call add_feature_to_editor or write_geojson_to_editor directly.',
			'For many OSM features in an area (e.g. all military bases in viewport), prefer import_osm_to_editor with filters and bbox/point instead of embedding large GeoJSON argument strings.',
			'For polygon-constrained searches (selected polygon, country border, custom area), prefer query_osm_area.',
			'Do not call query_osm_area as an unfiltered scan. Always include filters, filterSets, or concept.',
			'For boundaries, prefer resolve_osm_entity -> get_osm_relation_geometry/get_country_boundary, then import using relationId or returned feature.',
			'For routing and travel-time polygons, use valhalla_route and valhalla_isochrone.',
			'When a geometry-producing tool supports it, set toEditor=true to import directly and keep tool results compact.',
			'If the user says "within this polygon" or explicitly attaches the current selection, use query_osm_area with selectedOnly=true.',
			'If the user attached transient chat geometry, query_osm_area can use that attached geometry directly for the current request even when nothing is selected in the editor.',
			'Use the concept argument when the user intent is semantic but OSM tagging is likely inconsistent. High-value examples: concept="military installation", concept="river", concept="bench".',
			'If the user asks for points only, set outputGeometry="point_on_feature" unless exact point features already exist.',
			'If the user asks for a line or river within a border, use query_osm_area with clipLines=true to keep geometry inside the area.',
			'If a border-constrained or polygon-constrained query fails, do not replace it with an unconstrained bbox import. Retry with the same area constraint or report the failure.',
			'For toolbar-like operations (undo/redo/mode/selection ops), use editor_* tools.',
			'For add_feature_to_editor, send one feature per call with compact JSON.',
			'Do not ask the user for intermediate geometry parameters unless they explicitly want to customize shape details.',
			'For OSM imports, first query candidates with query_osm_bbox/query_osm_nearby, verify non-empty results, then import with explicit bbox/point and filters.',
			'When exact OSM tags are brittle, prefer filters with array values or filterSets to cover multiple tagging variants in one query.',
			'Think in OSM tags and aliases: military often spans military=*, landuse=military, and building=bunker; rivers are usually waterway=river; benches are usually amenity=bench.',
			'When calling a tool, output strict JSON arguments only.',
			`Current map state JSON:\n${JSON.stringify(compact)}`,
		].join('\n\n'),
	}
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
