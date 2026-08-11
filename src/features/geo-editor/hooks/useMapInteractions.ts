import { useCallback, useEffect, useRef } from 'react'
import type maplibregl from 'maplibre-gl'
import type { Feature, Geometry } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import { useEditorStore } from '../store'
import type { FeaturePopupData } from '../components/FeaturePopup'
import type { SightingPopupData } from '../components/SightingPopup'
import {
	CLUSTER_CIRCLE_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_LINE_DASHED_LAYER,
	REMOTE_LINE_DOTTED_LAYER,
	REMOTE_POLYGON_PROXY_LAYER,
	REMOTE_POINT_LAYER,
	SIGHTING_HIT_LAYER,
	UNCLUSTERED_POINT_LAYER,
} from './useMapLayers'

interface UseMapInteractionsParams {
	mapRef: React.RefObject<maplibregl.Map | null>
	remoteLayersReady: boolean
	CLUSTERED_SOURCE_ID: string
	geoEventsRef: React.RefObject<GeoDataset[]>
	currentUserPubkey: string | undefined
	getDatasetName: (event: GeoDataset) => string
	handleInspectDatasetWithoutFocus: (event: GeoDataset) => void
	setFeaturePopupData: (data: FeaturePopupData | null) => void
	setGeometryChoiceData: (data: RemoteGeometryChoiceRequest | null) => void
	/** Live list of visible Sightings, kept in a ref so the click handler resolves a
	 * clicked marker back to its cast without re-binding on every data change. */
	sightingsRef?: React.RefObject<TemporalSighting[]>
	/** Open a Sighting's detail view (and surface it in the rail) on marker click. */
	onInspectSighting?: (sighting: TemporalSighting) => void
	/** Show/clear the Sighting marker hover preview. */
	setSightingPopupData?: (data: SightingPopupData | null) => void
}

export interface RemoteGeometryChoice {
	id: string
	dataset?: GeoDataset
	datasetName: string
	feature: Feature<Geometry>
	featureId?: string
	datasetId?: string
	sourceEventId?: string
	bbox: [number, number, number, number]
}

export interface RemoteGeometryChoiceRequest {
	point: { x: number; y: number }
	choices: RemoteGeometryChoice[]
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
	setGeometryChoiceData,
	sightingsRef,
	onInspectSighting,
	setSightingPopupData,
}: UseMapInteractionsParams) {
	const viewMode = useEditorStore((state) => state.viewMode)
	const currentMode = useEditorStore((state) => state.mode)
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)
	const mapInstance = mapRef.current
	const isInDrawingMode = currentMode.startsWith('draw_')
	const hoveredFeatureKeyRef = useRef<string | null>(null)

	const chooseRemoteGeometry = useCallback(
		(choice: RemoteGeometryChoice) => {
			setGeometryChoiceData(null)
			setFocusedMapGeometry({
				bbox: choice.bbox,
				datasetId: choice.datasetId ?? choice.dataset?.datasetId ?? choice.dataset?.id,
				sourceEventId: choice.sourceEventId ?? choice.dataset?.id,
				featureId: choice.featureId,
			})
			if (viewMode !== 'edit' && choice.dataset) handleInspectDatasetWithoutFocus(choice.dataset)
		},
		[handleInspectDatasetWithoutFocus, setFocusedMapGeometry, setGeometryChoiceData, viewMode],
	)

	useEffect(() => {
		if (!mapInstance || !remoteLayersReady) return

		const remoteLayers = [
			REMOTE_FILL_LAYER,
			REMOTE_LINE_LAYER,
			REMOTE_LINE_DASHED_LAYER,
			REMOTE_LINE_DOTTED_LAYER,
			REMOTE_POINT_LAYER,
			REMOTE_POLYGON_PROXY_LAYER,
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
				setGeometryChoiceData(null)
				return
			}

			const activeRemoteLayers = remoteLayers.filter((layer) => mapInstance.getLayer(layer))
			const renderedFeatures = mapInstance.queryRenderedFeatures(event.point, {
				layers: activeRemoteLayers,
			})
			const seen = new Set<string>()
			const choices: RemoteGeometryChoice[] = []
			for (const renderedFeature of renderedFeatures) {
				if (!renderedFeature.properties) continue
				const props = renderedFeature.properties as Record<string, unknown>
				const sourceEventId = props.sourceEventId != null ? String(props.sourceEventId) : undefined
				const datasetId = props.datasetId != null ? String(props.datasetId) : undefined
				const featureIdValue = props.featureId ?? props.id ?? renderedFeature.id
				const featureId = featureIdValue != null ? String(featureIdValue) : undefined
				const dataset =
					geoEventsRef.current.find((item) => item.id === sourceEventId) ??
					geoEventsRef.current.find((item) => (item.datasetId ?? item.id) === datasetId)
				const proxySourceBbox = Array.isArray(props.proxySourceBbox) ? props.proxySourceBbox : null
				const bbox =
					proxySourceBbox &&
					proxySourceBbox.length === 4 &&
					proxySourceBbox.every((value) => typeof value === 'number')
						? (proxySourceBbox as [number, number, number, number])
						: bboxFromGeometry(renderedFeature.geometry)
				if (!bbox) continue
				const subjectId =
					dataset?.id ??
					dataset?.datasetId ??
					sourceEventId ??
					datasetId ??
					(typeof props.reference === 'string' ? props.reference : 'map')
				const id = `${subjectId}:${featureId ?? JSON.stringify(bbox)}`
				if (seen.has(id)) continue
				seen.add(id)
				choices.push({
					id,
					...(dataset ? { dataset } : {}),
					datasetName: dataset ? getDatasetName(dataset) : 'Map reference',
					feature: renderedFeature as unknown as Feature<Geometry>,
					featureId,
					datasetId,
					sourceEventId,
					bbox,
				})
			}

			if (choices.length > 1) {
				setGeometryChoiceData({ point: { x: event.point.x, y: event.point.y }, choices })
				return
			}
			if (choices[0]) chooseRemoteGeometry(choices[0])
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

		// Temporal Sighting markers: clicking a dot opens its detail (the "what is
		// this content?") and surfaces its row in the Sightings rail (the "where is
		// it in the list?"). Bound as a general map click + queryRenderedFeatures so
		// it is robust to the sighting layer being added after this effect runs.
		const handleSightingClick = (event: maplibregl.MapMouseEvent) => {
			if (isInDrawingMode || !onInspectSighting) return
			if (!mapInstance.getLayer(SIGHTING_HIT_LAYER)) return
			const features = mapInstance.queryRenderedFeatures(event.point, {
				layers: [SIGHTING_HIT_LAYER],
			})
			const feature = features[0]
			if (!feature?.properties) return
			const sightingId =
				typeof feature.properties.sightingId === 'string'
					? feature.properties.sightingId
					: undefined
			const sightingDTag =
				typeof feature.properties.sightingDTag === 'string'
					? feature.properties.sightingDTag
					: undefined
			const sightings = sightingsRef?.current ?? []
			const sighting =
				sightings.find((item) => item.id === sightingId) ??
				(sightingDTag
					? sightings.find((item) => (item.dTag ?? item.id) === sightingDTag)
					: undefined)
			if (sighting) onInspectSighting(sighting)
		}

		// Hover preview for a Sighting marker — the dataset hover-popup analog.
		const resolveHoveredSighting = (feature: maplibregl.MapGeoJSONFeature) => {
			if (!feature.properties) return undefined
			const sightingId =
				typeof feature.properties.sightingId === 'string'
					? feature.properties.sightingId
					: undefined
			const sightingDTag =
				typeof feature.properties.sightingDTag === 'string'
					? feature.properties.sightingDTag
					: undefined
			const sightings = sightingsRef?.current ?? []
			return (
				sightings.find((item) => item.id === sightingId) ??
				(sightingDTag
					? sightings.find((item) => (item.dTag ?? item.id) === sightingDTag)
					: undefined)
			)
		}

		const handleSightingHover = (event: maplibregl.MapLayerMouseEvent) => {
			if (isInDrawingMode || !setSightingPopupData) return
			const feature = event.features?.[0]
			const sighting = feature ? resolveHoveredSighting(feature) : undefined
			if (!sighting) {
				setSightingPopupData(null)
				return
			}
			mapInstance.getCanvas().style.cursor = 'pointer'
			setSightingPopupData({
				sighting,
				clickPosition: { x: event.point.x, y: event.point.y },
			})
		}

		const handleSightingLeave = () => {
			if (isInDrawingMode) return
			mapInstance.getCanvas().style.cursor = ''
			setSightingPopupData?.(null)
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

		mapInstance.on('click', handleSightingClick)
		// Pointer affordance + hover preview over Sighting markers. The sighting layer
		// exists by the time remoteLayersReady is true (it is added before that flag
		// flips), so the layer-scoped binding is reliable here.
		if (mapInstance.getLayer(SIGHTING_HIT_LAYER)) {
			mapInstance.on('mousemove', SIGHTING_HIT_LAYER, handleSightingHover)
			mapInstance.on('mouseleave', SIGHTING_HIT_LAYER, handleSightingLeave)
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
			try {
				mapInstance.off('click', handleSightingClick)
				mapInstance.off('mousemove', SIGHTING_HIT_LAYER, handleSightingHover)
				mapInstance.off('mouseleave', SIGHTING_HIT_LAYER, handleSightingLeave)
			} catch {
				// Layer may have been removed
			}
		}
	}, [
		mapInstance,
		isInDrawingMode,
		geoEventsRef,
		remoteLayersReady,
		CLUSTERED_SOURCE_ID,
		viewMode,
		currentUserPubkey,
		getDatasetName,
		setFeaturePopupData,
		setGeometryChoiceData,
		chooseRemoteGeometry,
		sightingsRef,
		onInspectSighting,
		setSightingPopupData,
	])

	return { chooseRemoteGeometry }
}
