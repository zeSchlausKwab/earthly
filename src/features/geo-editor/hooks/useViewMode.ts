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
	const setStance = useEditorStore((state) => state.setStance)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)
	const selectMobileEntitySurface = useEditorStore((state) => state.selectMobileEntitySurface)

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
		// Stance transition: leaving inspect returns to 'author' if the user
		// still has an active draft, otherwise 'browse'. Never lands in 'focus'
		// since focus is what we just exited.
		setStance(activeDataset ? 'author' : 'browse')
	}, [
		setViewingDataset,
		setViewingContext,
		setViewingContextDatasets,
		setViewMode,
		clearFocused,
		onClearRouteFocus,
		setStance,
		activeDataset,
	])

	const handleInspectDataset = useCallback(
		(event: GeoDataset) => {
			selectMobileEntitySurface('inspector')
			setViewingDataset(event)
			setViewingContext(null)
			setViewingContextDatasets([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
			setStance('focus')
			// Round G.2: feed the catalog's Recent tab.
			recordRecentEntity(`dataset:${event.pubkey}:${event.datasetId ?? event.id}`)

			// Update URL with naddr
			const naddr = encodeGeoEventNaddr(event)
			if (naddr) {
				onNavigateToFocus?.('geoevent', naddr, 'datasets')
			}
		},
		[
			setViewingDataset,
			setViewingContext,
			setViewingContextDatasets,
			setViewMode,
			onEnsureInfoPanelVisible,
			onNavigateToFocus,
			setStance,
			recordRecentEntity,
			selectMobileEntitySurface,
		],
	)

	/**
	 * Inspect a dataset without triggering focus mode (no URL update).
	 * Used when clicking on a geometry on the map.
	 */
	const handleInspectDatasetWithoutFocus = useCallback(
		(event: GeoDataset) => {
			selectMobileEntitySurface('inspector')
			setViewingDataset(event)
			setViewingContext(null)
			setViewingContextDatasets([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
			setStance('focus')
			recordRecentEntity(`dataset:${event.pubkey}:${event.datasetId ?? event.id}`)
			// Do NOT update URL - this prevents focus mode from being triggered
		},
		[
			setViewingDataset,
			setViewingContext,
			setViewingContextDatasets,
			setViewMode,
			onEnsureInfoPanelVisible,
			setStance,
			recordRecentEntity,
			selectMobileEntitySurface,
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
