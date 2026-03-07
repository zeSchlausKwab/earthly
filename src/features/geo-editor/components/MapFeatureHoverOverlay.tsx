import { useCallback, useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { useMapInteractions } from '../hooks/useMapInteractions'
import { FeaturePopup, type FeaturePopupData } from './FeaturePopup'
import type { MapPopupPlacement } from './map-popup-positioning'

interface MapFeatureHoverOverlayProps {
	mapRef: React.RefObject<maplibregl.Map | null>
	containerRef: React.RefObject<HTMLDivElement | null>
	remoteLayersReady: boolean
	clusteredSourceId: string
	geoEventsRef: React.RefObject<NDKGeoEvent[]>
	currentUserPubkey?: string
	getDatasetName: (event: NDKGeoEvent) => string
	handleInspectDatasetWithoutFocus: (event: NDKGeoEvent) => void
	popupsEnabled?: boolean
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	suppressed?: boolean
}

export function MapFeatureHoverOverlay({
	mapRef,
	containerRef,
	remoteLayersReady,
	clusteredSourceId,
	geoEventsRef,
	currentUserPubkey,
	getDatasetName,
	handleInspectDatasetWithoutFocus,
	popupsEnabled = true,
	placementMode = 'geometry',
	toolbarOffset = 72,
	suppressed = false,
}: MapFeatureHoverOverlayProps) {
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)
	const [displayedFeaturePopupData, setDisplayedFeaturePopupData] = useState<FeaturePopupData | null>(
		null,
	)
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
		if (!popupsEnabled || suppressed) {
			setFeaturePopupData(null)
			setDisplayedFeaturePopupData(null)
			clearHideTimeout()
		}
	}, [clearHideTimeout, popupsEnabled, suppressed])

	useEffect(() => {
		if (!popupsEnabled || suppressed) return
		if (featurePopupData) {
			clearHideTimeout()
			setDisplayedFeaturePopupData(featurePopupData)
			return
		}
		if (placementMode === 'dock' && displayedFeaturePopupData) {
			scheduleHide()
			return
		}
		setDisplayedFeaturePopupData(null)
	}, [
		clearHideTimeout,
		displayedFeaturePopupData,
		featurePopupData,
		placementMode,
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
			if (!featurePopupData && placementMode === 'dock' && displayedFeaturePopupData) {
				scheduleHide()
			}
		},
		[clearHideTimeout, displayedFeaturePopupData, featurePopupData, placementMode, scheduleHide],
	)

	useMapInteractions({
		mapRef,
		remoteLayersReady,
		CLUSTERED_SOURCE_ID: clusteredSourceId,
		geoEventsRef,
		currentUserPubkey,
		getDatasetName,
		handleInspectDatasetWithoutFocus,
		setFeaturePopupData,
	})

	if (!popupsEnabled || suppressed) {
		return null
	}

	return (
		<FeaturePopup
			data={displayedFeaturePopupData}
			containerRef={containerRef}
			placementMode={placementMode}
			toolbarOffset={toolbarOffset}
			interactive={placementMode === 'dock'}
			onHoverChange={handlePopupHoverChange}
		/>
	)
}
