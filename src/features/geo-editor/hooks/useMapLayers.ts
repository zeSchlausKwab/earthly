import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import { useEffect, useState } from 'react'
import { isGeoJsonGeometry } from '@/lib/geo/normalizeGeoJSON'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../store'
import { convertGeoEventsToFeatureCollection } from '../utils'

function isExternalPlaceholder(properties: unknown): boolean {
	if (!properties || typeof properties !== 'object') return false
	return (properties as Record<string, unknown>).externalPlaceholder === true
}

function getDefaultTextFontStack(
	style: maplibregl.StyleSpecification | undefined,
): string[] | null {
	const isStringArray = (value: unknown): value is string[] =>
		Array.isArray(value) && value.every((v) => typeof v === 'string')

	const extract = (value: unknown): string[] | null => {
		if (typeof value === 'string') return [value]
		if (isStringArray(value)) return value
		if (!Array.isArray(value) || value.length === 0) return null

		const [op, ...rest] = value
		if (op === 'literal' && rest.length > 0 && isStringArray(rest[0])) return rest[0]
		if (op === 'case') {
			for (const part of rest) {
				const extracted = extract(part)
				if (extracted) return extracted
			}
		}
		return null
	}

	try {
		const layers = style?.layers ?? []
		for (const layer of layers) {
			const layout = (layer as unknown as { layout?: Record<string, unknown> }).layout
			const textFont = layout?.['text-font']
			const extracted = extract(textFont)
			if (extracted) return extracted
		}
	} catch {
		// ignore
	}

	return null
}

// Layer/Source IDs
const REMOTE_SOURCE_ID = 'geo-editor-remote-datasets'
const REMOTE_FILL_LAYER = 'geo-editor-remote-fill'
const REMOTE_LINE_LAYER = 'geo-editor-remote-line'
const REMOTE_POINT_LAYER = 'geo-editor-remote-point'
const REMOTE_LABEL_LAYER = 'geo-editor-remote-label'
const REMOTE_ANNOTATION_ANCHOR_LAYER = 'geo-editor-remote-annotation-anchor'
const REMOTE_ANNOTATION_LAYER = 'geo-editor-remote-annotation'
const BLOB_PREVIEW_SOURCE_ID = 'geo-editor-blob-preview'
const BLOB_PREVIEW_FILL_LAYER = 'geo-editor-blob-preview-fill'
const BLOB_PREVIEW_LINE_LAYER = 'geo-editor-blob-preview-line'

// Clustering source/layer IDs
const CLUSTERED_SOURCE_ID = 'geo-editor-clustered-points'
const CLUSTER_CIRCLE_LAYER = 'geo-editor-cluster-circles'
const CLUSTER_COUNT_LAYER = 'geo-editor-cluster-count'
const UNCLUSTERED_POINT_LAYER = 'geo-editor-unclustered-point'

export {
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_POINT_LAYER,
	REMOTE_LABEL_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	CLUSTER_CIRCLE_LAYER,
	UNCLUSTERED_POINT_LAYER,
}

interface UseMapLayersOptions {
	mapRef: React.MutableRefObject<maplibregl.Map | null>
	mounted: boolean
	visibleGeoEvents: NDKGeoEvent[]
	resolvedCollectionResolver: (event: NDKGeoEvent) => FeatureCollection | undefined
	/** Version counter that increments when resolved blob data changes, triggers re-render */
	resolvedCollectionsVersion: number
}

export function useMapLayers({
	mapRef,
	mounted,
	visibleGeoEvents,
	resolvedCollectionResolver,
	resolvedCollectionsVersion,
}: UseMapLayersOptions) {
	const [remoteLayersReady, setRemoteLayersReady] = useState(false)
	const [styleInitVersion, setStyleInitVersion] = useState(0)
	const blobPreviewCollection = useEditorStore((state) => state.blobPreviewCollection)

	// Initialize extra layers when map is ready
	useEffect(() => {
		if (!mapRef.current || !mounted) return
		const mapInstance = mapRef.current

		let disposed = false
		let initScheduled = false
		let initTimeoutId: number | null = null

		const initLayers = () => {
			if (disposed) return
			let textFont: string[] | null = null
			try {
				// Check if we can safely access the style
				const style = mapInstance.getStyle()
				if (!style) return
				textFont = getDefaultTextFontStack(style)
			} catch {
				return
			}

			try {
				// Add source if it doesn't exist
				if (!mapInstance.getSource(REMOTE_SOURCE_ID)) {
					mapInstance.addSource(REMOTE_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				// Add layers only if they don't exist
				if (!mapInstance.getLayer(REMOTE_FILL_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_FILL_LAYER,
						type: 'fill',
						source: REMOTE_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'fill-color': ['coalesce', ['get', 'fillColor'], ['get', 'color'], '#1d4ed8'],
							'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.15],
						},
					})
				}
				// Polygon outline layer
				const REMOTE_POLYGON_STROKE_LAYER = 'geo-editor-remote-polygon-stroke'
				if (!mapInstance.getLayer(REMOTE_POLYGON_STROKE_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POLYGON_STROKE_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'line-color': [
								'coalesce',
								['get', 'strokeColor'],
								['get', 'fillColor'],
								['get', 'color'],
								'#1d4ed8',
							],
							'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
						},
					})
				}
				if (!mapInstance.getLayer(REMOTE_LINE_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'LineString'],
							['==', ['geometry-type'], 'MultiLineString'],
						],
						paint: {
							'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'color'], '#1d4ed8'],
							'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'line-opacity': ['coalesce', ['get', 'strokeOpacity'], 1],
						},
					})
				}
				// Point layer (excludes annotations)
				if (!mapInstance.getLayer(REMOTE_POINT_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POINT_LAYER,
						type: 'circle',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
							['!=', ['get', 'featureType'], 'annotation'],
						],
						paint: {
							'circle-radius': ['coalesce', ['get', 'radius'], 6],
							'circle-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
							'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
						},
					})
				}

				// Annotation anchor layer (small circle marker)
				if (!mapInstance.getLayer(REMOTE_ANNOTATION_ANCHOR_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_ANNOTATION_ANCHOR_LAYER,
						type: 'circle',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'featureType'], 'annotation'],
						],
						paint: {
							'circle-radius': 4,
							'circle-color': '#f59e0b', // Amber
							'circle-stroke-width': 2,
							'circle-stroke-color': '#fff',
						},
					})
				}

				// Annotation text layer
				if (
					textFont &&
					mapInstance.isStyleLoaded() &&
					!mapInstance.getLayer(REMOTE_ANNOTATION_LAYER)
				) {
					mapInstance.addLayer({
						id: REMOTE_ANNOTATION_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'featureType'], 'annotation'],
						],
						layout: {
							'text-field': ['coalesce', ['get', 'text'], 'Annotation'],
							'text-font': textFont,
							'text-size': ['coalesce', ['get', 'textFontSize'], 14],
							'text-anchor': 'top',
							'text-offset': [0, 0.8],
							'text-allow-overlap': true,
							'text-ignore-placement': true,
						},
						paint: {
							'text-color': ['coalesce', ['get', 'textColor'], '#1f2937'],
							'text-halo-color': ['coalesce', ['get', 'textHaloColor'], '#ffffff'],
							'text-halo-width': ['coalesce', ['get', 'textHaloWidth'], 1.5],
						},
					})
				}

				// Feature label layer (for non-annotation features with labels)
				if (textFont && mapInstance.isStyleLoaded() && !mapInstance.getLayer(REMOTE_LABEL_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LABEL_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: ['all', ['has', 'label'], ['!=', ['get', 'featureType'], 'annotation']],
						layout: {
							'text-field': ['get', 'label'],
							'text-font': textFont,
							'text-size': 12,
							'text-anchor': 'center',
							'text-allow-overlap': false,
							'text-ignore-placement': false,
						},
						paint: {
							'text-color': '#374151',
							'text-halo-color': '#ffffff',
							'text-halo-width': 1.5,
						},
					})
				}

				// Blob preview source/layers
				if (!mapInstance.getSource(BLOB_PREVIEW_SOURCE_ID)) {
					mapInstance.addSource(BLOB_PREVIEW_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				if (!mapInstance.getLayer(BLOB_PREVIEW_FILL_LAYER)) {
					mapInstance.addLayer({
						id: BLOB_PREVIEW_FILL_LAYER,
						type: 'fill',
						source: BLOB_PREVIEW_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'fill-color': '#f97316',
							'fill-opacity': 0.2,
						},
					})
				}
				if (!mapInstance.getLayer(BLOB_PREVIEW_LINE_LAYER)) {
					mapInstance.addLayer({
						id: BLOB_PREVIEW_LINE_LAYER,
						type: 'line',
						source: BLOB_PREVIEW_SOURCE_ID,
						paint: {
							'line-color': '#f97316',
							'line-width': 2,
						},
					})
				}

				// Clustered points source
				if (!mapInstance.getSource(CLUSTERED_SOURCE_ID)) {
					mapInstance.addSource(CLUSTERED_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
						cluster: true,
						clusterMaxZoom: 14,
						clusterRadius: 50,
					})
				}

				// Cluster circle layer - styled with size based on point count
				if (!mapInstance.getLayer(CLUSTER_CIRCLE_LAYER)) {
					mapInstance.addLayer({
						id: CLUSTER_CIRCLE_LAYER,
						type: 'circle',
						source: CLUSTERED_SOURCE_ID,
						filter: ['has', 'point_count'],
						paint: {
							// Step expression for circle color based on cluster size
							'circle-color': [
								'step',
								['get', 'point_count'],
								'#60a5fa', // blue-400 for small clusters
								10,
								'#3b82f6', // blue-500 for medium
								50,
								'#2563eb', // blue-600 for large
								100,
								'#1d4ed8', // blue-700 for very large
							],
							// Step expression for circle radius based on cluster size
							'circle-radius': [
								'step',
								['get', 'point_count'],
								16, // base size
								10,
								20,
								50,
								24,
								100,
								28,
							],
							'circle-stroke-width': 2,
							'circle-stroke-color': '#ffffff',
						},
					})
				}

				// Cluster count label layer
				if (textFont && !mapInstance.getLayer(CLUSTER_COUNT_LAYER)) {
					mapInstance.addLayer({
						id: CLUSTER_COUNT_LAYER,
						type: 'symbol',
						source: CLUSTERED_SOURCE_ID,
						filter: ['has', 'point_count'],
						layout: {
							'text-field': ['get', 'point_count_abbreviated'],
							'text-font': textFont,
							'text-size': 12,
							'text-allow-overlap': true,
						},
						paint: {
							'text-color': '#ffffff',
						},
					})
				}

				// Unclustered point layer (individual points when not clustered)
				if (!mapInstance.getLayer(UNCLUSTERED_POINT_LAYER)) {
					mapInstance.addLayer({
						id: UNCLUSTERED_POINT_LAYER,
						type: 'circle',
						source: CLUSTERED_SOURCE_ID,
						filter: [
							'all',
							['!', ['has', 'point_count']],
							['!=', ['get', 'featureType'], 'annotation'],
						],
						paint: {
							'circle-radius': ['coalesce', ['get', 'radius'], 6],
							'circle-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
							'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
						},
					})
				}

				setRemoteLayersReady(true)
				setStyleInitVersion((prev) => prev + 1)
			} catch (error) {
				console.warn('Failed to initialize remote map layers:', error)
			}
		}

		const scheduleInitLayers = () => {
			if (disposed) return
			if (initScheduled) return
			initScheduled = true
			setRemoteLayersReady(false)

			// Defer to avoid mutating style during MapLibre's placement/render stack.
			initTimeoutId = window.setTimeout(() => {
				initScheduled = false
				initLayers()
			}, 0)
		}

		// Try to initialize once on mount and on subsequent style reloads (setStyle clears custom layers/sources).
		scheduleInitLayers()
		mapInstance.on('style.load', scheduleInitLayers)

		return () => {
			disposed = true
			if (initTimeoutId != null) {
				try {
					window.clearTimeout(initTimeoutId)
				} catch {
					// ignore
				}
				initTimeoutId = null
			}
			try {
				mapInstance.off('style.load', scheduleInitLayers)
			} catch {
				// Map may have been removed
			}
		}
	}, [mounted, mapRef])

	// Update remote datasets layer
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!remoteLayersReady) return
		void resolvedCollectionsVersion
		void styleInitVersion

		try {
			const source = map.getSource(REMOTE_SOURCE_ID) as GeoJSONSource | undefined
			const clusteredSource = map.getSource(CLUSTERED_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return

			const collection = convertGeoEventsToFeatureCollection(
				visibleGeoEvents,
				resolvedCollectionResolver,
			)

			// Filter out placeholder features and features with null geometry
			// to prevent MapLibre expression evaluation errors
			const filteredCollection = {
				...collection,
				features: collection.features.filter(
					(f) => f.geometry !== null && !isExternalPlaceholder(f.properties),
				),
			}

			// Ensure MapLibre only receives valid GeoJSON Features with valid Geometry
			const safeFeatures = filteredCollection.features.filter(
				(f) => f.type === 'Feature' && f.geometry !== null && isGeoJsonGeometry(f.geometry),
			)

			// Keep annotations out of clustering so they retain their label/popup behavior.
			const pointFeatures = safeFeatures.filter((f) => {
				if (f.geometry?.type !== 'Point' && f.geometry?.type !== 'MultiPoint') return false
				return (f.properties as Record<string, unknown> | undefined)?.featureType !== 'annotation'
			})
			const annotationFeatures = safeFeatures.filter(
				(f) =>
					(f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint') &&
					(f.properties as Record<string, unknown> | undefined)?.featureType === 'annotation',
			)
			const nonPointFeatures = safeFeatures.filter(
				(f) => f.geometry?.type !== 'Point' && f.geometry?.type !== 'MultiPoint',
			)

			const nonPointCollection = {
				type: 'FeatureCollection' as const,
				features: [...nonPointFeatures, ...annotationFeatures],
			}

			const pointCollection = {
				type: 'FeatureCollection' as const,
				features: pointFeatures,
			}

			// Set non-point features to regular source (lines, polygons)
			source.setData(nonPointCollection)

			// Set point features to clustered source
			if (clusteredSource) {
				clusteredSource.setData(pointCollection)
			}
		} catch {
			// Map may have been removed during source switch
		}
	}, [
		visibleGeoEvents,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
		remoteLayersReady,
		mapRef,
		styleInitVersion,
	])

	// Update blob preview layer
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!remoteLayersReady) return
		void styleInitVersion

		try {
			const source = map.getSource(BLOB_PREVIEW_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return
			source.setData(blobPreviewCollection ?? { type: 'FeatureCollection', features: [] })
		} catch {
			// Map may have been removed during source switch
		}
	}, [blobPreviewCollection, remoteLayersReady, mapRef, styleInitVersion])

	return {
		remoteLayersReady,
		REMOTE_SOURCE_ID,
		REMOTE_FILL_LAYER,
		REMOTE_LINE_LAYER,
		REMOTE_ANNOTATION_LAYER,
		BLOB_PREVIEW_SOURCE_ID,
		CLUSTERED_SOURCE_ID,
		CLUSTER_CIRCLE_LAYER,
		UNCLUSTERED_POINT_LAYER,
	}
}
