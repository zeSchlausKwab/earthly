import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { BeaconStartOptions } from '@/components/info-panel/BeaconControlPanel'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { useEditorStore, type SidebarViewMode } from '../store'
import { useBeaconPublisher } from './useBeaconPublisher'

interface UseBeaconControllerParams {
	ensureInfoPanelVisible: () => void
	navigateToView: (view: SidebarViewMode) => void
	/** Focus-preserving nav — keeps `/beacons/beacon/:naddr` in the URL so a
	 *  deep-linked beacon opens the read view and STAYS on the route (not the list). */
	navigateTo: (
		focusType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
		naddr: string,
		sidebarView?: SidebarViewMode,
	) => void
	/** Encode a beacon to its share naddr (throwaway pubkey). */
	encodeBeaconNaddr: (beacon: LiveBeacon) => string | null
	/** Zoom/center the map on a beacon's position. */
	zoomToBeacon: (beacon: LiveBeacon) => void
	clearFocus: () => void
}

/**
 * Live Beacon (kind 37521) Start/Stop/Adjust/inspect lifecycle (Phase 12,
 * BEACON-01..04, D-12). The structural twin of `useSightingEditor`, but with the
 * pin-drop DROPPED entirely — a beacon's position comes from GPS via the composed
 * `useBeaconPublisher`, never a placed pin. The hook binds the publisher session to
 * the UI: `handleShareLocation` opens the control panel, `handleStartBeacon` mints a
 * session + begins the watch loop, `handleStopBeacon` ends it, `handleAdjustBeacon`
 * reopens the control pre-filled, and `handleInspectBeacon` opens the read panel.
 *
 * `viewBeacon` / `beaconControlMode` are hook-local state (the canonical
 * /beacon/:naddr focus route is a thin per-kind clone — Phase 13 / XCUT-02 owns
 * convergence). `lastInspectedBeaconKey` PERSISTS after the detail closes so the
 * Beacons rail can highlight + scroll the row you last opened from the map.
 */
export function useBeaconController({
	ensureInfoPanelVisible,
	navigateToView,
	navigateTo,
	encodeBeaconNaddr,
	zoomToBeacon,
	clearFocus,
}: UseBeaconControllerParams) {
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewStory = useEditorStore((state) => state.setViewStory)
	const setStance = useEditorStore((state) => state.setStance)
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)

	// The live publish loop + per-session throwaway signer (Plan 03).
	const publisher = useBeaconPublisher()

	const [beaconControlMode, setBeaconControlMode] = useState<'none' | 'create' | 'adjust'>('none')
	// The beacon being adjusted (pre-fills the control panel). Null ⇒ a fresh Start.
	const [adjustingBeacon, setAdjustingBeacon] = useState<LiveBeacon | null>(null)
	const [viewBeacon, setViewBeacon] = useState<LiveBeacon | null>(null)
	// After a Start, we want to open the owner's read/share view — but the first
	// beacon isn't published until the first GPS fix arrives (async). This flag
	// defers the open until `publisher.liveBeacon` becomes available.
	const [pendingOwnView, setPendingOwnView] = useState(false)
	// The d-tag/id of the most recently inspected beacon — persists so the Beacons
	// rail can highlight + scroll the row you last opened from the map (mirrors the
	// Sighting `lastInspectedSightingKey`).
	const [lastInspectedBeaconKey, setLastInspectedBeaconKey] = useState<string | null>(null)

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

	const handleCloseBeaconControl = useCallback(() => {
		setBeaconControlMode('none')
		setAdjustingBeacon(null)
		navigateToView('beacons')
	}, [navigateToView])

	/** Open the Start-beacon control panel (the "Share live location" CTA). */
	const handleShareLocation = useCallback(() => {
		setViewBeacon(null)
		setAdjustingBeacon(null)
		prepareNonGeometryWorkspace()
		setBeaconControlMode('create')
		setStance('focus')
		ensureInfoPanelVisible()
		navigateToView('beacons')
	}, [prepareNonGeometryWorkspace, setStance, ensureInfoPanelVisible, navigateToView])

	/** Start (or re-Start after Adjust) the publisher session, then close the control. */
	const handleStartBeacon = useCallback(
		async (options: BeaconStartOptions) => {
			try {
				await publisher.startBeacon({
					content: options.content.label ? { label: options.content.label } : {},
					expiration: options.expiration,
					visibility: options.visibility,
					identity: options.identity,
				})
				setBeaconControlMode('none')
				setAdjustingBeacon(null)
				// Open the owner's read/share view as soon as the first fix publishes —
				// this is where the Copy-share-link lives (fixes "Start → empty inspect
				// panel, no link"). Deferred via pendingOwnView because the first beacon
				// isn't published until GPS delivers a fix.
				setPendingOwnView(true)
			} catch (err) {
				console.error('useBeaconController: failed to start beacon', err)
				toast.error("Couldn't start your beacon. Check your connection and try again.")
			}
		},
		[publisher],
	)

	// Once the just-started beacon publishes, open its read/share view (BeaconViewPanel
	// with the Copy-share-link). Fires only for a fresh Start (pendingOwnView), never
	// when inspecting someone else's beacon.
	useEffect(() => {
		if (pendingOwnView && publisher.liveBeacon) {
			setViewBeacon(publisher.liveBeacon)
			setViewModeState('view')
			setStance('focus')
			setPendingOwnView(false)
		}
	}, [pendingOwnView, publisher.liveBeacon, setViewModeState, setStance])

	/** Stop the user's own live beacon (the no-delete-recap alert-dialog confirms first). */
	const handleStopBeacon = useCallback(async () => {
		setPendingOwnView(false)
		try {
			await publisher.stopBeacon()
		} catch (err) {
			console.error('useBeaconController: failed to stop beacon', err)
			toast.error("Couldn't stop your beacon cleanly — it will still expire on its own.")
		}
	}, [publisher])

	/** Reopen the control panel pre-filled to adjust an active beacon (preserves `d`). */
	const handleAdjustBeacon = useCallback(
		(beacon?: LiveBeacon) => {
			setViewBeacon(null)
			setAdjustingBeacon(beacon ?? null)
			prepareNonGeometryWorkspace()
			setBeaconControlMode('adjust')
			setStance('focus')
			ensureInfoPanelVisible()
			navigateToView('beacons')
		},
		[prepareNonGeometryWorkspace, setStance, ensureInfoPanelVisible, navigateToView],
	)

	/** Open a beacon in the read/detail view panel. */
	const handleInspectBeacon = useCallback(
		(beacon: LiveBeacon) => {
			setBeaconControlMode('none')
			setAdjustingBeacon(null)
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewStory(null)
			setViewBeacon(beacon)
			ensureInfoPanelVisible()
			setStance('focus')
			// Preserve the /beacons/beacon/:naddr focus in the URL so a deep link stays
			// on the route and the read view isn't collapsed back to the list. Fall back
			// to a bare view switch only if the beacon can't be addressed.
			const naddr = encodeBeaconNaddr(beacon)
			if (naddr) {
				navigateTo('beacon', naddr, 'beacons')
			} else {
				navigateToView('beacons')
			}
			// Center the map on the beacon so an opened/shared beacon is immediately visible.
			zoomToBeacon(beacon)

			const beaconKey = beacon.dTag ?? beacon.id
			setLastInspectedBeaconKey(beaconKey ?? null)
			if (beaconKey) recordRecentEntity(`beacon:${beaconKey}`)
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewStory,
			ensureInfoPanelVisible,
			setStance,
			navigateTo,
			navigateToView,
			encodeBeaconNaddr,
			zoomToBeacon,
			recordRecentEntity,
		],
	)

	/** Clear the inspected/control state when browsing away. */
	const clearBeaconView = useCallback(() => {
		setBeaconControlMode('none')
		setAdjustingBeacon(null)
		setViewBeacon(null)
	}, [])

	return {
		// Live publish session (drives the RunningBeaconBanner + owner inline actions).
		isLive: publisher.isLive,
		subState: publisher.subState,
		session: publisher.session,
		// Control + view state.
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
		/** Persisted highlight key for the Beacons rail (survives closing the detail). */
		lastInspectedBeaconKey,
		// Lifecycle handlers.
		handleShareLocation,
		handleStartBeacon,
		handleStopBeacon,
		handleAdjustBeacon,
		handleInspectBeacon,
		handleCloseBeaconControl,
		clearBeaconView,
	}
}
