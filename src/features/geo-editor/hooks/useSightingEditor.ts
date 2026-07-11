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
 * held as local hook state (the canonical /sighting/:naddr focus route is Plan 04;
 * this plan keeps the wiring a thin per-kind clone — Phase 13 owns convergence).
 */
export function useSightingEditor({
	isMobile,
	ensureInfoPanelVisible,
	navigateToView,
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
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)

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
	// WR-06: the deep-linked comment d-tag to focus beneath the viewed Sighting. The
	// canonical /sighting/:naddr focus route is deferred (Plan 04/Phase 13), so
	// `handleInspectSighting` switches the sidebar via `navigateToView`, which does
	// NOT preserve the URL `/comment/:id` segment — `route.commentId` would be wiped
	// before CommentsPanel could act on it. Holding it as hook state survives that
	// navigation so the OG comment deep link is honored.
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
			clearSightingEditorModes()
			setPlacementArmed(false)
			disarmPlacement()
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewStory(null)
			setViewSighting(sighting)
			// WR-06: honor the OG comment deep link beneath this Sighting. Held in hook
			// state because navigateToView wipes the URL `/comment/:id` segment.
			setFocusCommentId(commentId)
			ensureInfoPanelVisible()
			setStance('focus')
			navigateToView('sightings')

			const sightingKey = sighting.dTag ?? sighting.id
			setLastInspectedSightingKey(sightingKey ?? null)
			if (sightingKey) recordRecentEntity(`sighting:${sightingKey}`)
		},
		[
			clearSightingEditorModes,
			disarmPlacement,
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewStory,
			ensureInfoPanelVisible,
			setStance,
			navigateToView,
			recordRecentEntity,
		],
	)

	const handleCreateSighting = useCallback(() => {
		clearSightingEditorModes()
		setViewSighting(null)
		setFocusCommentId(undefined)
		prepareNonGeometryWorkspace()
		navigateToView('sightings')
		// Map-first (D-01): arm the pin-drop; the editor opens on the placed geometry.
		setPlacementArmed(true)
		armPlacement()
	}, [clearSightingEditorModes, prepareNonGeometryWorkspace, navigateToView, armPlacement])

	/**
	 * The GeoEditor `'create'` event delivered the placed feature's geometry (D-01,
	 * or a redrawn area via D-02). Capture it, disarm placement, and open the editor
	 * with the geometry as a prop.
	 */
	const handleGeometryPlaced = useCallback(
		(geometry: PlacedSightingGeometry) => {
			setPlacedGeometry(geometry)
			setPlacementArmed(false)
			disarmPlacement()
			setSightingEditorMode((mode) => (mode === 'none' ? 'create' : mode))
			setViewSighting(null)
			setFocusCommentId(undefined)
			prepareNonGeometryWorkspace()
			navigateToView('sightings')
			if (!isMobile) setShowInfoPanel(true)
		},
		[disarmPlacement, prepareNonGeometryWorkspace, navigateToView, isMobile, setShowInfoPanel],
	)

	const cancelPlacement = useCallback(() => {
		setPlacementArmed(false)
		disarmPlacement()
		if (sightingEditorMode === 'create' && !placedGeometry) {
			setSightingEditorMode('none')
		}
	}, [disarmPlacement, sightingEditorMode, placedGeometry])

	const handleEditSighting = useCallback(
		(sighting: TemporalSighting) => {
			clearSightingEditorModes()
			setPlacementArmed(false)
			disarmPlacement()
			setSightingEditorMode('edit')
			setEditingSighting(sighting)
			setViewSighting(null)
			setFocusCommentId(undefined)
			prepareNonGeometryWorkspace()
			navigateToView('sightings')
			if (!isMobile) setShowInfoPanel(true)
		},
		[
			clearSightingEditorModes,
			disarmPlacement,
			prepareNonGeometryWorkspace,
			navigateToView,
			isMobile,
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
