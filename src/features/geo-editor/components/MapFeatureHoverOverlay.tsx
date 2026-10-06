import { useCallback, useEffect, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { useMapInteractions, type RemoteGeometryChoiceRequest } from '../hooks/useMapInteractions'
import { FeaturePopup, type FeaturePopupData } from './FeaturePopup'
import { GeometryChoiceMenu } from './GeometryChoiceMenu'
import { SightingPopup, type SightingPopupData } from './SightingPopup'
import type { MapPopupPlacement } from './map-popup-positioning'
import { useEditorStore } from '../store'
import type { FeatureCollection } from 'geojson'
import type { PresentationFeatureProvenance } from '../map-presentation/ids'

interface MapFeatureHoverOverlayProps {
	mapletLayerIds?: readonly string[]
	mapletLayersReady?: boolean
	onInspectMaplet?: (instanceId: string, featureId: string) => void
	mapRef: React.RefObject<maplibregl.Map | null>
	containerRef: React.RefObject<HTMLDivElement | null>
	remoteLayersReady: boolean
	clusteredSourceId: string
	geoEventsRef: React.RefObject<GeoDataset[]>
	currentUserPubkey?: string
	getDatasetName: (event: GeoDataset) => string
	resolveSourceCollection?: (
		event: GeoDataset,
		presentation?: PresentationFeatureProvenance,
	) => FeatureCollection | undefined
	handleInspectDatasetWithoutFocus: (event: GeoDataset) => void
	sightingsRef?: React.RefObject<TemporalSighting[]>
	onInspectSighting?: (sighting: TemporalSighting) => void
	popupsEnabled?: boolean
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	suppressed?: boolean
	presentationLayerIds?: readonly string[]
	presentationLayersReady?: boolean
}

export function MapFeatureHoverOverlay({
	mapletLayerIds,
	mapletLayersReady,
	onInspectMaplet,
	mapRef,
	containerRef,
	remoteLayersReady,
	clusteredSourceId,
	geoEventsRef,
	currentUserPubkey,
	getDatasetName,
	resolveSourceCollection,
	handleInspectDatasetWithoutFocus,
	sightingsRef,
	onInspectSighting,
	popupsEnabled = false,
	placementMode = 'geometry',
	toolbarOffset = 72,
	suppressed = false,
	presentationLayerIds = [],
	presentationLayersReady = false,
}: MapFeatureHoverOverlayProps) {
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)
	const [clickedFeaturePopupData, setClickedFeaturePopupData] = useState<FeaturePopupData | null>(
		null,
	)
	const viewMode = useEditorStore((state) => state.viewMode)
	useEffect(() => {
		if (viewMode === 'edit') setClickedFeaturePopupData(null)
	}, [viewMode])
	const [sightingPopupData, setSightingPopupData] = useState<SightingPopupData | null>(null)
	const [geometryChoiceData, setGeometryChoiceData] = useState<RemoteGeometryChoiceRequest | null>(
		null,
	)
	const [displayedFeaturePopupData, setDisplayedFeaturePopupData] =
		useState<FeaturePopupData | null>(null)
	const popupHoverRef = useRef(false)
	const hideTimeoutRef = useRef<number | null>(null)

	const clearHideTimeout = useCallback(() => {
		if (hideTimeoutRef.current !== null) {
			window.clearTimeout(hideTimeoutRef.current)
			hideTimeoutRef.current = null
		}
	}, [])

	const scheduleHide = useCallback(() => {
		clearHideTimeout()
		hideTimeoutRef.current = window.setTimeout(() => {
			if (popupHoverRef.current) return
			setDisplayedFeaturePopupData(null)
			hideTimeoutRef.current = null
		}, 1200)
	}, [clearHideTimeout])

	useEffect(() => {
		if (!popupsEnabled || suppressed || viewMode === 'edit') {
			setFeaturePopupData(null)
			setDisplayedFeaturePopupData(null)
			clearHideTimeout()
		}
	}, [clearHideTimeout, popupsEnabled, suppressed, viewMode])

	const closeClickedFeaturePopup = useCallback(() => {
		setClickedFeaturePopupData(null)
		setFeaturePopupData(null)
		setDisplayedFeaturePopupData(null)
		popupHoverRef.current = false
		clearHideTimeout()
	}, [clearHideTimeout])

	useEffect(() => {
		if (!popupsEnabled || suppressed) return
		if (featurePopupData) {
			clearHideTimeout()
			setDisplayedFeaturePopupData(featurePopupData)
			return
		}
		if (displayedFeaturePopupData) {
			scheduleHide()
			return
		}
		setDisplayedFeaturePopupData(null)
	}, [
		clearHideTimeout,
		displayedFeaturePopupData,
		featurePopupData,
		popupsEnabled,
		scheduleHide,
		suppressed,
	])

	useEffect(() => {
		return () => clearHideTimeout()
	}, [clearHideTimeout])

	const handlePopupHoverChange = useCallback(
		(hovered: boolean) => {
			popupHoverRef.current = hovered
			if (hovered) {
				clearHideTimeout()
				return
			}
			if (!featurePopupData && displayedFeaturePopupData) {
				scheduleHide()
			}
		},
		[clearHideTimeout, displayedFeaturePopupData, featurePopupData, scheduleHide],
	)

	const { chooseRemoteGeometry } = useMapInteractions({
		mapletLayerIds,
		mapletLayersReady,
		onInspectMaplet,
		mapRef,
		remoteLayersReady,
		CLUSTERED_SOURCE_ID: clusteredSourceId,
		geoEventsRef,
		currentUserPubkey,
		getDatasetName,
		resolveSourceCollection,
		handleInspectDatasetWithoutFocus,
		setFeaturePopupData,
		setClickedFeaturePopupData,
		setGeometryChoiceData,
		sightingsRef,
		onInspectSighting,
		setSightingPopupData,
		presentationLayerIds,
		presentationLayersReady,
	})

	useEffect(() => {
		if (!geometryChoiceData) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setGeometryChoiceData(null)
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [geometryChoiceData])

	if ((!popupsEnabled || suppressed) && !geometryChoiceData && !clickedFeaturePopupData) {
		return null
	}

	return (
		<>
			{geometryChoiceData ? (
				<GeometryChoiceMenu
					items={geometryChoiceData.choices.map((choice) => {
						const properties = choice.feature.properties as Record<string, unknown> | null
						return {
							id: choice.id,
							geometry: choice.feature.geometry,
							isAnnotation: properties?.featureType === 'annotation',
							name:
								(typeof properties?.name === 'string' && properties.name) ||
								(typeof properties?.title === 'string' && properties.title) ||
								(typeof properties?.label === 'string' && properties.label) ||
								`${choice.feature.geometry.type} · ${choice.featureId?.slice(0, 8) ?? 'feature'}`,
							context: choice.datasetName,
							presentationLayer: choice.presentation?.layerId,
						}
					})}
					point={geometryChoiceData.point}
					container={containerRef.current}
					title="Choose map geometry"
					onChoose={(choiceId) => {
						const choice = geometryChoiceData.choices.find((item) => item.id === choiceId)
						if (choice) chooseRemoteGeometry(choice, geometryChoiceData.point)
					}}
					onClose={() => setGeometryChoiceData(null)}
				/>
			) : null}
			{!geometryChoiceData &&
			viewMode !== 'edit' &&
			(clickedFeaturePopupData || (popupsEnabled && !suppressed)) ? (
				<>
					<FeaturePopup
						data={clickedFeaturePopupData ?? displayedFeaturePopupData}
						containerRef={containerRef}
						placementMode={placementMode}
						toolbarOffset={toolbarOffset}
						interactive
						onClose={clickedFeaturePopupData ? closeClickedFeaturePopup : undefined}
						onHoverChange={handlePopupHoverChange}
					/>
					{!clickedFeaturePopupData && popupsEnabled && !suppressed && (
						<SightingPopup
							data={sightingPopupData}
							containerRef={containerRef}
							placementMode={placementMode}
							toolbarOffset={toolbarOffset}
						/>
					)}
				</>
			) : null}
		</>
	)
}
