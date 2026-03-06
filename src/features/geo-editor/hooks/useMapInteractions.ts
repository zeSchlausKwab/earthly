import { useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Feature, Geometry } from 'geojson'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import { useEditorStore } from '../store'
import type { FeaturePopupData } from '../components/FeaturePopup'
import {
	CLUSTER_CIRCLE_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_POINT_LAYER,
	UNCLUSTERED_POINT_LAYER,
} from './useMapLayers'

interface UseMapInteractionsParams {
	mapRef: React.RefObject<maplibregl.Map | null>
	remoteLayersReady: boolean
	CLUSTERED_SOURCE_ID: string
	geoEventsRef: React.RefObject<NDKGeoEvent[]>
	currentUserPubkey: string | undefined
	getDatasetName: (event: NDKGeoEvent) => string
	handleInspectDatasetWithoutFocus: (event: NDKGeoEvent) => void
	setFeaturePopupData: (data: FeaturePopupData | null) => void
}

export function useMapInteractions({
	mapRef,
	remoteLayersReady,
	CLUSTERED_SOURCE_ID,
	geoEventsRef,
	currentUserPubkey,
	getDatasetName,
	handleInspectDatasetWithoutFocus,
	setFeaturePopupData,
}: UseMapInteractionsParams) {
	const viewMode = useEditorStore((state) => state.viewMode)
	const currentMode = useEditorStore((state) => state.mode)
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)
	const mapInstance = mapRef.current
	const isInDrawingMode = currentMode.startsWith('draw_')
	const hoveredFeatureKeyRef = useRef<string | null>(null)

	useEffect(() => {
		if (!mapInstance || !remoteLayersReady) return

		const remoteLayers = [
			REMOTE_FILL_LAYER,
			REMOTE_LINE_LAYER,
			REMOTE_POINT_LAYER,
			REMOTE_ANNOTATION_ANCHOR_LAYER,
			REMOTE_ANNOTATION_LAYER,
			UNCLUSTERED_POINT_LAYER,
		]

		const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
			const features = mapInstance.queryRenderedFeatures(event.point, {
				layers: [CLUSTER_CIRCLE_LAYER],
			})
			if (!features.length) return

			const feature = features[0]
			if (!feature) return

			const clusterId = feature.properties?.cluster_id as number | undefined
			if (clusterId === undefined) return

			const source = mapInstance.getSource(CLUSTERED_SOURCE_ID) as maplibregl.GeoJSONSource
			if (!source) return

			try {
				const zoom = await source.getClusterExpansionZoom(clusterId)
				const geometry = feature.geometry
				if (geometry.type !== 'Point') return

				mapInstance.easeTo({
					center: geometry.coordinates as [number, number],
					zoom: zoom ?? mapInstance.getZoom() + 2,
					duration: 500,
				})
			} catch {
				// Cluster may have been removed
			}
		}

		const handleMapDatasetClick = (event: maplibregl.MapLayerMouseEvent) => {
			if (isInDrawingMode) {
				hoveredFeatureKeyRef.current = null
				setFeaturePopupData(null)
				return
			}

			const feature = event.features?.[0]
			if (!feature) return

			const bbox = bboxFromGeometry(feature.geometry)
			if (bbox) {
				const props = (feature.properties ?? {}) as Record<string, unknown>
				const featureId = props.featureId ?? props.id ?? feature.id
				setFocusedMapGeometry({
					bbox,
					datasetId: props.datasetId != null ? String(props.datasetId) : undefined,
					sourceEventId: props.sourceEventId != null ? String(props.sourceEventId) : undefined,
					featureId: featureId != null ? String(featureId) : undefined,
				})
			}

			// Do not inspect other datasets while in edit mode
			if (viewMode === 'edit') {
				hoveredFeatureKeyRef.current = null
				setFeaturePopupData(null)
				return
			}

			if (!feature?.properties) return
			const sourceEventId = feature.properties.sourceEventId as string | undefined
			const datasetId = feature.properties.datasetId as string | undefined

			const dataset =
				geoEventsRef.current.find((ev) => ev.id === sourceEventId) ??
				geoEventsRef.current.find((ev) => (ev.datasetId ?? ev.id) === datasetId)

			if (!dataset) return
			handleInspectDatasetWithoutFocus(dataset)
		}

		const handleMapDatasetHover = (event: maplibregl.MapLayerMouseEvent) => {
			const feature = event.features?.[0]
			if (!feature || viewMode === 'edit' || isInDrawingMode) {
				hoveredFeatureKeyRef.current = null
				setFeaturePopupData(null)
				return
			}

			if (!feature?.properties) {
				hoveredFeatureKeyRef.current = null
				setFeaturePopupData(null)
				return
			}

			const sourceEventId = feature.properties.sourceEventId as string | undefined
			const datasetId = feature.properties.datasetId as string | undefined
			const featureId =
				(feature.properties.featureId as string | undefined) ??
				(feature.properties.id as string | undefined) ??
				(feature.id != null ? String(feature.id) : undefined)
			const hoverKey = `${sourceEventId ?? datasetId ?? 'unknown'}:${featureId ?? 'feature'}`

			if (hoverKey === hoveredFeatureKeyRef.current) return

			const dataset =
				geoEventsRef.current.find((ev) => ev.id === sourceEventId) ??
				geoEventsRef.current.find((ev) => (ev.datasetId ?? ev.id) === datasetId)

			if (!dataset) {
				hoveredFeatureKeyRef.current = null
				setFeaturePopupData(null)
				return
			}

			hoveredFeatureKeyRef.current = hoverKey
			setFeaturePopupData({
				dataset,
				feature: feature as unknown as Feature<Geometry>,
				clickPosition: { x: event.point.x, y: event.point.y },
				isOwner: currentUserPubkey === dataset.pubkey,
				datasetName: getDatasetName(dataset),
			})
		}

		const handleMouseEnter = () => {
			if (isInDrawingMode) return
			mapInstance.getCanvas().style.cursor = 'pointer'
		}

		const handleMouseLeave = () => {
			if (isInDrawingMode) return
			mapInstance.getCanvas().style.cursor = ''
			hoveredFeatureKeyRef.current = null
			setFeaturePopupData(null)
		}

		for (const layer of remoteLayers) {
			if (mapInstance.getLayer(layer)) {
				mapInstance.on('click', layer, handleMapDatasetClick)
				mapInstance.on('mousemove', layer, handleMapDatasetHover)
				mapInstance.on('mouseenter', layer, handleMouseEnter)
				mapInstance.on('mouseleave', layer, handleMouseLeave)
			}
		}

		if (mapInstance.getLayer(CLUSTER_CIRCLE_LAYER)) {
			mapInstance.on('click', CLUSTER_CIRCLE_LAYER, handleClusterClick)
			mapInstance.on('mouseenter', CLUSTER_CIRCLE_LAYER, handleMouseEnter)
			mapInstance.on('mouseleave', CLUSTER_CIRCLE_LAYER, handleMouseLeave)
		}

		return () => {
			for (const layer of remoteLayers) {
				try {
					mapInstance.off('click', layer, handleMapDatasetClick)
					mapInstance.off('mousemove', layer, handleMapDatasetHover)
					mapInstance.off('mouseenter', layer, handleMouseEnter)
					mapInstance.off('mouseleave', layer, handleMouseLeave)
				} catch {
					// Layer may have been removed
				}
			}
			try {
				mapInstance.off('click', CLUSTER_CIRCLE_LAYER, handleClusterClick)
				mapInstance.off('mouseenter', CLUSTER_CIRCLE_LAYER, handleMouseEnter)
				mapInstance.off('mouseleave', CLUSTER_CIRCLE_LAYER, handleMouseLeave)
			} catch {
				// Layer may have been removed
			}
		}
	}, [
		mapInstance,
		isInDrawingMode,
		handleInspectDatasetWithoutFocus,
		geoEventsRef,
		remoteLayersReady,
		setFocusedMapGeometry,
		CLUSTERED_SOURCE_ID,
		viewMode,
		currentUserPubkey,
		getDatasetName,
		setFeaturePopupData,
	])
}
