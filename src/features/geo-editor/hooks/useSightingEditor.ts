import type { Geometry } from 'geojson'
import { useCallback, useState } from 'react'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { useEditorStore, type SidebarViewMode } from '../store'

/** A placeable Sighting geometry captured from the map-first pin-drop (D-01/D-02). */
export type PlacedSightingGeometry = Geometry

interface UseSightingEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	navigateToView: (view: SidebarViewMode) => void
	/** Write the canonical entity focus URL for an in-app inspection. */
	navigateTo: (focusType: 'sighting', naddr: string, sidebarView?: SidebarViewMode) => void
	encodeSightingNaddr: (sighting: TemporalSighting) => string | null
	clearFocus: () => void
	/**
	 * Arm the GeoEditor pin-drop (D-01). Called by `handleCreateSighting`; the
	 * caller (GeoEditorView) sets `editor.setMode('draw_point')` and shows the
	 * placement overlay. Returns nothing — the placed geometry arrives via
	 * `handleGeometryPlaced` on the editor `'create'` event.
	 */
	armPlacement: () => void
	/** Disarm the pin-drop and clear any placement overlay/draw mode. */
	disarmPlacement: () => void
}

/**
 * Temporal Sighting create/edit/inspect lifecycle (Phase 11, D-01/D-07). The
 * structural twin of `useStoryEditor`, but map-first: `handleCreateSighting` arms
 * the GeoEditor pin-drop (via the injected `armPlacement`) and the placed geometry
 * flows in through `handleGeometryPlaced` to open the editor. `viewSighting` is
 * held as local hook state while every inspection also writes the canonical
 * `/sightings/sighting/:naddr` focus route.
 */
export function useSightingEditor({
	isMobile,
	ensureInfoPanelVisible,
	navigateToView,
	navigateTo,
	encodeSightingNaddr,
	clearFocus,
	armPlacement,
	disarmPlacement,
}: UseSightingEditorParams) {
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewStory = useEditorStore((state) => state.setViewStory)
	const setStance = useEditorStore((state) => state.setStance)
	const setInspectionSubject = useEditorStore((state) => state.setInspectionSubject)
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)
	const selectMobileEntitySurface = useEditorStore((state) => state.selectMobileEntitySurface)

	const [sightingEditorMode, setSightingEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingSighting, setEditingSighting] = useState<TemporalSighting | null>(null)
	const [viewSighting, setViewSighting] = useState<TemporalSighting | null>(null)
	// The d-tag/id of the most recently inspected Sighting. Unlike `viewSighting`
	// (which clears when the detail panel closes / "Back to Sightings"), this PERSISTS
	// so the Sightings rail can highlight + scroll to the row you last opened from the
	// map — the "where is this in the list?" affordance. A marker click hides the list
	// behind the full-panel detail, so the highlight is only ever seen AFTER returning
	// to the list, which is exactly when `viewSighting` is already null.
	const [lastInspectedSightingKey, setLastInspectedSightingKey] = useState<string | null>(null)
	const [placedGeometry, setPlacedGeometry] = useState<PlacedSightingGeometry | null>(null)
	// True while the create flow is armed and waiting for a map click (D-01 overlay).
	const [placementArmed, setPlacementArmed] = useState(false)
	// WR-06: the deep-linked comment d-tag to focus beneath the viewed Sighting.
	// Inspect navigation intentionally omits the comment suffix after capturing it
	// here, so CommentsPanel can focus it even as the canonical entity URL is written.
	const [focusCommentId, setFocusCommentId] = useState<string | undefined>(undefined)

	const clearSightingEditorModes = useCallback(() => {
		setSightingEditorMode('none')
		setEditingSighting(null)
		setPlacedGeometry(null)
	}, [])

	/** Clear BOTH the editor modes and the inspected view (browse-away / delete). */
	const clearSightingView = useCallback(() => {
		setSightingEditorMode('none')
		setEditingSighting(null)
		setPlacedGeometry(null)
		setViewSighting(null)
		setFocusCommentId(undefined)
	}, [])

	const prepareNonGeometryWorkspace = useCallback(() => {
		setViewModeState('view')
		setViewDatasetState(null)
		setViewContext(null)
		setViewContextDatasets([])
		setViewStory(null)
		clearFocus()
	}, [
		setViewModeState,
		setViewDatasetState,
		setViewContext,
		setViewContextDatasets,
		setViewStory,
		clearFocus,
	])

	const handleInspectSighting = useCallback(
		(sighting: TemporalSighting, commentId?: string) => {
			selectMobileEntitySurface('sighting')
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewStory(null)
			setInspectionSubject({ kind: 'sighting', entity: sighting })
			setViewSighting(sighting)
			// WR-06: honor the OG comment deep link beneath this Sighting. Held in hook
			// state because canonical inspect navigation omits `/comment/:id`.
			setFocusCommentId(commentId)
			ensureInfoPanelVisible()
			setStance('focus')
			const naddr = encodeSightingNaddr(sighting)
			if (naddr) {
				navigateTo('sighting', naddr, 'sightings')
			} else {
				navigateToView('sightings')
			}

			const sightingKey = sighting.dTag ?? sighting.id
			setLastInspectedSightingKey(sightingKey ?? null)
			if (sightingKey) recordRecentEntity(`sighting:${sightingKey}`)
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewStory,
			setInspectionSubject,
			ensureInfoPanelVisible,
			setStance,
			navigateTo,
			navigateToView,
			encodeSightingNaddr,
			recordRecentEntity,
			selectMobileEntitySurface,
		],
	)

	const handleCreateSighting = useCallback(() => {
		selectMobileEntitySurface('sighting')
		clearSightingEditorModes()
		setViewSighting(null)
		setFocusCommentId(undefined)
		prepareNonGeometryWorkspace()
		navigateToView('sightings')
		// Map-first (D-01): arm the pin-drop; the editor opens on the placed geometry.
		setPlacementArmed(true)
		armPlacement()
	}, [
		armPlacement,
		clearSightingEditorModes,
		navigateToView,
		prepareNonGeometryWorkspace,
		selectMobileEntitySurface,
	])

	/**
	 * The GeoEditor `'create'` event delivered the placed feature's geometry (D-01,
	 * or a redrawn area via D-02). Capture it, disarm placement, and open the editor
	 * with the geometry as a prop.
	 */
	const handleGeometryPlaced = useCallback(
		(geometry: PlacedSightingGeometry) => {
			selectMobileEntitySurface('sighting')
			setPlacedGeometry(geometry)
			setPlacementArmed(false)
			disarmPlacement()
			setSightingEditorMode((mode) => (mode === 'none' ? 'create' : mode))
			setViewSighting(null)
			setFocusCommentId(undefined)
			prepareNonGeometryWorkspace()
			navigateToView('sightings')
			if (isMobile) ensureInfoPanelVisible()
			else setShowInfoPanel(true)
		},
		[
			disarmPlacement,
			ensureInfoPanelVisible,
			isMobile,
			navigateToView,
			prepareNonGeometryWorkspace,
			selectMobileEntitySurface,
			setShowInfoPanel,
		],
	)

	const cancelPlacement = useCallback(() => {
		setPlacementArmed(false)
		disarmPlacement()
		if (sightingEditorMode === 'create' && !placedGeometry) {
			setSightingEditorMode('none')
		}
	}, [disarmPlacement, sightingEditorMode, placedGeometry])

	const rearmPlacement = useCallback(() => {
		setPlacementArmed(true)
		armPlacement()
	}, [armPlacement])

	const handleEditSighting = useCallback(
		(sighting: TemporalSighting) => {
			selectMobileEntitySurface('sighting')
			clearSightingEditorModes()
			setPlacementArmed(false)
			disarmPlacement()
			setSightingEditorMode('edit')
			setEditingSighting(sighting)
			setViewSighting(null)
			setFocusCommentId(undefined)
			prepareNonGeometryWorkspace()
			navigateToView('sightings')
			if (isMobile) ensureInfoPanelVisible()
			else setShowInfoPanel(true)
		},
		[
			clearSightingEditorModes,
			disarmPlacement,
			prepareNonGeometryWorkspace,
			navigateToView,
			isMobile,
			ensureInfoPanelVisible,
			selectMobileEntitySurface,
			setShowInfoPanel,
		],
	)

	const handleSaveSighting = useCallback(
		(sighting: TemporalSighting) => {
			setSightingEditorMode('none')
			setEditingSighting(null)
			setPlacedGeometry(null)
			handleInspectSighting(sighting)
		},
		[handleInspectSighting],
	)

	const handleCloseSightingEditor = useCallback(() => {
		// Navigation-safe close: only reroute when the editor (or armed placement)
		// was actually active — `startCreate` calls this as blanket cleanup for
		// unrelated create flows.
		const wasOpen = sightingEditorMode !== 'none' || placementArmed
		setSightingEditorMode('none')
		setEditingSighting(null)
		setPlacedGeometry(null)
		setPlacementArmed(false)
		disarmPlacement()
		if (wasOpen) navigateToView('sightings')
	}, [sightingEditorMode, placementArmed, disarmPlacement, navigateToView])

	return {
		sightingEditorMode,
		editingSighting,
		viewSighting,
		/** Persisted highlight key for the Sightings rail (survives closing the detail). */
		lastInspectedSightingKey,
		/** WR-06: deep-linked comment d-tag to focus beneath the viewed Sighting. */
		sightingFocusCommentId: focusCommentId,
		placedGeometry,
		placementArmed,
		rearmPlacement,
		clearSightingEditorModes,
		clearSightingView,
		handleInspectSighting,
		handleCreateSighting,
		handleGeometryPlaced,
		cancelPlacement,
		handleEditSighting,
		handleSaveSighting,
		handleCloseSightingEditor,
	}
}
