import { useCallback, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore } from '../store'

interface UseViewModeOptions {
	geoEvents: GeoDataset[]
	onEnsureInfoPanelVisible: () => void
	onNavigateToFocus?: (
		focusType: 'geoevent' | 'mapcontext',
		naddr: string,
		sidebarView?: 'datasets' | 'contexts',
	) => void
	onClearRouteFocus?: () => void
	/** Callback to zoom/fly to a dataset's bounds */
	onZoomToDataset?: (event: GeoDataset) => void
}

/**
 * Generate naddr for a geo event
 */
function encodeGeoEventNaddr(event: GeoDataset): string | null {
	const identifier = event.datasetId ?? event.dTag
	if (!identifier || !event.kind) return null

	try {
		return nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier,
		})
	} catch {
		return null
	}
}

export function useViewMode({
	geoEvents: _geoEvents,
	onEnsureInfoPanelVisible,
	onNavigateToFocus,
	onClearRouteFocus,
	onZoomToDataset,
}: UseViewModeOptions) {
	const [infoMode, setInfoMode] = useState<'properties' | 'json' | 'edit' | 'view'>('properties')
	const [sidebarMode, setSidebarMode] = useState<
		'datasets' | 'info' | 'editor' | 'dataset' | 'inspector'
	>('datasets')
	const [debugEvent, setDebugEvent] = useState<GeoDataset | MapContext | null>(null)
	const [debugDialogOpen, setDebugDialogOpen] = useState(false)

	// Store state
	const viewingDataset = useEditorStore((state) => state.viewDataset)

	// Store actions
	const setViewingDataset = useEditorStore((state) => state.setViewDataset)
	const setViewingContext = useEditorStore((state) => state.setViewContext)
	const setViewingContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const clearFocused = useEditorStore((state) => state.clearFocused)

	const exitViewMode = useCallback(() => {
		setInfoMode('edit')
		setViewMode('edit')
		setViewingDataset(null)
		setViewingContext(null)
		setViewingContextDatasets([])
		setSidebarMode('editor')
		// Clear URL and focus state
		clearFocused()
		onClearRouteFocus?.()
	}, [
		setViewingDataset,
		setViewingContext,
		setViewingContextDatasets,
		setViewMode,
		clearFocused,
		onClearRouteFocus,
	])

	const handleInspectDataset = useCallback(
		(event: GeoDataset) => {
			setViewingDataset(event)
			setViewingContext(null)
			setViewingContextDatasets([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()

			// Update URL with naddr
			const naddr = encodeGeoEventNaddr(event)
			if (naddr) {
				onNavigateToFocus?.('geoevent', naddr, 'datasets')
			}

			// Fly to the dataset bounds
			onZoomToDataset?.(event)
		},
		[
			setViewingDataset,
			setViewingContext,
			setViewingContextDatasets,
			setViewMode,
			onEnsureInfoPanelVisible,
			onNavigateToFocus,
			onZoomToDataset,
		],
	)

	/**
	 * Inspect a dataset without triggering focus mode (no URL update).
	 * Used when clicking on a geometry on the map.
	 */
	const handleInspectDatasetWithoutFocus = useCallback(
		(event: GeoDataset) => {
			setViewingDataset(event)
			setViewingContext(null)
			setViewingContextDatasets([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
			// Do NOT update URL - this prevents focus mode from being triggered
		},
		[
			setViewingDataset,
			setViewingContext,
			setViewingContextDatasets,
			setViewMode,
			onEnsureInfoPanelVisible,
		],
	)

	const handleOpenDebug = useCallback((event: GeoDataset | MapContext) => {
		setDebugEvent(event)
		setDebugDialogOpen(true)
	}, [])

	return {
		// State
		infoMode,
		setInfoMode,
		sidebarMode,
		setSidebarMode,
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		// Actions
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleOpenDebug,
	}
}
