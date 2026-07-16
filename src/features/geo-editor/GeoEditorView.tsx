import { useActiveAccount } from 'applesauce-react/hooks'
import { castEvent } from 'applesauce-core/casts'
import {
	BookOpen,
	Database,
	Download,
	Eye,
	Globe,
	Hexagon,
	Lock,
	LockOpen,
	Layers,
	Map as MapIcon,
	MapPin,
	MapPinned,
	MessageSquare,
	MessageSquareOff,
	Menu,
	MousePointer2,
	PanelTopOpen,
	Plus,
	Radio,
	RadioTower,
	Redo2,
	Search,
	Spline,
	Trash2,
	Undo2,
	Waypoints,
} from 'lucide-react'
import type { FeatureCollection, Geometry } from 'geojson'
import type maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AppSidebar } from '@/components/AppSidebar'
import { ControlButton, ControlGroup } from '@/components/ui/map'
import { BlossomUploadDialog } from '@/components/BlossomUploadDialog'
import { DebugDialog } from '@/components/DebugDialog'
import { MapStackPanel } from '@/components/MapStackPanel'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { executeEditorCommand } from './commands'
import { StudioShell } from './components/StudioShell'
import { useAvailableGeoFeatures } from '@/lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useGeoDatasets, useMapContexts } from '@/lib/hooks/useGeoDatasets'
import { useGroups } from '@/lib/hooks/useGroups'
import { useStories } from '@/lib/hooks/useStories'
import { useSightings } from '@/lib/hooks/useSightings'
import { useBeacons } from '@/lib/hooks/useBeacons'
import { RunningBeaconBanner } from '@/components/RunningBeaconBanner'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { formatExpiryCountdown } from '@/lib/nostr/temporal-sighting'
import { nip19, type NostrEvent } from 'nostr-tools'
import type { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND, LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { isExpired } from '@/lib/nostr/expiry'
import { unixNow } from 'applesauce-core/helpers/time'
import { deleteStory } from '@/lib/nostr/story'
import { deleteSighting, type TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { type MapContext, deleteMapContext } from '@/lib/nostr/map-context'
import { accounts, eventStore } from '@/lib/nostr'
import {
	privateWorkspaceIdForDataset,
	projectPrivateWorkspaceDatasets,
} from '@/lib/private-workspace'
import { usePrivateWorkspaceRuntime } from '@/features/private-maps/usePrivateWorkspaceRuntime'
import { normalizePairingInvitation } from '@/features/offline/pairingQr'
import { useFieldSessions } from '@/features/field-sessions/model'
import {
	fieldSessionDatasetFactory,
	fieldSessionIdForEvent,
	latestFieldSessionDatasetEvents,
} from '@/features/field-sessions/events'
import { useFieldSessionTransport } from '@/features/field-sessions/useFieldSessionTransport'
import {
	fieldDatasetStackEntryId,
	planFieldDatasetStackReconciliation,
} from '@/features/field-sessions/fieldDatasetStack'
import {
	consumePendingNativeDeepLink,
	getPendingNativeDeepLink,
	NATIVE_DEEP_LINK_EVENT,
	type NativeDeepLinkDetail,
} from '@/platform/registry'
import {
	planPrivateDatasetStackReconciliation,
	privateDatasetStackEntryId,
} from '@/features/private-maps/privateDatasetStack'
import {
	defaultContextFilterMode,
	getContextCoordinate,
	isDatasetAllowedByContextFilter,
	validateDatasetForContext,
} from '@/lib/context/validation'
import { getDefaultContextMapScopeMode, resolveContextMapScope } from '@/lib/context/scope'
import { createAuthoring } from './api'
import { AssistantSidebar } from './components/AssistantSidebar'
import { Editor } from './components/Editor'
import {
	encodeBeaconNaddrPure,
	encodeSightingNaddrPure,
	getBeaconMapStackKey,
	getSightingMapStackKey,
} from './mapStackEntityKeys'
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MapFeatureHoverOverlay } from './components/MapFeatureHoverOverlay'
import { mobilePanelHeightPx, MobilePanel } from './components/MobilePanel'
import { MobileToolMenu } from './components/MobileToolMenu'
import { CommentAnnotationPopup } from './components/CommentAnnotationPopup'
import type { CommentAnnotationPopupData } from './components/CommentAnnotationPopup'
import type { MapPopupPlacement } from './components/map-popup-positioning'
import { UserLocationMarker } from './components/UserLocationMarker'
import { EntityPinBubbles } from './components/map/EntityPinBubbles'
import { MobileMapActions } from './components/MobileMapActions'
import { SightingPlacementPreview } from './components/SightingPlacementPreview'
import { GeoEditorMap as MapComponent } from './components/map'
import { OsmResultsPanel } from './components/OsmResultsPanel'
import { StudioStatusBar } from './components/StudioStatusBar'
import { Toolbar } from './components/Toolbar'
import type { EditorEvent, EditorFeature, EditorMode } from './core'
import {
	MAGNIFIER_SIZE,
	useBlobResolution,
	useContextEditor,
	useStoryEditor,
	useSightingEditor,
	useBeaconController,
	useStoryMapRefs,
	useCommentGeometry,
	useProposalGeometry,
	useDatasetManagement,
	useGeoQueryByView,
	useInspector,
	useMagnifier,
	useMapLayers,
	useMentionActions,
	useOsmQuery,
	usePublishing,
	useRouting,
	useViewMode,
} from './hooks'
import { exportShapefile, importShapefile } from './shapefile'
import { getGeoJsonPasteCandidate } from './geoJsonPaste'
import { useEditorStore, type MapStackEntry } from './store'
import type { MapStackEntryType } from './store/types'
import type { GeoSearchResult } from './types'
import { ensureFeatureCollection, extractCollectionMeta, toEditorFeature } from './utils'
import { getMobileDrawingGuidance, isDrawingEditorMode } from './mobileDrawingGuidance'

/**
 * Phase 13 (SPEC §3.2): derive the stack-gated render set for an ephemeral entity
 * kind (sighting/beacon) from Map Stack membership, mirroring `visibleGeoEvents`.
 * Extracted to module scope as a PURE function so the aggregate/individual/
 * isolation/empty behaviors are unit-testable without a live React tree or hooks.
 *
 * Precedence (SPEC §3.2):
 *   1. ISOLATION — if ANY entry is isolated, only that entry renders. If it is this
 *      selector's individual type, return the single matching entity; if it is any
 *      OTHER isolated type (dataset/context/the other kind), return [] (aggregate
 *      layers + this kind are suppressed under isolation).
 *   2. AGGREGATE — a visible `<kind>-layer` entry seeds the result with the full
 *      subscription set (today's always-on behavior, now gated).
 *   3. INDIVIDUAL UNION — union in each visible individual `<kind>` entry resolved
 *      from the subscription by key, de-duped by key (D-04: the buildSource
 *      freshest-per-{pubkey,d} de-dup collapses any residual overlap).
 *
 * `resolveKey(entity)` maps an entity to the stack `entityKey` it is pinned under
 * (naddr or dTag fallback). Expiry is NOT applied here — `buildSightingSource`/
 * `buildBeaconSource` keep their internal `dropExpired`, so this only chooses WHICH
 * entities are candidates (T-13-03-DROPEXPIRED).
 *
 * `individualLookupSet` (optional) is the set used to resolve individual/isolated
 * entries. It defaults to `subscriptionSet`. Beacons pass a SUPERSET here (discovery
 * ∪ routed/viewed/own) so a link-only or deep-linked beacon — which is absent from
 * the `#t:['live']` discovery `subscriptionSet` — still resolves when pinned/isolated
 * on the stack, WITHOUT leaking into the aggregate layer (T-13-03-GPSREGRESS: the
 * aggregate branch only ever seeds from `subscriptionSet`, i.e. discovery).
 */
export function deriveVisibleEntitiesFromStack<T>(
	subscriptionSet: T[],
	entries: Record<string, MapStackEntry>,
	order: string[],
	individualType: MapStackEntryType,
	layerType: MapStackEntryType,
	resolveKey: (entity: T) => string | undefined,
	individualLookupSet: T[] = subscriptionSet,
): T[] {
	// Build the individual-resolution index once (discovery ∪ routed/viewed/own for
	// beacons; just the subscription for sightings).
	const indByKey = new Map<string, T>()
	for (const entity of individualLookupSet) {
		const key = resolveKey(entity)
		if (key !== undefined && !indByKey.has(key)) indByKey.set(key, entity)
	}

	// (1) ISOLATION BRANCH — mirrors visibleGeoEvents L990-1004. First isolated
	// entry in stack order wins; nothing else renders. An isolated individual is
	// resolved against the broader lookup set so a deep-linked link-only beacon
	// (absent from discovery) still renders solo.
	for (const entryId of order) {
		const entry = entries[entryId]
		if (!entry?.isolated) continue
		if (entry.entityType === individualType) {
			const match = indByKey.get(entry.entityKey)
			return match ? [match] : []
		}
		// Any other isolated type (dataset/context/the other kind) suppresses this
		// kind entirely (SPEC §3.2 — aggregate layers off under isolation).
		return []
	}

	// (2) AGGREGATE + (3) INDIVIDUAL UNION — walk visible entries in stack order,
	// seeding the aggregate ONLY from discovery (subscriptionSet), unioning in
	// individual pins resolved from the broader lookup set, de-duped by key.
	const byKey = new Map<string, T>()
	for (const entryId of order) {
		const entry = entries[entryId]
		if (!entry || entry.visible === false) continue
		if (entry.entityType === layerType) {
			for (const entity of subscriptionSet) {
				const key = resolveKey(entity)
				if (key !== undefined && !byKey.has(key)) byKey.set(key, entity)
			}
		} else if (entry.entityType === individualType) {
			const match = indByKey.get(entry.entityKey)
			if (match && !byKey.has(entry.entityKey)) byKey.set(entry.entityKey, match)
		}
	}
	return Array.from(byKey.values())
}

/**
 * Plan 13-06 (UAT test 5b): pure sweep decision for an individual sighting/beacon
 * stack entry, extracted from the expiry-sweep effect so it is unit-testable.
 *
 * An entry is evicted when EITHER it cannot be resolved to any real entity (nothing
 * to render — absent even from the widened added-entity cache), OR the resolved
 * entity is genuinely NIP-40 `expired` (D-02 honesty — a truly-ended beacon/sighting
 * never lingers as a stale marker). A user-added out-of-discovery entry that resolved
 * via the added-entity cache and is NOT expired is KEPT — it stays pinned even though
 * it faded from live-discovery. STALE (beaconState 120s) is NOT expiry and, because
 * this predicate is driven ONLY by `expired`, cannot cause a sweep.
 */
export function shouldSweepStackEntry(status: { resolved: boolean; expired: boolean }): boolean {
	return !status.resolved || status.expired
}

export function GeoEditorView() {
	const map = useRef<maplibregl.Map | null>(null)
	const [mounted, setMounted] = useState(false)
	const {
		route,
		navigateTo,
		navigateToContext,
		navigateToView,
		clearFocus,
		clearContextScope,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		isFocused,
		contextNaddr,
		contextCoordinate,
		userPubkey,
		privateGroupId,
		fieldSessionId,
		commentId: focusCommentId,
	} = useRouting()
	const {
		account: privateWorkspaceAccount,
		runtime: privateWorkspaceRuntime,
		snapshot: privateWorkspaceSnapshot,
	} = usePrivateWorkspaceRuntime()

	// Query-by-view (Map Stack header toggle): viewport relay geo queries on
	// pan/zoom feeding the stack's "Geo query" section. Reads its own enabled
	// flag from the store; inert until toggled on.
	useGeoQueryByView(map, mounted)
	const [mapError, _setMapError] = useState<string | null>(null)
	const [deletingKey, setDeletingKey] = useState<string | null>(null)
	const [resolvedCollectionsVersion, setResolvedCollectionsVersion] = useState(0)
	const [mapPopupsEnabled, setMapPopupsEnabled] = useState(true)
	const [mapPopupPlacement, setMapPopupPlacement] = useState<MapPopupPlacement>('dock')
	// Viewport width — drives how many mobile tool-strip overflow actions fit in
	// the strip vs. collapse into the ••• menu (measured, not fixed breakpoints).
	const [viewportWidth, setViewportWidth] = useState(() =>
		typeof window !== 'undefined' ? window.innerWidth : 1024,
	)
	useEffect(() => {
		if (typeof window === 'undefined') return
		const onResize = () => setViewportWidth(window.innerWidth)
		window.addEventListener('resize', onResize)
		return () => window.removeEventListener('resize', onResize)
	}, [])
	// Desktop panel toggles live in the store (single layout source of truth).
	const desktopMapStackOpen = useEditorStore((state) => state.mapStackOpen)
	const setMapStackOpen = useEditorStore((state) => state.setMapStackOpen)
	const toggleMapStack = useEditorStore((state) => state.toggleMapStack)
	const desktopChatOpen = useEditorStore((state) => state.chatOpen)
	const setChatOpen = useEditorStore((state) => state.setChatOpen)
	const toggleChat = useEditorStore((state) => state.toggleChat)

	const [, setShowToolbar] = useState(true)
	const mapContainerRef = useRef<HTMLDivElement>(null)

	// Extracted hooks
	const {
		magnifierEnabled,
		magnifierVisible,
		magnifierPosition,
		magnifierCenter,
		magnifierZoomOffset,
		setMagnifierZoomOffset,
		magnifierMenuOpen,
		magnifierButtonRef,
		magnifierMenuRef,
		toggleMagnifier,
		handleMagnifierPointerDown,
		handleMagnifierPointerUp,
		clearMagnifierLongPress,
	} = useMagnifier(map)

	const {
		reverseLookupResult,
		setReverseLookupResult,
		reverseLookupStatus,
		reverseLookupError,
		setReverseLookupError,
		inspectorClickPosition,
		setInspectorClickPosition,
		disableInspector,
	} = useInspector(map)

	const {
		handleCommentGeometryVisibility,
		annotationPopupData,
		setAnnotationPopupData,
		pruneCommentGeometry,
	} = useCommentGeometry(map, mounted)
	const { visibleProposalIds, handleToggleProposalOverlay } = useProposalGeometry(map)
	const [displayedAnnotationPopupData, setDisplayedAnnotationPopupData] =
		useState<CommentAnnotationPopupData | null>(null)
	const annotationPopupHoverRef = useRef(false)
	const annotationPopupHideTimeoutRef = useRef<number | null>(null)

	// Zoom helpers (no deps, defined early so hooks can reference them)
	const handleZoomToBounds = useCallback((bounds: [number, number, number, number]) => {
		if (!map.current) return
		const [west, south, east, north] = bounds
		// A zero-area bbox (a single point — e.g. a point Sighting or a one-vertex
		// comment annotation) makes fitBounds zoom to its max; fly to the point at a
		// readable zoom instead.
		if (west === east && south === north) {
			map.current.flyTo({ center: [west, south], zoom: 15, duration: 500 })
			return
		}
		map.current.fitBounds(
			[
				[west, south],
				[east, north],
			],
			{ padding: 50, duration: 500 },
		)
	}, [])

	// Import OSM dialog state
	const [importOsmDialogOpen, setImportOsmDialogOpen] = useState(false)

	// User location tracking state
	const [userLocation, setUserLocation] = useState<{
		lat: number
		lon: number
		accuracy?: number
	} | null>(null)
	const isFirstLocationUpdate = useRef(true)

	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const featuresRef = useRef<EditorFeature[]>([])
	const stats = useEditorStore((state) => state.stats)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const selectionCount = selectedFeatureIds.length
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setStance = useEditorStore((state) => state.setStance)
	const setSettingsTab = useEditorStore((state) => state.setSettingsTab)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const contextMapScopeMode = useEditorStore((state) => state.contextMapScopeMode)
	const setContextMapScopeMode = useEditorStore((state) => state.setContextMapScopeMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
	const setMapStackEntryIsolated = useEditorStore((state) => state.setMapStackEntryIsolated)
	const setMapStackEntryExclusions = useEditorStore((state) => state.setMapStackEntryExclusions)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)
	const clearMapStack = useEditorStore((state) => state.clearMapStack)
	const dismissedPrivateDatasetIdsByAccountRef = useRef(new Map<string, Set<string>>())
	const dismissedPrivateDatasetIds = useCallback(() => {
		const accountKey = privateWorkspaceAccount?.pubkey ?? 'signed-out'
		let ids = dismissedPrivateDatasetIdsByAccountRef.current.get(accountKey)
		if (!ids) {
			ids = new Set<string>()
			dismissedPrivateDatasetIdsByAccountRef.current.set(accountKey, ids)
		}
		return ids
	}, [privateWorkspaceAccount?.pubkey])
	const dismissedFieldDatasetIdsRef = useRef(new Set<string>())
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const hydrateEditorSessionForPubkey = useEditorStore(
		(state) => state.hydrateEditorSessionForPubkey,
	)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setShowTips = useEditorStore((state) => state.setShowTips)
	// Unified mobile panel state
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelSnap = useEditorStore((state) => state.setMobilePanelSnap)
	const mobileSidebarOpen = useEditorStore((state) => state.mobileSidebarOpen)
	const openMobileSidebar = useEditorStore((state) => state.openMobileSidebar)
	const selectMobileSidebarDestination = useEditorStore(
		(state) => state.selectMobileSidebarDestination,
	)
	const closeMobileSidebar = useEditorStore((state) => state.closeMobileSidebar)
	const setMobileSearchOpen = useEditorStore((state) => state.setMobileSearchOpen)
	// Mobile Tools/Search/Actions toggles are no longer used — the responsive
	// toolbar replaces them. Store fields stay for backward compat.
	const panLocked = useEditorStore((state) => state.panLocked)
	const setPanLocked = useEditorStore((state) => state.setPanLocked)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const currentMode = useEditorStore((state) => state.mode)
	const isDrawingMode = isDrawingEditorMode(currentMode)
	const lastMobileDrawGuideRef = useRef<EditorMode | null>(null)
	const mapSource = useEditorStore((state) => state.mapSource)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const mapSourceKey = useMemo(() => {
		const file = mapSource.file
		return [
			mapSource.type,
			mapSource.location,
			mapSource.url ?? '',
			mapSource.blossomServer ?? '',
			file ? `${file.name}:${file.size}:${file.lastModified}` : '',
		].join('|')
	}, [mapSource.type, mapSource.location, mapSource.url, mapSource.blossomServer, mapSource.file])

	// External data
	const { events: geoEvents } = useGeoDatasets()
	const fieldSessions = useFieldSessions()
	const fieldSession = useMemo(
		() => fieldSessions.find((session) => session.id === fieldSessionId),
		[fieldSessionId, fieldSessions],
	)
	const datasetPublishMode = privateGroupId ? 'private' : fieldSessionId ? 'field' : 'public'
	const fieldTransport = useFieldSessionTransport(fieldSession)
	const fieldGeoEvents = useMemo(
		() =>
			fieldSessionId
				? latestFieldSessionDatasetEvents(fieldTransport.events, fieldSessionId).map((event) =>
						castEvent(event, GeoDataset, eventStore),
					)
				: [],
		[fieldSessionId, fieldTransport.events],
	)
	const privateWorkspace = useMemo(
		() =>
			privateGroupId
				? privateWorkspaceSnapshot.workspaces.find(
						(workspace) => workspace.workspaceId === privateGroupId,
					)
				: undefined,
		[privateGroupId, privateWorkspaceSnapshot.workspaces],
	)
	const privateWorkspaceId = privateWorkspace?.workspaceId
	const privateGeoEvents = useMemo(
		() => (privateWorkspace ? projectPrivateWorkspaceDatasets(privateWorkspace) : []),
		[privateWorkspace],
	)
	const mapGeoEvents = useMemo(
		() => [...geoEvents, ...privateGeoEvents, ...fieldGeoEvents],
		[geoEvents, privateGeoEvents, fieldGeoEvents],
	)
	useEffect(() => {
		if (!privateWorkspaceRuntime || !privateGroupId || !privateWorkspaceId) return
		return privateWorkspaceRuntime.watchWorkspace(privateGroupId)
	}, [privateWorkspaceRuntime, privateGroupId, privateWorkspaceId])
	const { events: mapContextEvents } = useMapContexts()
	// Groups (kind 37518, slimmed) the contributor can `c`-attach to (GROUP-02).
	const { events: groups } = useGroups()
	// Stories (kind 37520) — used to resolve a /stories/story/:naddr deep link to the
	// Article cast so the focus-route effect can open it (Phase 10, D-04).
	const { events: stories } = useStories()
	// Temporal Sightings (kind 37522) — rendered as observation-state markers on the
	// browse map (D-05/D-06) and listed in the Sightings rail (D-07). useSightings
	// already drops expired at the subscription (SIGHT-03 / Pitfall P-1).
	const { events: sightings } = useSightings()
	// Keep the live sighting list in a ref so the map-marker click handler
	// (useMapInteractions) can resolve a clicked dot back to its cast without
	// re-binding the handler on every subscription tick.
	const sightingsRef = useRef<TemporalSighting[]>([])
	useEffect(() => {
		sightingsRef.current = sightings
	}, [sightings])

	// Live Beacons (kind 37521) — rendered as live/stale/ended markers on the browse
	// map and listed in the Beacons rail (Phase 12, D-12). useBeacons drops expired
	// at the subscription on a 15s tick (BEACON-03 / Pitfall P-1) and filters the
	// `#t:['live']` discovery surface (link-only beacons never match — P-6).
	const { events: beacons } = useBeacons()
	const beaconsRef = useRef<LiveBeacon[]>([])
	useEffect(() => {
		beaconsRef.current = beacons
	}, [beacons])
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)
	// "Zoom to on map" for a Sighting: fly the camera to its geometry and focus it.
	// Sightings always render (D-05), so this centers + highlights rather than
	// toggling map-stack membership the way datasets do.
	const handleZoomToSighting = useCallback(
		(sighting: TemporalSighting) => {
			// Derive the zoom target from the precise content geometry — the SAME
			// source the marker uses (pointOnFeature(content.geometry)) — so the camera
			// lands ON the dot. Fall back to the bbox tag only when geometry is absent.
			const geometry = sighting.sighting.geometry
			const bbox = (geometry ? bboxFromGeometry(geometry) : null) ?? sighting.boundingBox
			if (!bbox) return
			handleZoomToBounds(bbox)
			setFocusedMapGeometry({ bbox })
		},
		[handleZoomToBounds, setFocusedMapGeometry],
	)
	// "Watch on map" for a beacon: fly the camera to its geometry and focus it
	// (mirrors handleZoomToSighting).
	const handleZoomToBeacon = useCallback(
		(beacon: LiveBeacon) => {
			const geometry = beacon.geometry
			const bbox = (geometry ? bboxFromGeometry(geometry) : null) ?? beacon.boundingBox
			if (!bbox) return
			handleZoomToBounds(bbox)
			setFocusedMapGeometry({ bbox })
		},
		[handleZoomToBounds, setFocusedMapGeometry],
	)
	// Round C.2 reliability: also fire a targeted subscription for every
	// context entry on the stack. The global subscription above is best-effort
	// — if a read relay was slow or 502 at open time, foreign attachments
	// (datasets with `["c", "37518:…:dTag"]` pointing at the context) might
	// never have streamed in. This explicit `#c` filter guarantees they're
	// fetched whenever a context lands on the stack, and applesauce's shared
	// EventStore deduplicates them straight into the same `geoEvents` array.
	const stackedContextCoordinates = useMemo(() => {
		const coords: string[] = []
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (entry?.entityType === 'context') coords.push(entry.entityKey)
		}
		return coords
	}, [mapStackEntries, mapStackOrder])
	useGeoDatasets(
		stackedContextCoordinates.length > 0 ? [{ '#c': stackedContextCoordinates }] : null,
	)
	const currentUser = useActiveAccount()
	const currentUserPubkey = currentUser?.pubkey ?? null
	const isMobile = useIsMobile()
	const mapPopupToolbarOffset = 112

	useEffect(() => {
		if (!isMobile || !isDrawingMode) {
			lastMobileDrawGuideRef.current = null
			return
		}
		if (panLocked || lastMobileDrawGuideRef.current === currentMode) return

		lastMobileDrawGuideRef.current = currentMode
		const description = getMobileDrawingGuidance(currentMode)
		if (!description) return
		toast.info('Lock panning to draw', {
			id: 'mobile-pan-lock-guide',
			description,
			duration: 7_000,
		})
	}, [currentMode, isDrawingMode, isMobile, panLocked])

	// A native pairing URL is navigation, not an alternate trust path: reveal the
	// existing Offline settings surface, where the normal decoder and approval
	// flow consume it. Keep the pending value until that surface has mounted.
	useEffect(() => {
		const openPairingInvitation = (url: string) => {
			if (!normalizePairingInvitation(url)) {
				consumePendingNativeDeepLink(url)
				return
			}
			setSettingsTab('offline')
			navigateToView('settings')
			if (isMobile) selectMobileSidebarDestination('settings')
		}
		const pending = getPendingNativeDeepLink()
		if (pending) openPairingInvitation(pending)
		const onNativeLink = (event: Event) => {
			openPairingInvitation((event as CustomEvent<NativeDeepLinkDetail>).detail.url)
		}
		window.addEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
		return () => window.removeEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
	}, [isMobile, navigateToView, selectMobileSidebarDestination, setSettingsTab])

	const clearAnnotationPopupHideTimeout = useCallback(() => {
		if (annotationPopupHideTimeoutRef.current !== null) {
			window.clearTimeout(annotationPopupHideTimeoutRef.current)
			annotationPopupHideTimeoutRef.current = null
		}
	}, [])

	const scheduleAnnotationPopupHide = useCallback(() => {
		clearAnnotationPopupHideTimeout()
		annotationPopupHideTimeoutRef.current = window.setTimeout(() => {
			if (annotationPopupHoverRef.current) return
			setDisplayedAnnotationPopupData(null)
			annotationPopupHideTimeoutRef.current = null
		}, 1200)
	}, [clearAnnotationPopupHideTimeout])

	useEffect(() => {
		if (!mapPopupsEnabled) {
			clearAnnotationPopupHideTimeout()
			setAnnotationPopupData(null)
			setDisplayedAnnotationPopupData(null)
		}
	}, [clearAnnotationPopupHideTimeout, mapPopupsEnabled, setAnnotationPopupData])

	useEffect(() => {
		if (!mapPopupsEnabled) return
		if (annotationPopupData) {
			clearAnnotationPopupHideTimeout()
			setDisplayedAnnotationPopupData(annotationPopupData)
			return
		}
		if (
			mapPopupPlacement === 'dock' &&
			displayedAnnotationPopupData &&
			!displayedAnnotationPopupData.pinned
		) {
			scheduleAnnotationPopupHide()
			return
		}
		setDisplayedAnnotationPopupData(null)
	}, [
		annotationPopupData,
		clearAnnotationPopupHideTimeout,
		displayedAnnotationPopupData,
		mapPopupPlacement,
		mapPopupsEnabled,
		scheduleAnnotationPopupHide,
	])

	useEffect(() => {
		return () => clearAnnotationPopupHideTimeout()
	}, [clearAnnotationPopupHideTimeout])

	const handleAnnotationPopupHoverChange = useCallback(
		(hovered: boolean) => {
			annotationPopupHoverRef.current = hovered
			if (hovered) {
				clearAnnotationPopupHideTimeout()
				return
			}
			if (
				!annotationPopupData &&
				mapPopupPlacement === 'dock' &&
				displayedAnnotationPopupData &&
				!displayedAnnotationPopupData.pinned
			) {
				scheduleAnnotationPopupHide()
			}
		},
		[
			annotationPopupData,
			clearAnnotationPopupHideTimeout,
			displayedAnnotationPopupData,
			mapPopupPlacement,
			scheduleAnnotationPopupHide,
		],
	)

	const handleCloseAnnotationPopup = useCallback(() => {
		clearAnnotationPopupHideTimeout()
		setAnnotationPopupData(null)
		setDisplayedAnnotationPopupData(null)
	}, [clearAnnotationPopupHideTimeout, setAnnotationPopupData])

	useEffect(() => {
		hydrateEditorSessionForPubkey(currentUserPubkey)
	}, [currentUserPubkey, hydrateEditorSessionForPubkey])

	// Round G.2: catalog favorites/recents are scoped per pubkey too.
	const hydrateCatalogPrefsForPubkey = useEditorStore((state) => state.hydrateCatalogPrefsForPubkey)
	useEffect(() => {
		hydrateCatalogPrefsForPubkey(currentUserPubkey)
	}, [currentUserPubkey, hydrateCatalogPrefsForPubkey])

	// Callback for ensuring info panel is visible
	const openMobilePanel = useEditorStore((state) => state.openMobilePanel)
	const ensureInfoPanelVisible = useCallback(() => {
		if (isMobile) {
			openMobilePanel('edit')
		} else {
			setShowInfoPanel(true)
		}
	}, [isMobile, openMobilePanel, setShowInfoPanel])

	// Mobile §14a: selecting a feature raises the sheet to Half; deselecting drops
	// it back to Peek. The editor lives in the Map Stack (editor-in-Map-Stack), so
	// we surface that panel. Only fire on the empty↔selected transition so a manual
	// drag between selections is respected.
	const prevSelectionCountRef = useRef(0)
	useEffect(() => {
		if (!isMobile) {
			prevSelectionCountRef.current = selectionCount
			return
		}
		const prev = prevSelectionCountRef.current
		prevSelectionCountRef.current = selectionCount
		if (prev === 0 && selectionCount > 0) {
			openMobilePanel('map-stack')
			setMobilePanelSnap('half')
		} else if (prev > 0 && selectionCount === 0) {
			setMobilePanelSnap('peek')
		}
	}, [isMobile, selectionCount, openMobilePanel, setMobilePanelSnap])

	// Keep camera moves and MapLibre attribution above the exact live sheet
	// height. The old percentage approximation disagreed with the fixed peek
	// detent and let the sheet cover both geometry and attribution.
	useEffect(() => {
		const mapInstance = map.current
		const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
		const rawBottom =
			isMobile && mobilePanelOpen ? Math.round(mobilePanelHeightPx(mobilePanelSnap)) : 0
		mapContainerRef.current?.style.setProperty('--mobile-sheet-height', `${rawBottom}px`)
		if (!mapInstance || !mounted) return
		// Never pad away the whole map — keep a usable strip so MapLibre always has
		// a positive padded viewport to center within.
		const bottom = Math.max(0, Math.min(rawBottom, viewportHeight - 80))
		mapInstance.easeTo({ padding: { top: 0, right: 0, bottom, left: 0 }, duration: 200 })
		return () => {
			mapContainerRef.current?.style.setProperty('--mobile-sheet-height', '0px')
		}
	}, [isMobile, mobilePanelOpen, mobilePanelSnap, mounted])

	// Custom hooks
	const {
		geoEventsRef,
		isMountedRef,
		getDatasetKey,
		getDatasetName,
		resolvedCollectionResolver,
		ensureResolvedFeatureCollection,
		zoomToDataset,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		switchToWorkspace,
		deleteWorkspace,
		createDraftInWorkspace,
		tearDownEditSession,
		startNewDataset,
	} = useDatasetManagement(map, mapGeoEvents)

	// Plan 13-06 (UAT test 5b — kill the add-to-stack phantom): a per-entry
	// RESOLVED-ENTITY cache. `addBeaconToMapStack`/`addSightingToMapStack` deposit the
	// actual resolved LiveBeacon/TemporalSighting at ADD TIME, keyed by the SAME
	// entityKey the entry is pinned under. This keeps an explicitly-added
	// out-of-discovery entity (own / link-only / faded-from-live) resolvable by BOTH
	// the render gate and the expiry-sweep WITHOUT tagging it into `#t:['live']`
	// discovery — so the individual pin renders while the aggregate layer stays
	// discovery-only (T-13-06-01 / T-13-03-GPSREGRESS privacy invariant). `addedCacheTick`
	// bumps on every deposit/prune so the selector memos re-derive against the fresh
	// cache (refs alone don't trigger a re-render).
	const addedBeaconCacheRef = useRef<Map<string, LiveBeacon>>(new Map())
	const addedSightingCacheRef = useRef<Map<string, TemporalSighting>>(new Map())
	const [addedCacheTick, setAddedCacheTick] = useState(0)

	const addDatasetToMapStack = useCallback(
		(event: GeoDataset, source: 'manual' | 'route' | 'browse-default' = 'manual') => {
			const datasetKey = getDatasetKey(event)
			addMapStackEntry({
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source,
				visible: true,
				pinned: false,
			})
			if (source === 'manual') {
				toast.success(`Added "${getDatasetName(event)}" to the map.`)
			}
		},
		[addMapStackEntry, getDatasetKey, getDatasetName],
	)

	const addPrivateDatasetToMapStack = useCallback(
		(event: GeoDataset) => {
			const workspaceId = privateWorkspaceIdForDataset(event) ?? privateGroupId
			if (!workspaceId) return
			const datasetKey = getDatasetKey(event)
			const id = privateDatasetStackEntryId(workspaceId, datasetKey)
			dismissedPrivateDatasetIds().delete(id)
			const existing = useEditorStore.getState().mapStackEntries[id]
			addMapStackEntry({
				id,
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source: 'private-group',
				visible: existing?.visible ?? true,
				pinned: existing?.pinned ?? false,
				isolated: existing?.isolated,
				exclusions: existing?.exclusions,
			})
		},
		[privateGroupId, getDatasetKey, getDatasetName, addMapStackEntry, dismissedPrivateDatasetIds],
	)

	// A private-group route is an encrypted map scope. New decrypted datasets are
	// added once, while existing Map Stack state remains user-owned. Explicitly
	// removed entries stay dismissed until the Geometry tab adds them again.
	useEffect(() => {
		const stack = useEditorStore.getState()
		const plan = planPrivateDatasetStackReconciliation({
			workspaceId: privateGroupId,
			datasets: privateGeoEvents.map((dataset) => ({
				datasetKey: getDatasetKey(dataset),
				title: getDatasetName(dataset),
			})),
			entries: stack.mapStackEntries,
			order: stack.mapStackOrder,
			dismissedIds: dismissedPrivateDatasetIds(),
		})

		for (const id of plan.remove) removeMapStackEntry(id)
		for (const item of plan.upsert) {
			addMapStackEntry({
				id: item.id,
				entityType: 'dataset',
				entityKey: item.datasetKey,
				title: item.title,
				source: 'private-group',
				visible: item.existing?.visible ?? true,
				pinned: item.existing?.pinned ?? false,
				isolated: item.existing?.isolated,
				exclusions: item.existing?.exclusions,
			})
		}
	}, [
		privateGroupId,
		privateGeoEvents,
		getDatasetKey,
		getDatasetName,
		addMapStackEntry,
		removeMapStackEntry,
		dismissedPrivateDatasetIds,
	])

	const addFieldDatasetToMapStack = useCallback(
		(event: GeoDataset) => {
			if (!fieldSessionId) return
			const datasetKey = getDatasetKey(event)
			const id = fieldDatasetStackEntryId(fieldSessionId, datasetKey)
			dismissedFieldDatasetIdsRef.current.delete(id)
			const existing = useEditorStore.getState().mapStackEntries[id]
			addMapStackEntry({
				id,
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source: 'field-session',
				visible: existing?.visible ?? true,
				pinned: existing?.pinned ?? false,
				isolated: existing?.isolated,
				exclusions: existing?.exclusions,
			})
		},
		[fieldSessionId, getDatasetKey, getDatasetName, addMapStackEntry],
	)

	// Nearby datasets follow the same non-resurrection contract as private
	// geometry: new records appear once, while an explicit Map Stack removal is
	// remembered until the user adds the dataset again from the Field session.
	useEffect(() => {
		const stack = useEditorStore.getState()
		const plan = planFieldDatasetStackReconciliation({
			sessionId: fieldSessionId,
			datasets: fieldGeoEvents.map((dataset) => ({
				datasetKey: getDatasetKey(dataset),
				title: getDatasetName(dataset),
			})),
			entries: stack.mapStackEntries,
			order: stack.mapStackOrder,
			dismissedIds: dismissedFieldDatasetIdsRef.current,
		})

		for (const id of plan.remove) removeMapStackEntry(id)
		for (const item of plan.upsert) {
			addMapStackEntry({
				id: item.id,
				entityType: 'dataset',
				entityKey: item.datasetKey,
				title: item.title,
				source: 'field-session',
				visible: item.existing?.visible ?? true,
				pinned: item.existing?.pinned ?? false,
				isolated: item.existing?.isolated,
				exclusions: item.existing?.exclusions,
			})
		}
	}, [
		fieldSessionId,
		fieldGeoEvents,
		getDatasetKey,
		getDatasetName,
		addMapStackEntry,
		removeMapStackEntry,
	])

	// Phase 13 (SPEC §3.4): put an individual Sighting on the Map Stack, mirroring
	// addDatasetToMapStack. entityKey = naddr (dTag/id fallback) — the SAME key the
	// stack-derived selector resolves under. A deep link (`source: 'route'`) lands
	// SOLO: `isolated: true` triggers the existing global mutual-exclusion rule in
	// mapStackSlice, suppressing every other entry (T-13-03-FORCEISO — the key comes
	// from the resolved entity, never a raw URL field, so a route can only isolate
	// exactly the entity its naddr resolved to).
	const addSightingToMapStack = useCallback(
		(sighting: TemporalSighting, source: 'manual' | 'route' | 'browse-default' = 'manual') => {
			// Toast-honesty (13-06 Task 2): only proceed if the sighting resolves to a
			// real, keyable entity. `sighting` is already the resolved object the panel
			// is displaying, so resolution "succeeds" when it has a stable entityKey.
			const entityKey = getSightingMapStackKey(sighting)
			if (!entityKey) {
				if (source === 'manual') toast.error("Couldn't add this sighting to the map.")
				return
			}
			// Deposit the resolved entity BEFORE adding the entry so the render gate +
			// sweep can resolve an out-of-subscription sighting from the cache.
			addedSightingCacheRef.current.set(entityKey, sighting)
			setAddedCacheTick((t) => t + 1)
			addMapStackEntry({
				entityType: 'sighting',
				entityKey,
				title: sighting.sighting.title?.trim() || 'Sighting',
				source,
				visible: true,
				pinned: false,
				isolated: source === 'route',
			})
			if (source === 'manual') {
				toast.success('Added sighting to the map.')
			}
		},
		[addMapStackEntry],
	)

	// Phase 13 (SPEC §3.4): put an individual Live Beacon on the Map Stack. Same
	// shape as addSightingToMapStack; deep-link lands SOLO (isolated 'route').
	const addBeaconToMapStack = useCallback(
		(beacon: LiveBeacon, source: 'manual' | 'route' | 'browse-default' | 'own' = 'manual') => {
			// Toast-honesty (13-06 Task 2): only fire success when the beacon resolves to
			// a real, keyable entity. An out-of-discovery beacon (own / link-only / faded
			// from live) IS resolvable — it is the object the inspect panel is showing —
			// so caching it under its entityKey lets the individual pin render without
			// forcing it into discovery.
			const entityKey = getBeaconMapStackKey(beacon)
			if (!entityKey) {
				if (source === 'manual') toast.error("Couldn't add this beacon to the map.")
				return
			}
			addedBeaconCacheRef.current.set(entityKey, beacon)
			setAddedCacheTick((t) => t + 1)
			addMapStackEntry({
				entityType: 'beacon',
				entityKey,
				title: beacon.beacon.label?.trim() || 'Live location',
				source,
				visible: true,
				pinned: false,
				isolated: source === 'route',
			})
			if (source === 'manual') {
				toast.success('Added beacon to the map.')
			}
		},
		[addMapStackEntry],
	)

	const setMapStackVisibility = useCallback(
		(entry: MapStackEntry, visible: boolean) => {
			setMapStackEntryVisible(entry.id, visible)
		},
		[setMapStackEntryVisible],
	)

	const setMapStackIsolation = useCallback(
		(entry: MapStackEntry, isolated: boolean) => {
			setMapStackEntryIsolated(entry.id, isolated)
			if (isolated && entry.entityType === 'dataset') {
				// Make sure the isolated dataset is visible so the user actually sees it.
				setMapStackEntryVisible(entry.id, true)
			}
		},
		[setMapStackEntryIsolated, setMapStackEntryVisible],
	)

	const removeFromMapStack = useCallback(
		(entry: MapStackEntry) => {
			// Phase 1.1: removing the draft entry equals "stop editing." A single
			// tearDownEditSession() clears the editor AND removes `draft:active`
			// AND resets stance/viewMode — the unified teardown that fixes the
			// stop-editing desync (report 3.6).
			if (entry.entityType === 'draft') {
				tearDownEditSession()
				return
			}
			if (entry.source === 'private-group') {
				dismissedPrivateDatasetIds().add(entry.id)
			}
			if (entry.source === 'field-session') {
				dismissedFieldDatasetIdsRef.current.add(entry.id)
			}
			removeMapStackEntry(entry.id)
		},
		[removeMapStackEntry, tearDownEditSession, dismissedPrivateDatasetIds],
	)

	const removePrivateDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			const workspaceId = privateWorkspaceIdForDataset(event) ?? privateGroupId
			if (!workspaceId) return
			const id = privateDatasetStackEntryId(workspaceId, getDatasetKey(event))
			const entry = useEditorStore.getState().mapStackEntries[id]
			if (entry) removeFromMapStack(entry)
		},
		[privateGroupId, getDatasetKey, removeFromMapStack],
	)

	const removeFieldDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			if (!fieldSessionId) return
			const id = fieldDatasetStackEntryId(fieldSessionId, getDatasetKey(event))
			const entry = useEditorStore.getState().mapStackEntries[id]
			if (entry) removeFromMapStack(entry)
		},
		[fieldSessionId, getDatasetKey, removeFromMapStack],
	)

	/**
	 * Round C: catalog rows toggle stack membership. This thin wrapper finds the
	 * stack entry for a given dataset and removes it (no-op if not present).
	 */
	const removeDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			const datasetKey = getDatasetKey(event)
			for (const entryId of mapStackOrder) {
				const entry = mapStackEntries[entryId]
				if (entry?.entityType === 'dataset' && entry.entityKey === datasetKey) {
					removeFromMapStack(entry)
					return
				}
			}
		},
		[getDatasetKey, mapStackOrder, mapStackEntries, removeFromMapStack],
	)

	const clearMapStackAndVisibility = useCallback(() => {
		const stack = useEditorStore.getState()
		for (const id of stack.mapStackOrder) {
			if (stack.mapStackEntries[id]?.source === 'private-group') {
				dismissedPrivateDatasetIds().add(id)
			}
		}
		clearMapStack()
	}, [clearMapStack, dismissedPrivateDatasetIds])

	const stance = useEditorStore((state) => state.stance)

	// Entering the author stance (a geometry draft) surfaces the Map Stack panel —
	// the draft entry there hosts the editor forms (editor-in-Map-Stack). Mobile
	// opens the sheet on the map-stack tab at Half; desktop opens the floating
	// Map Stack panel. The desktop half fixes the "edit UI nowhere / draft not in
	// the Map Stack" report: with the panel closed, `draftEditorSlot` stays null,
	// so a freshly started edit session (AI draw in a fresh chat, or a catalog
	// "Load into editor") had no visible draft entry and its editor either fell
	// back into the sidebar or rendered nowhere. Fires once per browse/focus →
	// author transition so the user can still close the panel or navigate away
	// while drafting.
	const prevStanceRef = useRef(stance)
	useEffect(() => {
		const wasAuthor = prevStanceRef.current === 'author'
		prevStanceRef.current = stance
		if (stance !== 'author' || wasAuthor) return
		if (isMobile) {
			openMobilePanel('map-stack')
			setMobilePanelSnap('half')
			return
		}
		setMapStackOpen(true)
	}, [isMobile, stance, openMobilePanel, setMobilePanelSnap, setMapStackOpen])

	// Round C.5: stack ⇄ URL serialization. Read URL params on mount once data
	// is loaded; afterwards push stack mutations back to the URL (debounced via
	// rAF). The URL is the canonical shareable representation of a map view.
	// The state mirror exists so the landing prompt's show-condition can wait
	// for hydration without flashing before URL entries land.
	//
	// Phase 1.2 (fixes 7.2/7.3): a cold load with no `?ms=` has nothing to
	// reconstruct, so it is "hydrated" immediately. This matters because the
	// write-back effect below bails while unhydrated — if we waited for the
	// events-gated hydration effect to flip the flag, the landing seed could
	// mutate the stack first and its `?ms=` would never be written. Only an
	// `?ms=`-bearing URL starts unhydrated and waits for events to resolve.
	const stackUrlHydratedRef = useRef(!new URLSearchParams(window.location.search).has('ms'))
	const [stackUrlHydrated, setStackUrlHydrated] = useState(
		() => !new URLSearchParams(window.location.search).has('ms'),
	)
	useEffect(() => {
		if (stackUrlHydratedRef.current) return
		if (geoEvents.length === 0 && mapContextEvents.length === 0) return
		const params = new URLSearchParams(window.location.search)
		const msParam = params.get('ms')
		const isoParam = params.get('iso')
		if (!msParam) {
			stackUrlHydratedRef.current = true
			setStackUrlHydrated(true)
			return
		}
		const tokens = msParam
			.split(',')
			.map((token) => token.trim())
			.filter(Boolean)
		const datasetByKey = new Map<string, GeoDataset>()
		for (const event of geoEvents) datasetByKey.set(getDatasetKey(event), event)
		const contextByKey = new Map<string, MapContext>()
		for (const ctx of mapContextEvents) {
			const key = ctx.contextCoordinate ?? ctx.id ?? ctx.contextId ?? ctx.dTag
			if (key) contextByKey.set(key, ctx)
		}
		for (const token of tokens) {
			const sep = token.indexOf(':')
			if (sep <= 0) continue
			const entityType = token.slice(0, sep)
			const entityKey = token.slice(sep + 1)
			if (!entityKey) continue
			if (entityType === 'dataset') {
				const event = datasetByKey.get(entityKey)
				if (!event) continue
				addDatasetToMapStack(event, 'route')
			} else if (entityType === 'context') {
				const ctx = contextByKey.get(entityKey)
				if (!ctx) continue
				const title = ctx.context?.name || `Context ${entityKey.slice(0, 12)}`
				addMapStackEntry({
					entityType: 'context',
					entityKey,
					title,
					source: 'route',
					visible: true,
					pinned: false,
				})
			}
		}
		if (isoParam) {
			const sep = isoParam.indexOf(':')
			if (sep > 0) {
				const isoType = isoParam.slice(0, sep)
				const isoKey = isoParam.slice(sep + 1)
				const isoId = `${isoType}:${isoKey}`
				setMapStackEntryIsolated(isoId, true)
			}
		}
		// D.2: hydrate per-context exclusions. Format per `ex` param:
		// `<contextCoord>|<datasetKey1>;<datasetKey2>;…`. Multiple `ex`
		// params allowed (one per context with exclusions).
		const exParams = params.getAll('ex')
		for (const exParam of exParams) {
			const pipeIdx = exParam.indexOf('|')
			if (pipeIdx <= 0) continue
			const contextCoord = exParam.slice(0, pipeIdx)
			const exclusionKeys = exParam
				.slice(pipeIdx + 1)
				.split(';')
				.map((k) => k.trim())
				.filter(Boolean)
			if (exclusionKeys.length === 0) continue
			setMapStackEntryExclusions(`context:${contextCoord}`, exclusionKeys)
		}
		stackUrlHydratedRef.current = true
		setStackUrlHydrated(true)
	}, [
		geoEvents,
		mapContextEvents,
		getDatasetKey,
		addDatasetToMapStack,
		addMapStackEntry,
		setMapStackEntryIsolated,
		setMapStackEntryExclusions,
	])
	// Push stack mutations back to the URL (debounced via rAF) once we've
	// finished initial hydration. Drafts are stripped — they're session state,
	// not shareable.
	useEffect(() => {
		if (!stackUrlHydratedRef.current) return
		let cancelled = false
		const handle = window.requestAnimationFrame(() => {
			if (cancelled) return
			const params = new URLSearchParams(window.location.search)
			const shareableEntries = mapStackOrder
				.map((id) => mapStackEntries[id])
				.filter((entry): entry is MapStackEntry => Boolean(entry))
				.filter((entry) => entry.entityType !== 'draft' && entry.source !== 'private-group')
			const tokens = shareableEntries.map((entry) => `${entry.entityType}:${entry.entityKey}`)
			if (tokens.length > 0) {
				params.set('ms', tokens.join(','))
			} else {
				params.delete('ms')
			}
			const isolated = shareableEntries.find((entry) => entry.isolated)
			if (isolated) {
				params.set('iso', `${isolated.entityType}:${isolated.entityKey}`)
			} else {
				params.delete('iso')
			}
			// D.2: serialize per-context exclusions. One `ex` param per context
			// that has at least one excluded curated dataset.
			params.delete('ex')
			for (const entry of shareableEntries) {
				if (entry.entityType !== 'context') continue
				const exclusions = entry.exclusions ?? []
				if (exclusions.length === 0) continue
				params.append('ex', `${entry.entityKey}|${exclusions.join(';')}`)
			}
			const next = params.toString()
			const nextSearch = next ? `?${next}` : ''
			if (nextSearch === window.location.search) return
			// Round I: routing now lives in the pathname (no hash). Preserve the
			// pathname while updating the map-stack query params.
			window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`)
		})
		return () => {
			cancelled = true
			window.cancelAnimationFrame(handle)
		}
	}, [mapStackEntries, mapStackOrder])
	// Round E.2: the former auto-seed, now triggered by the landing prompt's
	// "Show recent datasets" button — the 5 most recent datasets by created_at.
	// Phase 13 (SPEC §3.3, D-05) + landing default: cold-start auto-adds BOTH
	// aggregate layer entries — 'All sightings' + 'Live beacons' — so the user
	// NEVER lands on an empty map (this replaced the 'Your map is empty'
	// BrowseLandingPrompt; mobile and desktop alike). Entries are removable/
	// toggleable Map Stack rows (source 'browse-default', entityKey 'all',
	// visible). Seeded exactly once per session on the first cold-start (no
	// `?ms=` URL), guarded by a ref so it never re-seeds after the user Clears
	// them (browse-default entries clear normally per clearMapStack) or removes
	// them. A `?ms=`-bearing deep link hydrates its own stack and is NOT seeded
	// (its membership is the shared view; the observer should see exactly what
	// was shared). Author stance is exempt — a restored draft shouldn't get
	// layers pushed under it mid-edit.
	const aggregateLayersSeededRef = useRef(false)
	useEffect(() => {
		if (aggregateLayersSeededRef.current) return
		if (stance === 'author' || !stackUrlHydrated) return
		// Only seed on a genuine cold-start (no shared `?ms=` stack to reconstruct).
		if (new URLSearchParams(window.location.search).has('ms')) {
			aggregateLayersSeededRef.current = true
			return
		}
		aggregateLayersSeededRef.current = true
		// Idempotent: addMapStackEntry keys by `${entityType}:${entityKey}` so a
		// second call with entityKey 'all' is a no-op merge, never a duplicate row.
		const hasSightingLayer = mapStackOrder.some(
			(id) => mapStackEntries[id]?.entityType === 'sighting-layer',
		)
		const hasBeaconLayer = mapStackOrder.some(
			(id) => mapStackEntries[id]?.entityType === 'beacon-layer',
		)
		if (!hasSightingLayer) {
			addMapStackEntry({
				entityType: 'sighting-layer',
				entityKey: 'all',
				title: 'All sightings',
				source: 'browse-default',
				visible: true,
				pinned: false,
			})
		}
		if (!hasBeaconLayer) {
			addMapStackEntry({
				entityType: 'beacon-layer',
				entityKey: 'all',
				title: 'Live beacons',
				source: 'browse-default',
				visible: true,
				pinned: false,
			})
		}
	}, [stance, stackUrlHydrated, mapStackEntries, mapStackOrder, addMapStackEntry])

	// Store state for viewMode
	const viewMode = useEditorStore((state) => state.viewMode)

	// Consolidate a viewed Story's inline geo-refs with the map stack: fetch the
	// referenced datasets on demand, auto-stack them visible so the article's
	// geometry shows on open, and expose the map-stack-derived eye state for the
	// inline ref toggles (single source of truth).
	const viewStory = useEditorStore((state) => state.viewStory)
	const { isMentionVisible } = useStoryMapRefs(viewStory)

	// Blossom upload dialog state
	const blossomUploadDialogOpen = useEditorStore((state) => state.blossomUploadDialogOpen)
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const pendingPublishCollection = useEditorStore((state) => state.pendingPublishCollection)

	const publishPrivateDataset = useCallback(
		async (
			collection: import('geojson').FeatureCollection,
			options?: { datasetId?: string; name?: string },
		) => {
			if (!privateWorkspaceRuntime || !privateGroupId) {
				throw new Error('The private group is not available in this browser profile')
			}
			const envelope = await privateWorkspaceRuntime.perform((service) =>
				service.sendDataset(privateGroupId, collection, options),
			)
			const workspace = privateWorkspaceRuntime
				.getSnapshot()
				.workspaces.find((item) => item.workspaceId === privateGroupId)
			const dataset = workspace
				? projectPrivateWorkspaceDatasets(workspace).find((item) => item.event.id === envelope.id)
				: undefined
			if (!dataset) throw new Error('The encrypted dataset could not be opened after saving')
			return dataset
		},
		[privateWorkspaceRuntime, privateGroupId],
	)
	const publishFieldDataset = useCallback(
		async (
			collection: FeatureCollection,
			options?: { datasetId?: string; name?: string; previous?: GeoDataset },
		) => {
			if (!fieldSession || !fieldSessionId) {
				throw new Error('The Field session is not available on this device')
			}
			if (fieldSession.role === 'participant' && !fieldSession.allowPeerWrites) {
				throw new Error('This Field session is read-only on participant phones')
			}
			const signer = accounts.signer
			if (!signer) throw new Error('Sign in before saving nearby geometry')

			let factory = fieldSessionDatasetFactory(collection, fieldSessionId, options?.previous)
			if (options?.datasetId && !options.previous) {
				factory = factory.modifyPublicTags((tags) => [
					...tags.filter((tag) => tag[0] !== 'd'),
					['d', options.datasetId as string],
				])
			}
			const signed = (await factory.sign(signer)) as NostrEvent
			if (fieldSessionIdForEvent(signed) !== fieldSessionId) {
				throw new Error('The nearby dataset lost its Field-session scope before signing')
			}
			await fieldTransport.publishEvent(signed)
			return castEvent(signed, GeoDataset, eventStore)
		},
		[fieldSession, fieldSessionId, fieldTransport.publishEvent],
	)
	const navigateToEntityFocus = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext',
			naddr: string,
			sidebarView?: 'datasets' | 'contexts',
		) => {
			// Projected private datasets have no public naddr route. Keep inspection
			// inside /privategroup/:id so opening a map row cannot drop the MLS scope.
			if ((privateGroupId || fieldSessionId) && focusType === 'geoevent') return
			navigateTo(focusType, naddr, sidebarView)
		},
		[privateGroupId, fieldSessionId, navigateTo],
	)

	const {
		handlePublishNew,
		handlePublishUpdate,
		handlePublishCopy,
		handleProposeEdit,
		handleDeleteDataset,
		handlePublishWithBlossomUpload,
		buildCollectionFromEditor,
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
		canProposeEdit,
	} = usePublishing({
		currentUserPubkey,
		getDatasetName,
		getDatasetKey,
		groups,
		resolvedCollectionResolver,
		navigateTo,
		encodeGeoEventNaddr,
		privateWorkspaceId: privateGroupId,
		publishPrivateDataset: privateGroupId ? publishPrivateDataset : undefined,
		fieldSessionId,
		publishFieldDataset: fieldSessionId ? publishFieldDataset : undefined,
	})

	/**
	 * Callback for when a Blossom upload completes.
	 * Adds the blob reference to the store WITHOUT publishing.
	 * User must click "Publish" separately to publish the dataset.
	 */
	const handleBlobUploadComplete = useCallback(
		(result: { sha256: string; url: string; size: number }) => {
			const newRef = {
				id: crypto.randomUUID(),
				scope: 'collection' as const,
				url: result.url,
				sha256: result.sha256,
				size: result.size,
				mimeType: 'application/geo+json',
				status: 'ready' as const,
			}
			useEditorStore
				.getState()
				.setBlobReferences([...useEditorStore.getState().blobReferences, newRef])
		},
		[],
	)

	// Memoize the collection to prevent expensive recalculation on every render
	// Only compute when in edit mode to avoid unnecessary work
	const memoizedFeatureCollection = useMemo(() => {
		// Only compute when viewMode is 'edit' - this is when DatasetSizeIndicator is shown
		if (viewMode !== 'edit') return null
		return buildCollectionFromEditor()
	}, [buildCollectionFromEditor, viewMode])

	// Round H.5: the in-edit draft row in the Map Stack gets the usual row
	// actions' analogues. "Open editor panel" routes to the editor view so the
	// sidebar shows the edit state; "Zoom to edit" fits the map to the draft's
	// geometry (falling back to the active dataset's bounds when empty).
	// Edit-isolation reuses the row's Focus button (draft.isolated). Declared
	// after useRouting so `navigateToView` is in scope.
	const openDraftEditor = useCallback(() => {
		// The entity panel is multiplexed on viewDataset/viewContext — clear those
		// so it shows the editor (not whatever was being inspected), put the store
		// in edit mode, restore the author stance (the toolbar pill + rail surface
		// read stance directly — without this they'd stay on INSPECT), and route
		// to the editor view so the sidebar surfaces it.
		setViewContext(null)
		setViewDatasetState(null)
		setViewModeState('edit')
		setStance('author')
		navigateToView('edit')
	}, [navigateToView, setViewContext, setViewDatasetState, setViewModeState, setStance])

	const zoomToDraft = useCallback(async () => {
		const drawn = (features ?? []).filter((feature) => feature.geometry !== null)
		if (drawn.length === 0) {
			if (activeDataset) zoomToDataset(activeDataset)
			return
		}
		try {
			const turf = await import('@turf/turf')
			const bbox = turf.bbox({ type: 'FeatureCollection', features: drawn })
			if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(v))) {
				handleZoomToBounds(bbox as [number, number, number, number])
			}
		} catch {
			// bbox calc failed — keep the current camera.
		}
	}, [features, activeDataset, zoomToDataset, handleZoomToBounds])

	const {
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleOpenDebug,
	} = useViewMode({
		geoEvents: mapGeoEvents,
		onEnsureInfoPanelVisible: ensureInfoPanelVisible,
		onNavigateToFocus: navigateToEntityFocus,
		onClearRouteFocus: clearFocus,
		onZoomToDataset: zoomToDataset,
	})

	// Store focus state
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)

	// Round C: sidebar filter is sidebar-only (no longer affects map visibility,
	// since visibility = stack membership). Setter is kept so the sidebar can
	// still receive filter callbacks without churn; the value is intentionally
	// unused here.
	const [_filteredDatasetKeys, setFilteredDatasetKeys] = useState<Set<string> | null>(null)
	const handleFilteredDatasetKeysChange = useCallback((keys: Set<string> | null) => {
		setFilteredDatasetKeys(keys ? new Set(keys) : null)
	}, [])

	// Mobile does not always render the datasets panel immediately; avoid getting stuck with stale/empty
	// filter state from a previous desktop session.
	useEffect(() => {
		if (isMobile) {
			setFilteredDatasetKeys(null)
		}
	}, [isMobile])

	const activeContextScope = useMemo(() => {
		if (!contextNaddr) return null
		return (
			mapContextEvents.find((context) => {
				const contextRouteNaddr = encodeContextNaddr(context)
				return contextRouteNaddr === contextNaddr
			}) ?? null
		)
	}, [contextNaddr, mapContextEvents, encodeContextNaddr])

	// Round C: activeContextScopeLabel and toolbarFocusLabel were used by the
	// removed toolbar chips. The MapStackPanel surface now carries the same
	// information via per-row "Isolated" indicators + the header subtitle.
	// Keep the upstream context-scope and focus state as-is — they still
	// drive sidebar/info-panel and routing behaviour — just stop computing
	// the toolbar-specific labels.

	const focusedContext = useMemo(() => {
		if (focusedType !== 'mapcontext' || !focusedNaddr) return null
		return (
			mapContextEvents.find((context) => {
				const contextNaddr = encodeContextNaddr(context)
				return contextNaddr === focusedNaddr
			}) ?? null
		)
	}, [focusedType, focusedNaddr, mapContextEvents, encodeContextNaddr])

	// Note: `focusedDataset` was only ever read by the now-removed toolbar focus
	// label. The focus state itself still drives routing + sidebar — see
	// `focusedNaddr` / `focusedType` reads below — but the dataset resolution
	// is no longer needed in this scope.

	const explicitContext = activeContextScope ?? focusedContext
	const mapFilterContext = explicitContext
	const mapFilterContextCoordinate = useMemo(() => {
		if (activeContextScope && contextCoordinate) return contextCoordinate
		if (!mapFilterContext) return null
		return getContextCoordinate(mapFilterContext)
	}, [activeContextScope, contextCoordinate, mapFilterContext])

	const resolvedActiveContextScope = useMemo(
		() =>
			resolveContextMapScope(mapFilterContext, geoEvents, mapContextEvents, contextMapScopeMode),
		[mapFilterContext, geoEvents, mapContextEvents, contextMapScopeMode],
	)
	const activeContextDatasets = useMemo(
		() => resolvedActiveContextScope.datasets.map((entry) => entry.dataset),
		[resolvedActiveContextScope],
	)
	const mapStackStats = useMemo(() => {
		const entries = mapStackOrder
			.map((entryId) => mapStackEntries[entryId])
			.filter((entry): entry is MapStackEntry => Boolean(entry))
		return {
			total: entries.length,
			visible: entries.filter((entry) => entry.visible).length,
		}
	}, [mapStackEntries, mapStackOrder])

	const validationModeForActiveContext = contextFilterMode === 'off' ? 'warn' : contextFilterMode

	const activeContextValidationByDatasetKey = useMemo(() => {
		const map = new Map<string, ReturnType<typeof validateDatasetForContext>>()
		if (!mapFilterContext || !mapFilterContextCoordinate) return map
		if (mapFilterContext.context.contextUse === 'taxonomy') return map

		activeContextDatasets.forEach((event) => {
			const collection = resolvedCollectionResolver(event) ?? event.featureCollection
			map.set(
				getDatasetKey(event),
				validateDatasetForContext(
					event,
					mapFilterContext,
					collection,
					validationModeForActiveContext,
				),
			)
		})

		return map
	}, [
		mapFilterContext,
		mapFilterContextCoordinate,
		activeContextDatasets,
		resolvedCollectionResolver,
		getDatasetKey,
		validationModeForActiveContext,
	])

	const scopedGeoEvents = useMemo(() => {
		if (!mapFilterContext || !mapFilterContextCoordinate) return mapGeoEvents
		if (mapFilterContext.context.contextUse === 'taxonomy') {
			return activeContextDatasets
		}
		return activeContextDatasets.filter((event) => {
			const key = getDatasetKey(event)
			const validation = activeContextValidationByDatasetKey.get(key)
			if (!validation) {
				return contextFilterMode !== 'strict'
			}
			return isDatasetAllowedByContextFilter(validation, contextFilterMode)
		})
	}, [
		mapFilterContext,
		mapFilterContextCoordinate,
		activeContextDatasets,
		activeContextValidationByDatasetKey,
		getDatasetKey,
		contextFilterMode,
		mapGeoEvents,
	])

	// Stack = visibility. Under the Round C/D invariant, the map renders exactly
	// what's on the map stack — no scope filters, no focus filter, no separate
	// edit-isolation toggle. The only override is map-stack isolation (Round B):
	// when one entry is isolated only its keys render. Draft entries don't
	// contribute keys, so an isolated draft naturally produces []. Context
	// entries (C.2) expand to their curated datasets, minus any keys the user
	// has unchecked in the inline expand panel (`entry.exclusions`).
	const visibleGeoEvents = useMemo(() => {
		const contextByKey = new Map<string, MapContext>()
		for (const ctx of mapContextEvents) {
			const key = ctx.contextCoordinate ?? ctx.id ?? ctx.contextId ?? ctx.dTag
			if (key) contextByKey.set(key, ctx)
		}

		// Compute the curated dataset keys for a context entry, honouring its
		// exclusions. Cheap because the stack is typically a handful of entries.
		const curatedKeysFor = (entry: MapStackEntry): Set<string> => {
			const out = new Set<string>()
			const ctx = contextByKey.get(entry.entityKey)
			if (!ctx) return out
			const scope = resolveContextMapScope(
				ctx,
				geoEvents,
				mapContextEvents,
				getDefaultContextMapScopeMode(ctx),
			)
			const exclusionSet = new Set(entry.exclusions ?? [])
			for (const { dataset } of scope.datasets) {
				const key = getDatasetKey(dataset)
				if (!exclusionSet.has(key)) out.add(key)
			}
			return out
		}

		// Isolation: when one entry is isolated, only its keys render. Dataset
		// entries → the single key; context entries → the curated set minus
		// exclusions.
		const isolatedEntry = (() => {
			for (const entryId of mapStackOrder) {
				const entry = mapStackEntries[entryId]
				if (entry?.isolated) return entry
			}
			return null
		})()
		if (isolatedEntry) {
			const isolatedKeys =
				isolatedEntry.entityType === 'dataset'
					? new Set([isolatedEntry.entityKey])
					: curatedKeysFor(isolatedEntry)
			if (isolatedKeys.size === 0) return []
			return mapGeoEvents.filter((event) => isolatedKeys.has(getDatasetKey(event)))
		}

		// Round G.1: stack order is render order. Each dataset key gets the rank
		// of the first stack entry that contributes it; the filtered result is
		// sorted by rank so entries later in the panel render later (on top).
		const rankByKey = new Map<string, number>()
		let nextRank = 0
		for (const entryId of mapStackOrder) {
			const entry = mapStackEntries[entryId]
			if (!entry || entry.visible === false) continue
			if (entry.entityType === 'dataset') {
				if (!rankByKey.has(entry.entityKey)) rankByKey.set(entry.entityKey, nextRank++)
			} else if (entry.entityType === 'context') {
				for (const key of curatedKeysFor(entry)) {
					if (!rankByKey.has(key)) rankByKey.set(key, nextRank++)
				}
			}
		}
		if (rankByKey.size === 0) return []
		return mapGeoEvents
			.filter((event) => rankByKey.has(getDatasetKey(event)))
			.sort(
				(a, b) => (rankByKey.get(getDatasetKey(a)) ?? 0) - (rankByKey.get(getDatasetKey(b)) ?? 0),
			)
	}, [geoEvents, mapGeoEvents, getDatasetKey, mapStackEntries, mapStackOrder, mapContextEvents])

	// Phase 13 (SPEC §3.2): sightings/beacons render from STACK MEMBERSHIP, not
	// unconditionally. These mirror `visibleGeoEvents` — an aggregate `*-layer`
	// entry seeds the full subscription set; individual `sighting`/`beacon` entries
	// union in one entity each; an isolated entry renders solo (deep-link-solo).
	// The pure derivation lives in `deriveVisibleEntitiesFromStack` (module scope,
	// unit-tested); `buildSightingSource`/`buildBeaconSource` keep their internal
	// `dropExpired` + freshest-per-{pubkey,d} de-dup on whatever set they receive.
	// entityKey resolution mirrors the map render/de-dup key: naddr with a dTag/id
	// fallback (the same key the deep-link handlers pin under, so an isolated route
	// entry resolves to exactly its own entity — T-13-03-FORCEISO).
	// Plan 13-06: individual sighting entries resolve against the discovery
	// subscription UNION the explicitly-added cache, so an out-of-subscription
	// sighting pinned via `addSightingToMapStack` still renders. `addedCacheTick`
	// forces re-derivation when the cache mutates. The FIRST arg (subscriptionSet /
	// aggregate seed) stays discovery-only — an added sighting never leaks into the
	// aggregate `sighting-layer`.
	// biome-ignore lint/correctness/useExhaustiveDependencies: addedCacheTick intentionally gates the ref-cache read.
	const sightingLookupSuperset = useMemo(() => {
		const added = Array.from(addedSightingCacheRef.current.values())
		return added.length ? [...sightings, ...added] : sightings
	}, [sightings, addedCacheTick])
	const visibleSightingsFromStack = useMemo(
		() =>
			deriveVisibleEntitiesFromStack(
				sightings,
				mapStackEntries,
				mapStackOrder,
				'sighting',
				'sighting-layer',
				getSightingMapStackKey,
				sightingLookupSuperset,
			),
		[sightings, mapStackEntries, mapStackOrder, sightingLookupSuperset],
	)
	// A /beacon/:naddr deep link may target a LINK-ONLY beacon, which is absent from
	// the `#t:['live']` discovery surface (`beacons` above). Decode the routed naddr
	// and fire a TARGETED {authors,#d} subscription so a logged-out viewer can open
	// it (account-free, D-11). Resolved up here (Phase 13, moved above useMapLayers)
	// so `visibleBeaconsFromStack` can resolve an isolated/pinned link-only beacon
	// against the discovery ∪ routed superset.
	const routedBeaconAddress = useMemo(() => {
		if (route.focusType !== 'beacon' || !route.naddr) return null
		try {
			const decoded = nip19.decode(route.naddr)
			if (decoded.type !== 'naddr' || decoded.data.kind !== LIVE_BEACON_KIND) return null
			return { pubkey: decoded.data.pubkey, identifier: decoded.data.identifier }
		} catch {
			return null
		}
	}, [route.focusType, route.naddr])
	const { events: routedBeacons } = useBeacons(
		routedBeaconAddress
			? [{ authors: [routedBeaconAddress.pubkey], '#d': [routedBeaconAddress.identifier] }]
			: [],
	)
	// Beacon individual/isolated stack entries resolve against discovery ∪ routed so
	// a link-only or deep-linked beacon (outside `#t:['live']`) still renders when
	// pinned/isolated. The AGGREGATE layer only ever seeds from `beacons` (discovery)
	// inside the helper — a link-only beacon never leaks into the layer
	// (T-13-03-GPSREGRESS).
	const beaconLookupSuperset = useMemo(
		() => (routedBeacons.length ? [...beacons, ...routedBeacons] : beacons),
		[beacons, routedBeacons],
	)
	// Plan 13-06: widen the beacon individual-lookup to (discovery ∪ routed) ∪ the
	// explicitly-added cache, so an own / link-only / faded-from-live beacon pinned via
	// `addBeaconToMapStack` resolves for the render gate AND the sweep. The aggregate
	// `beacon-layer` seed remains `beacons` (discovery only) inside the helper — a
	// cached beacon NEVER reaches the aggregate branch (T-13-06-01 privacy invariant).
	// biome-ignore lint/correctness/useExhaustiveDependencies: addedCacheTick intentionally gates the ref-cache read.
	const addedBeaconLookupSuperset = useMemo(() => {
		const added = Array.from(addedBeaconCacheRef.current.values())
		return added.length ? [...beaconLookupSuperset, ...added] : beaconLookupSuperset
	}, [beaconLookupSuperset, addedCacheTick])
	const visibleBeaconsFromStack = useMemo(
		() =>
			deriveVisibleEntitiesFromStack(
				beacons,
				mapStackEntries,
				mapStackOrder,
				'beacon',
				'beacon-layer',
				getBeaconMapStackKey,
				addedBeaconLookupSuperset,
			),
		[beacons, mapStackEntries, mapStackOrder, addedBeaconLookupSuperset],
	)

	// Phase 13 (D-02): pinned-entry expiry AUTO-REMOVE sweep (dropExpired parity).
	// An individual `sighting`/`beacon` stack entry whose resolved entity has passed
	// its NIP-40 expiration — or has dropped out of the (already dropExpired'd)
	// subscription entirely — has its stack entry removed, so "on the stack = visible"
	// stays honest and no ended tombstone row lingers (matches the Phase-12 beacon
	// honesty posture). Aggregate `*-layer` entries are NOT swept: they gate the whole
	// subscription, which self-drops expired entities inside buildSighting/BeaconSource.
	// Runs on the sighting/beacon subscription tick (the sets update on their own
	// expiry ticks — 60s sightings / 15s beacons — so this re-evaluates as they change).
	useEffect(() => {
		const now = unixNow()
		// Plan 13-06 (Task 2): build the sweep's per-kind lookup from the SAME widened
		// (cache-inclusive) sets the render gate uses, so a user-added out-of-discovery
		// entry resolves here and is judged on EXPIRY ALONE — not on discovery
		// membership. A faded-from-live-but-not-expired entry is therefore KEPT.
		const sightingByKey = new Map<string, TemporalSighting>()
		for (const s of sightingLookupSuperset) {
			const key = getSightingMapStackKey(s)
			if (key) sightingByKey.set(key, s)
		}
		const beaconByKey = new Map<string, LiveBeacon>()
		for (const b of addedBeaconLookupSuperset) {
			const key = getBeaconMapStackKey(b)
			if (key) beaconByKey.set(key, b)
		}
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (!entry) continue
			if (entry.entityType === 'sighting') {
				const resolved = sightingByKey.get(entry.entityKey)
				// Evict only when unresolvable (nothing to render) OR genuinely NIP-40
				// expired (D-02 honesty). STALE is NOT expiry — it never triggers here.
				if (
					shouldSweepStackEntry({
						resolved: !!resolved,
						expired: !!resolved && isExpired(resolved.event, now),
					})
				) {
					addedSightingCacheRef.current.delete(entry.entityKey)
					removeMapStackEntry(id)
				}
			} else if (entry.entityType === 'beacon') {
				const resolved = beaconByKey.get(entry.entityKey)
				if (
					shouldSweepStackEntry({
						resolved: !!resolved,
						expired: !!resolved && isExpired(resolved.event, now),
					})
				) {
					addedBeaconCacheRef.current.delete(entry.entityKey)
					removeMapStackEntry(id)
				}
			}
		}
	}, [
		sightingLookupSuperset,
		addedBeaconLookupSuperset,
		mapStackEntries,
		mapStackOrder,
		removeMapStackEntry,
	])

	// Round F.2: comment/annotation overlays follow the stack. A visible
	// comment overlay stays only while its root entity is still anchored —
	// either a context entry with the same coordinate, or a dataset that is
	// currently rendered (directly stacked or curated by a stacked context).
	// Without this, removing a context left its observations on the map.
	useEffect(() => {
		const stackedContextCoords = new Set<string>()
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (entry?.entityType === 'context') stackedContextCoords.add(entry.entityKey)
		}
		const visibleDatasetKeys = new Set(visibleGeoEvents.map((event) => getDatasetKey(event)))
		pruneCommentGeometry((comment) => {
			const root = comment.rootAddress
			// Overlays without a parent coordinate aren't stack-managed — keep.
			if (!root) return true
			if (stackedContextCoords.has(root)) return true
			// rootAddress is `kind:pubkey:d`; dataset keys are `pubkey:d`.
			const parts = root.split(':')
			const datasetKey = parts.length >= 3 ? parts.slice(1).join(':') : root
			return visibleDatasetKeys.has(datasetKey)
		})
	}, [mapStackEntries, mapStackOrder, visibleGeoEvents, getDatasetKey, pruneCommentGeometry])

	const toolbarMapStackOpen = isMobile
		? mobilePanelOpen && mobilePanelTab === 'map-stack'
		: desktopMapStackOpen
	const toggleToolbarMapStack = useCallback(() => {
		if (isMobile) {
			if (mobilePanelOpen && mobilePanelTab === 'map-stack') {
				setMobilePanelOpen(false)
				return
			}
			openMobilePanel('map-stack')
			return
		}
		toggleMapStack()
	}, [
		isMobile,
		mobilePanelOpen,
		mobilePanelTab,
		openMobilePanel,
		setMobilePanelOpen,
		toggleMapStack,
	])

	const lastContextCoordinateRef = useRef<string | null>(null)
	useEffect(() => {
		if (!explicitContext) {
			lastContextCoordinateRef.current = null
			setViewContext(null)
			setViewContextDatasets([])
			return
		}

		const coordinate = getContextCoordinate(explicitContext)
		setViewContext(explicitContext)
		setViewContextDatasets(activeContextDatasets)

		if (coordinate && lastContextCoordinateRef.current !== coordinate) {
			lastContextCoordinateRef.current = coordinate
			setContextFilterMode(defaultContextFilterMode(explicitContext))
			setContextMapScopeMode(getDefaultContextMapScopeMode(explicitContext))
		}
	}, [
		explicitContext,
		activeContextDatasets,
		setViewContext,
		setViewContextDatasets,
		setContextFilterMode,
		setContextMapScopeMode,
	])

	// Auto-attach scope context for fresh geometry creation only.
	useEffect(() => {
		if (activeDataset) return
		if (features.length > 0) return

		const canAutoAttachToContext = explicitContext?.context.allowForeignAttachments ?? false

		if (mapFilterContextCoordinate && canAutoAttachToContext) {
			if (
				activeDatasetContextRefs.length === 1 &&
				activeDatasetContextRefs[0] === mapFilterContextCoordinate
			) {
				return
			}
			setActiveDatasetContextRefs([mapFilterContextCoordinate])
			return
		}

		if (activeDatasetContextRefs.length > 0) {
			setActiveDatasetContextRefs([])
		}
	}, [
		activeDataset,
		features.length,
		mapFilterContextCoordinate,
		explicitContext?.context.allowForeignAttachments,
		activeDatasetContextRefs,
		setActiveDatasetContextRefs,
	])

	// Round D.3: visibility derives purely from stack membership. The sidebar
	// uses this map to highlight which catalog rows are "currently on the map"
	// — the answer is exactly "is this dataset in visibleGeoEvents?".
	const effectiveVisibility = useMemo(() => {
		const effectiveMap: Record<string, boolean> = {}
		const visibleKeys = new Set(visibleGeoEvents.map((e) => getDatasetKey(e)))
		geoEvents.forEach((event) => {
			const key = getDatasetKey(event)
			effectiveMap[key] = visibleKeys.has(key)
		})
		return effectiveMap
	}, [geoEvents, visibleGeoEvents, getDatasetKey])

	useEffect(() => {
		featuresRef.current = features
	}, [features])

	// Available features for $ mentions in comments
	// We want to allow mentioning any loaded dataset, not just visible ones
	const geoEventsForMentions = useMemo(() => {
		if (!viewingDataset) return mapGeoEvents
		if (mapGeoEvents.some((ev) => ev.id === viewingDataset.id)) return mapGeoEvents
		return [...mapGeoEvents, viewingDataset]
	}, [mapGeoEvents, viewingDataset])

	const availableFeatures = useAvailableGeoFeatures(
		geoEventsForMentions,
		resolvedCollectionResolver,
		mapContextEvents,
	)

	// Map layers hook
	// Phase 13 (SPEC §3.2): sightings/beacons now render from STACK MEMBERSHIP, not
	// unconditionally. `visibleSightingsFromStack`/`visibleBeaconsFromStack` (above)
	// gate the subscription set through the Map Stack the same way `visibleGeoEvents`
	// gates datasets — an aggregate `*-layer` entry shows the full set, an individual
	// entry pins one, an isolated entry (deep-link-solo) renders alone. This REPLACES
	// the `66a155e` beacon side-channel merge: a viewed/routed/own beacon renders
	// because it is on the stack (isolated for a deep link), not via a merge hack.
	const { remoteLayersReady, CLUSTERED_SOURCE_ID } = useMapLayers({
		mapRef: map,
		mounted,
		visibleGeoEvents,
		visibleSightings: visibleSightingsFromStack,
		visibleBeacons: visibleBeaconsFromStack,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
	})

	// Keep the viewport focused on the most recently loaded geometry after map source swaps.
	// We wait for the style to load because setStyle clears sources/layers and they are re-added on events.
	useEffect(() => {
		if (!map.current) return
		const mapInstance = map.current
		void mapSourceKey

		let cancelled = false

		const zoomToCurrentGeometry = async () => {
			if (cancelled) return
			const currentFeatures = (featuresRef.current ?? []).filter(
				(
					feature,
				): feature is EditorFeature & { geometry: NonNullable<EditorFeature['geometry']> } =>
					feature.geometry !== null,
			)
			if (currentFeatures.length === 0) {
				if (activeDataset) zoomToDataset(activeDataset)
				return
			}

			try {
				const turf = await import('@turf/turf')
				const bbox = turf.bbox({
					type: 'FeatureCollection',
					features: currentFeatures,
				})
				if (!Array.isArray(bbox) || bbox.length !== 4) return
				const [west, south, east, north] = bbox
				if (![west, south, east, north].every((v) => Number.isFinite(v))) return
				mapInstance.fitBounds(
					[
						[west, south],
						[east, north],
					],
					{ padding: 60, duration: 450 },
				)
			} catch {
				// If bbox calc fails, keep current camera.
			}
		}

		const handleStyleLoad = () => {
			zoomToCurrentGeometry().catch(() => undefined)
		}

		mapInstance.once('style.load', handleStyleLoad)
		// Fallback: if style.load doesn't fire for a given change, still attempt once.
		const timeoutId = window.setTimeout(() => {
			zoomToCurrentGeometry().catch(() => undefined)
		}, 0)

		return () => {
			cancelled = true
			window.clearTimeout(timeoutId)
			try {
				mapInstance.off('style.load', handleStyleLoad)
			} catch {
				// Map may have been removed
			}
		}
	}, [mapSourceKey, activeDataset, zoomToDataset])

	// Round D.3: the "sync default visibility on geoEvents change" effect
	// is gone — visibility is no longer a separate sticky map. Stack
	// membership is the canonical signal; events that aren't on the stack
	// simply aren't rendered, regardless of how many datasets land in the
	// subscription. This drops O(geoEvents) work on every relay update too.

	// Initialize platform chrome. Mobile starts map-first with both transient
	// surfaces closed; route restoration may still open the appropriate one.
	useEffect(() => {
		if (isMobile) {
			setShowToolbar(false)
			setShowTips(false)
		} else {
			setShowDatasetsPanel(true)
			setShowInfoPanel(true)
			setShowToolbar(true)
			setShowTips(true)
		}
	}, [isMobile, setShowTips, setShowDatasetsPanel, setShowInfoPanel])

	// Handle pmtiles URL param on app load
	const setMapSource = useEditorStore((state) => state.setMapSource)
	useEffect(() => {
		const url = new URL(window.location.href)
		const pmtilesUrl = url.searchParams.get('pmtiles')
		if (pmtilesUrl) {
			setMapSource({
				type: 'pmtiles',
				location: 'remote',
				url: pmtilesUrl,
			})
		}
	}, [setMapSource])

	// Lock document scrolling on mobile to prevent address bar jitter during map gestures.
	useEffect(() => {
		if (!isMobile) return
		const root = document.documentElement
		const body = document.body
		const previous = {
			rootOverflow: root.style.overflow,
			rootOverscroll: root.style.overscrollBehavior,
			bodyOverflow: body.style.overflow,
			bodyOverscroll: body.style.overscrollBehavior,
		}

		root.style.overflow = 'hidden'
		root.style.overscrollBehavior = 'none'
		body.style.overflow = 'hidden'
		body.style.overscrollBehavior = 'none'

		return () => {
			root.style.overflow = previous.rootOverflow
			root.style.overscrollBehavior = previous.rootOverscroll
			body.style.overflow = previous.bodyOverflow
			body.style.overscrollBehavior = previous.bodyOverscroll
		}
	}, [isMobile])

	// Preload blob references for datasets
	useBlobResolution({
		geoEvents,
		ensureResolvedFeatureCollection,
		isMountedRef,
		onResolved: useCallback(() => setResolvedCollectionsVersion((v) => v + 1), []),
	})

	// Handle paste GeoJSON
	const handlePaste = useCallback(
		async (e: ClipboardEvent) => {
			if (!editor) return
			const target = e.target
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return
			}
			const text = e.clipboardData?.getData('text/plain')
			const candidate = getGeoJsonPasteCandidate(text)
			if (!candidate) return

			try {
				const json = JSON.parse(candidate)
				const collection = ensureFeatureCollection(json)
				const newFeatures = collection.features.map((f) => {
					// Ensure ID is a string
					const featureId = f.id != null ? String(f.id) : crypto.randomUUID()

					// Extract known properties, rest go to customProperties
					const { name, description, meta, featureId: _, ...restProperties } = f.properties || {}

					return {
						...f,
						id: featureId,
						properties: {
							name: name ?? f.properties?.name,
							description: description ?? f.properties?.description,
							meta: 'feature',
							featureId,
							customProperties: Object.keys(restProperties).length > 0 ? restProperties : undefined,
						},
					}
				})
				// INFRA-02 / D-08: route geometry writes through the Authoring API — the
				// only caller of editor.addFeature/setFeatures. Append (dedup-by-id).
				createAuthoring(editor).writeGeoJSON(newFeatures as EditorFeature[], { replace: false })
			} catch (error) {
				console.error('Failed to paste GeoJSON:', error)
			}
		},
		[editor],
	)

	useEffect(() => {
		document.addEventListener('paste', handlePaste)
		return () => {
			document.removeEventListener('paste', handlePaste)
		}
	}, [handlePaste])

	// Dataset actions
	const handleDatasetSelect = (event: GeoDataset) => {
		handleLoadDatasetForEditing(event)
	}

	const handleProposalAccepted = useCallback(
		(dataset: GeoDataset) => {
			setViewModeState('view')
			setViewDatasetState(dataset)
		},
		[setViewModeState, setViewDatasetState],
	)

	const getContextKey = useCallback((context: MapContext): string => {
		return context.contextId ?? context.dTag ?? context.id ?? ''
	}, [])

	const handleClear = useCallback(() => {
		if (!editor) return
		const all = editor.getAllFeatures()
		editor.deleteFeatures(all.map((f) => f.id))
		setSelectedFeatureIds([])
	}, [editor, setSelectedFeatureIds])

	const onDeleteDataset = useCallback(
		async (event: GeoDataset) => {
			const key = getDatasetKey(event)
			setDeletingKey(key)
			try {
				await handleDeleteDataset(event, tearDownEditSession)
			} finally {
				setDeletingKey(null)
			}
		},
		[getDatasetKey, handleDeleteDataset, tearDownEditSession],
	)

	const onDeleteContext = useCallback(
		async (context: MapContext) => {
			if (!accounts.signer) {
				toast.error('No active account.')
				return
			}

			const contextId = getContextKey(context)
			if (!contextId) {
				toast.error('Context is missing a d tag and cannot be deleted.')
				return
			}

			const targetCoordinate = context.contextCoordinate
			setDeletingKey(`context:${contextId}`)
			try {
				const signer = accounts.signer
				if (!signer) throw new Error('No active account')
				await deleteMapContext(context.event, signer)

				const viewedContext = useEditorStore.getState().viewContext
				const viewedContextId = viewedContext ? getContextKey(viewedContext) : null
				if (viewedContextId === contextId) {
					exitViewMode()
				}
				if (targetCoordinate && contextCoordinate === targetCoordinate) {
					clearContextScope()
				}

				toast.success(`Deleted "${context.context.name || context.contextId || 'context'}".`)
			} catch (error) {
				console.error('Failed to delete context', error)
				toast.error('Failed to delete context. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[getContextKey, exitViewMode, clearContextScope, contextCoordinate],
	)

	// Export/Import
	const buildEditorFeatureCollection = useCallback(() => {
		if (!editor) return
		return {
			type: 'FeatureCollection',
			features: editor.getAllFeatures(),
		}
	}, [editor])

	const exportGeoJSON = useCallback(() => {
		const geojson = buildEditorFeatureCollection()
		if (!geojson) return

		const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = 'features.geojson'
		a.click()
		URL.revokeObjectURL(url)
	}, [buildEditorFeatureCollection])

	const exportSHP = useCallback(async () => {
		const collection = buildEditorFeatureCollection()
		if (!collection) return

		try {
			const { blob, skippedCount, downloadName } = await exportShapefile(collection, 'features')
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = downloadName
			a.click()
			URL.revokeObjectURL(url)

			if (skippedCount > 0) {
				toast.warning(`Exported SHP ZIP. Skipped ${skippedCount} unsupported feature(s).`)
			} else {
				toast.success('Exported SHP ZIP.')
			}
		} catch (error) {
			console.error('Failed to export SHP:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to export SHP.')
		}
	}, [buildEditorFeatureCollection])

	const handleImport = useCallback(
		async (file: File) => {
			if (!editor) return

			const extension = file.name.split('.').pop()?.toLowerCase()
			try {
				let collection: GeoJSON.FeatureCollection
				let importSource = 'geojson'

				if (extension === 'zip' || extension === 'shp') {
					collection = await importShapefile(file)
					importSource = 'shapefile'
				} else if (extension === 'geojson' || extension === 'json') {
					const json = JSON.parse(await file.text())
					collection = ensureFeatureCollection(json)
				} else {
					toast.error('Unsupported import format. Use GeoJSON, zipped SHP, or .shp.')
					return
				}

				const newFeatures = collection.features.map((feature) =>
					toEditorFeature(feature, importSource),
				)

				// INFRA-02 / D-08: route through the Authoring API (preserves importSource
				// already on the normalized features; append with dedup-by-id).
				createAuthoring(editor).writeGeoJSON(newFeatures as EditorFeature[], { replace: false })

				const meta = extractCollectionMeta(collection)
				if (!meta.name) {
					meta.name = file.name.replace(/\.[^.]+$/, '')
				}
				if (meta) setCollectionMeta(meta)
				toast.success(`Imported ${newFeatures.length} feature(s) from ${file.name}.`)
			} catch (e) {
				console.error('Failed to import file:', e)
				toast.error(e instanceof Error ? e.message : 'Failed to import file.')
			}
		},
		[editor, setCollectionMeta],
	)

	// OSM Query hook
	const { handleOsmQueryClick, handleOsmQueryView, handleOsmImport, clearOsmQuery } = useOsmQuery(
		map,
		editor,
	)

	// Context editor hooks
	const {
		contextEditorMode,
		editingContext,
		handleLoadDatasetForEditing,
		handleInspectContext,
		handleCreateContext,
		handleEditContext,
		handleSaveContext,
		handleCloseContextEditor,
		handleOpenGeometryEditor,
		handleInspectDatasetWithModeSwitch,
	} = useContextEditor({
		isMobile,
		ensureInfoPanelVisible,
		encodeContextNaddr,
		navigateToContext,
		navigateToView,
		clearFocus,
		loadDatasetForEditing,
		startNewDataset,
		switchToWorkspace,
		handleInspectDataset,
	})

	// Story editor hooks (Phase 10, D-01/D-02/D-03).
	const encodeStoryNaddr = useCallback((story: Article): string | null => {
		const identifier = story.dTag
		if (!identifier || !story.pubkey) return null
		try {
			return nip19.naddrEncode({
				kind: ARTICLE_KIND,
				pubkey: story.pubkey,
				identifier,
			})
		} catch {
			return null
		}
	}, [])

	// Sighting naddr encoder — resolves a /sighting/:naddr deep link to the cast so
	// the focus-route effect can open it (Phase 11, Plan 04 / D-08).
	const encodeSightingNaddr = useCallback(
		(sighting: TemporalSighting): string | null => encodeSightingNaddrPure(sighting),
		[],
	)

	// Beacon naddr encoder — resolves a /beacon/:naddr deep link to its cast. The
	// naddr carries the THROWAWAY pubkey (the beacon is not under the user's profile,
	// D-05/D-11).
	const encodeBeaconNaddr = useCallback(
		(beacon: LiveBeacon): string | null => encodeBeaconNaddrPure(beacon),
		[],
	)

	const {
		storyEditorMode,
		editingStory,
		handleInspectStory,
		handleCreateStory,
		handleEditStory,
		handleSaveStory,
		handleCloseStoryEditor,
	} = useStoryEditor({
		isMobile,
		ensureInfoPanelVisible,
		encodeStoryNaddr,
		navigateTo,
		navigateToView,
		clearFocus,
	})

	const handleDeleteStory = useCallback(
		async (story: Article) => {
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account.')
				return
			}
			const storyKey = story.dTag ?? story.id
			if (!storyKey) {
				toast.error('Story is missing a d tag and cannot be deleted.')
				return
			}
			setDeletingKey(`story:${storyKey}`)
			try {
				await deleteStory(story.event, signer)
				const viewedStory = useEditorStore.getState().viewStory
				const viewedKey = viewedStory ? (viewedStory.dTag ?? viewedStory.id) : null
				if (viewedKey === storyKey) {
					exitViewMode()
				}
				toast.success(`Deleted "${story.article.title || 'story'}".`)
			} catch (error) {
				console.error('Failed to delete story', error)
				toast.error('Failed to delete story. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[exitViewMode],
	)

	// ── Temporal Sighting create/edit + map-first pin-drop (Phase 11, D-01/D-02/D-07) ──
	// A ref mirror of `placementArmed` so the editor 'create' listener (registered
	// once) reads the latest armed state without re-subscribing.
	const sightingPlacementArmedRef = useRef(false)
	const armSightingPlacement = useCallback(() => {
		sightingPlacementArmedRef.current = true
		// Map-first pin-drop: a single touch tap must place the point even with pan
		// lock off (otherwise touch taps in draw mode are ignored — the tap never
		// drops the pin on mobile). A drag still pans the map.
		editor?.setTouchTapDrawEnabled(true)
		editor?.setMode('draw_point')
	}, [editor])
	const disarmSightingPlacement = useCallback(() => {
		sightingPlacementArmedRef.current = false
		editor?.setTouchTapDrawEnabled(false)
		// Return the editor to a non-drawing idle mode.
		if (editor && editor.getMode() !== 'select') editor.setMode('select')
	}, [editor])

	const {
		sightingEditorMode,
		editingSighting,
		viewSighting,
		lastInspectedSightingKey,
		sightingFocusCommentId,
		placedGeometry: placedSightingGeometry,
		placementArmed: sightingPlacementArmed,
		clearSightingEditorModes,
		clearSightingView,
		handleInspectSighting,
		handleCreateSighting,
		handleGeometryPlaced,
		cancelPlacement: cancelSightingPlacement,
		handleEditSighting,
		handleSaveSighting,
		handleCloseSightingEditor,
	} = useSightingEditor({
		isMobile,
		ensureInfoPanelVisible,
		navigateToView,
		clearFocus,
		armPlacement: armSightingPlacement,
		disarmPlacement: disarmSightingPlacement,
	})

	// Keep the ref in sync with the hook's armed state (covers cancel/escape paths).
	useEffect(() => {
		sightingPlacementArmedRef.current = sightingPlacementArmed
	}, [sightingPlacementArmed])

	// Intercept the GeoEditor 'create' event ONLY while a Sighting placement is
	// armed: capture the placed feature's geometry, open the editor with it, and
	// remove the transient point from the editor's feature set (it isn't a dataset
	// feature — it becomes the Sighting's content.geometry).
	useEffect(() => {
		if (!editor) return
		const handleCreate = (event: EditorEvent) => {
			if (!sightingPlacementArmedRef.current) return
			const feature = event.features?.[0]
			if (!feature?.geometry) return
			sightingPlacementArmedRef.current = false
			handleGeometryPlaced(feature.geometry as Geometry)
			// Drop the transient draw feature so it doesn't pollute the dataset draft.
			try {
				if (feature.id) editor.deleteFeature(feature.id)
			} catch {
				// best-effort cleanup
			}
		}
		editor.on('create', handleCreate)
		return () => {
			editor.off('create', handleCreate)
		}
	}, [editor, handleGeometryPlaced])

	// Esc cancels an armed placement (D-01 keyboard alternative).
	useEffect(() => {
		if (!sightingPlacementArmed) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') cancelSightingPlacement()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [sightingPlacementArmed, cancelSightingPlacement])

	const handleDeleteSighting = useCallback(
		async (sighting: TemporalSighting) => {
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account.')
				return
			}
			const sightingKey = sighting.dTag ?? sighting.id
			if (!sightingKey) {
				toast.error('Sighting is missing a d tag and cannot be deleted.')
				return
			}
			setDeletingKey(`sighting:${sightingKey}`)
			try {
				await deleteSighting(sighting.event, signer)
				if (viewSighting && (viewSighting.dTag ?? viewSighting.id) === sightingKey) {
					clearSightingEditorModes()
					exitViewMode()
				}
				toast.success(`Deleted "${sighting.sighting.title || 'sighting'}".`)
			} catch (error) {
				console.error('Failed to delete sighting', error)
				toast.error('Failed to delete sighting. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[exitViewMode, viewSighting, clearSightingEditorModes],
	)

	// Switch the armed create flow to an area draw (D-02 "Draw an area instead").
	const handleDrawSightingArea = useCallback(() => {
		sightingPlacementArmedRef.current = true
		editor?.setTouchTapDrawEnabled(true)
		editor?.setMode('draw_polygon')
	}, [editor])

	// ── Live Beacon Start/Stop/Adjust/inspect (Phase 12, BEACON-01..04, D-12) ──
	// The controller binds the Plan-03 useBeaconPublisher (the live watch loop +
	// throwaway signer) to the UI: the control panel, the read view, the Beacons
	// rail handlers, and the always-on RunningBeaconBanner mounted over the map.
	// No pin-drop — a beacon's position comes from GPS.
	const {
		isLive: beaconIsLive,
		subState: beaconSubState,
		session: beaconSession,
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
		lastInspectedBeaconKey,
		beaconFocusCommentId,
		handleShareLocation,
		handleStartBeacon,
		handleStopBeacon,
		handleAdjustBeacon,
		handleInspectBeacon,
		handleCloseBeaconControl,
		clearBeaconView,
	} = useBeaconController({
		ensureInfoPanelVisible,
		navigateToView,
		navigateTo,
		encodeBeaconNaddr,
		zoomToBeacon: handleZoomToBeacon,
		clearFocus,
	})

	// Follow mode: while on, keep the map centered on the VIEWED beacon as new
	// positions arrive; auto-off on a manual pan so the user never fights the camera.
	const [followingBeaconKey, setFollowingBeaconKey] = useState<string | null>(null)
	const viewBeaconKey = viewBeacon ? (viewBeacon.dTag ?? viewBeacon.id) : null
	const isFollowingBeacon = !!followingBeaconKey && followingBeaconKey === viewBeaconKey
	const toggleFollowBeacon = useCallback(() => {
		setFollowingBeaconKey((current) =>
			current && current === viewBeaconKey ? null : viewBeaconKey,
		)
	}, [viewBeaconKey])
	// Drop follow when the viewed beacon changes or the detail closes.
	useEffect(() => {
		if (followingBeaconKey && followingBeaconKey !== viewBeaconKey) setFollowingBeaconKey(null)
	}, [followingBeaconKey, viewBeaconKey])
	// Freshest position for the followed beacon (updates live through useBeacons).
	const followedBeaconCoords = useMemo(() => {
		if (!followingBeaconKey) return null
		const match = [...beacons, ...routedBeacons].find(
			(b) => (b.dTag ?? b.id) === followingBeaconKey,
		)
		const geometry = match?.geometry
		if (!geometry || geometry.type !== 'Point') return null
		return geometry.coordinates as [number, number]
	}, [followingBeaconKey, beacons, routedBeacons])
	// Recenter on each new position. easeTo does NOT emit 'dragstart', so it never
	// trips the manual-pan auto-off below.
	useEffect(() => {
		if (!followingBeaconKey || !followedBeaconCoords || !map.current) return
		map.current.easeTo({ center: followedBeaconCoords, duration: 600 })
	}, [followingBeaconKey, followedBeaconCoords])

	// Mobile: when a non-dataset entity editor becomes ready for data entry, slide
	// the sheet up to the 'edit' tab at Half so the form is visible (a dataset draft
	// uses the author-stance effect → Map Stack instead). A Sighting create waits for
	// the point to be dropped first (map-first placement) so the map stays usable
	// while you place the pin; every other editor rises as soon as it opens. Fires
	// only on the rising edge so a manual drag afterwards is respected.
	const mobileEntityEditorReady =
		contextEditorMode !== 'none' ||
		storyEditorMode !== 'none' ||
		beaconControlMode !== 'none' ||
		viewSighting != null ||
		viewBeacon != null ||
		sightingEditorMode === 'edit' ||
		(sightingEditorMode === 'create' && placedSightingGeometry != null)
	const prevEntityEditorReadyRef = useRef(false)
	useEffect(() => {
		if (!isMobile) {
			prevEntityEditorReadyRef.current = mobileEntityEditorReady
			return
		}
		const wasReady = prevEntityEditorReadyRef.current
		prevEntityEditorReadyRef.current = mobileEntityEditorReady
		if (!wasReady && mobileEntityEditorReady) {
			openMobilePanel('edit')
			setMobilePanelSnap('half')
		}
	}, [isMobile, mobileEntityEditorReady, openMobilePanel, setMobilePanelSnap])

	// Sighting pin-drop is map-first: when placement arms (create mode, no geometry
	// yet), drop the sheet to peek so the whole map is reachable for dropping the
	// pin. When the pin lands (armed → placed), lift the form to Half + the Editor
	// tab. This is handled here (not via the generic rise-on-ready effect above)
	// because placement completing may not be a rising edge of `mobileEntityEditorReady`
	// if another entity editor was already open — so the placement transition must
	// drive the rise directly. Fires only on the arm/land transitions.
	const sightingPlacementActive = sightingEditorMode === 'create' && placedSightingGeometry == null
	const prevSightingPlacementRef = useRef(false)
	useEffect(() => {
		if (!isMobile) {
			prevSightingPlacementRef.current = sightingPlacementActive
			return
		}
		const wasActive = prevSightingPlacementRef.current
		prevSightingPlacementRef.current = sightingPlacementActive
		if (!wasActive && sightingPlacementActive) {
			setMobilePanelOpen(false)
		} else if (wasActive && !sightingPlacementActive && placedSightingGeometry != null) {
			openMobilePanel('edit')
			setMobilePanelSnap('half')
		}
	}, [
		isMobile,
		sightingPlacementActive,
		placedSightingGeometry,
		openMobilePanel,
		setMobilePanelOpen,
		setMobilePanelSnap,
	])
	// Auto-off on user pan (drag). Programmatic recenters use easeTo, not drag.
	useEffect(() => {
		const m = map.current
		if (!mounted || !m) return
		const stopFollow = () => setFollowingBeaconKey(null)
		m.on('dragstart', stopFollow)
		return () => {
			m.off('dragstart', stopFollow)
		}
	}, [mounted])

	// Phase 13 (SPEC §3.5): the `66a155e` side-channel that fed the viewed/routed/own
	// beacon into the map layer via a merged extras state is DELETED. A deep-linked or
	// viewed beacon now renders because the route/inspect flow puts it on the Map
	// Stack (isolated for a deep link), and `visibleBeaconsFromStack` resolves it
	// against the discovery ∪ routed superset. No merge state, no sync effect.

	// The running banner's countdown reads the user's own live beacon's NIP-40
	// expiration. The publisher session carries the `d`; resolve the matching live
	// cast from the subscription to read its expiry (the freshest own-beacon).
	const ownLiveBeacon = useMemo<LiveBeacon | null>(() => {
		if (!beaconSession || !currentUserPubkey) return null
		const sessionPubkey = beaconSession.sk ? undefined : currentUserPubkey
		return (
			beacons.find(
				(b) =>
					b.dTag === beaconSession.d && (sessionPubkey === undefined || b.pubkey === sessionPubkey),
			) ?? null
		)
	}, [beacons, beaconSession, currentUserPubkey])

	const beaconBannerCountdown = useMemo(() => {
		if (!ownLiveBeacon?.expiresAt) return null
		return formatExpiryCountdown(ownLiveBeacon.expiresAt, Math.floor(Date.now() / 1000))
	}, [ownLiveBeacon])

	// Phase 13 (13-uat, finding A): AUTO-ADD the sharer's OWN live beacon to the Map
	// Stack the first time it appears, so the creator never has to click "Add to map
	// stack" after Start. A link-only own beacon has no `#t:live`, so without this it
	// isn't a stack entry and doesn't render (visibleBeaconsFromStack resolves only
	// discovery ∪ explicit stack entries). We route through addBeaconToMapStack (NOT a
	// raw addMapStackEntry) so the resolved beacon is deposited into addedBeaconCacheRef
	// — that's what lets a link-only own beacon render WITHOUT leaking it into `#t:live`
	// discovery (preserving the T-13-06-01 / T-13-03-GPSREGRESS privacy invariant).
	// Source 'own' is non-toasting (the user didn't click) and non-isolating (doesn't
	// suppress other entries). Keyed once per beacon identity via the stable `d` tag
	// (preserved across 30s heartbeats), so this fires ONCE per session, not per fix.
	const autoAddedOwnBeaconKeyRef = useRef<string | null>(null)
	useEffect(() => {
		if (!ownLiveBeacon) {
			// Stop / expiry: reset so a later new beacon session re-adds.
			autoAddedOwnBeaconKeyRef.current = null
			return
		}
		const key = getBeaconMapStackKey(ownLiveBeacon)
		if (!key || autoAddedOwnBeaconKeyRef.current === key) return
		autoAddedOwnBeaconKeyRef.current = key
		addBeaconToMapStack(ownLiveBeacon, 'own')
	}, [ownLiveBeacon, addBeaconToMapStack])

	// Handle initial route on page load (direct URL navigation)
	const focusHandledRef = useRef<string | null>(null)
	useEffect(() => {
		const routeKey =
			route.focusType !== 'none' && route.naddr ? `${route.focusType}:${route.naddr}` : null
		if (!routeKey) {
			focusHandledRef.current = null
			return
		}
		if (focusHandledRef.current === routeKey) return

		// Skip if no focus route (just sidebar view change)
		// If there's a specific focus route (e.g. /datasets/geoevent/...), handle zoom
		if (route.focusType === 'none' || !route.naddr) return
		// Wait for data to be available
		if (
			geoEvents.length === 0 &&
			mapContextEvents.length === 0 &&
			stories.length === 0 &&
			sightings.length === 0 &&
			beacons.length === 0 &&
			routedBeacons.length === 0
		)
			return

		// Decode the routed naddr ONCE and match by address fields. A shared
		// naddr may carry relay-hint TLVs (other clients, share sheets, chat
		// mentions) — string-comparing it against our locally-encoded bare
		// naddr silently never matches, which is exactly the "landing on a
		// shared route does nothing" failure. Falls back to string comparison
		// when the naddr doesn't decode.
		let routePointer: { kind: number; pubkey: string; identifier: string } | null = null
		try {
			const decoded = nip19.decode(route.naddr)
			if (decoded.type === 'naddr') routePointer = decoded.data
		} catch {
			routePointer = null
		}
		const matchesRoute = (fields: {
			kind?: number
			pubkey?: string
			identifier?: string | null
		}): boolean =>
			routePointer !== null &&
			fields.kind === routePointer.kind &&
			fields.pubkey === routePointer.pubkey &&
			(fields.identifier ?? '') === routePointer.identifier

		if (route.focusType === 'geoevent') {
			// Find the dataset matching the naddr
			const dataset = geoEvents.find(
				(event) =>
					matchesRoute({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: event.datasetId ?? event.dTag,
					}) || encodeGeoEventNaddr(event) === route.naddr,
			)
			if (dataset) {
				addDatasetToMapStack(dataset, 'route')
				handleInspectDataset(dataset)
				// Shared-link contract: landing zooms to the entity, not just
				// stacks it — the recipient should SEE what was shared.
				zoomToDataset(dataset)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'mapcontext') {
			const context = mapContextEvents.find(
				(ctx) =>
					matchesRoute({
						kind: ctx.kind,
						pubkey: ctx.pubkey,
						identifier: ctx.contextId ?? ctx.dTag,
					}) || encodeContextNaddr(ctx) === route.naddr,
			)
			if (context) {
				handleInspectContext(context)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'story') {
			const story = stories.find(
				(s) =>
					matchesRoute({ kind: s.kind, pubkey: s.pubkey, identifier: s.dTag }) ||
					encodeStoryNaddr(s) === route.naddr,
			)
			if (story) {
				handleInspectStory(story)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'sighting') {
			// D-08: resolve the /sighting/:naddr deep link via useSightings (already
			// dropExpired'd at the subscription — an expired sighting won't be found,
			// SIGHT-03) and open the read view.
			const sighting = sightings.find(
				(s) =>
					matchesRoute({ kind: s.kind, pubkey: s.pubkey, identifier: s.dTag }) ||
					encodeSightingNaddr(s) === route.naddr,
			)
			if (sighting) {
				// Phase 13 (D-03/SPEC §2.2): the routed sighting lands on the Map Stack
				// ISOLATED (deep-link-solo), mirroring the dataset route dispatch above
				// (addDatasetToMapStack(dataset, 'route')). This replaces any ambient
				// always-on rendering with explicit stack membership.
				addSightingToMapStack(sighting, 'route')
				// WR-06: thread the OG comment deep link so SightingViewPanel focuses it,
				// mirroring the geoevent/story comment-focus wiring.
				handleInspectSighting(sighting, route.commentId)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'beacon') {
			// D-11: resolve the /beacon/:naddr deep link (account-free). Check the
			// public discovery surface first, then the targeted {authors,#d}
			// subscription (a link-only beacon only lives there). dropExpired at the
			// subscription means an ended/expired beacon won't resolve — the view
			// panel's isExpired gate then shows the terminal copy. Thin per-kind
			// clone — Phase 13 / XCUT-02 generalizes.
			const matchesBeacon = (b: (typeof beacons)[number]) =>
				matchesRoute({ kind: b.kind, pubkey: b.pubkey, identifier: b.dTag }) ||
				encodeBeaconNaddr(b) === route.naddr
			const beacon = beacons.find(matchesBeacon) ?? routedBeacons.find(matchesBeacon)
			if (beacon) {
				// Phase 13 (D-03/SPEC §2.2): the routed beacon lands on the Map Stack
				// ISOLATED (deep-link-solo). This is what makes a link-only / deep-linked
				// beacon render now that the `66a155e` side-channel is gone — the isolated
				// entry resolves against the discovery ∪ routed superset in
				// visibleBeaconsFromStack.
				addBeaconToMapStack(beacon, 'route')
				// D-10: thread the OG comment deep link so BeaconViewPanel focuses it,
				// mirroring the Sighting comment-focus wiring above. Closes the
				// beacon /beacon/:naddr/comment/:id gap — parity across all five kinds.
				handleInspectBeacon(beacon, route.commentId)
				focusHandledRef.current = routeKey
			}
		}
	}, [
		route.focusType,
		route.naddr,
		route.commentId,
		geoEvents,
		mapContextEvents,
		stories,
		sightings,
		beacons,
		routedBeacons,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		encodeStoryNaddr,
		encodeSightingNaddr,
		encodeBeaconNaddr,
		addDatasetToMapStack,
		addSightingToMapStack,
		addBeaconToMapStack,
		handleInspectDataset,
		handleInspectContext,
		handleInspectStory,
		handleInspectSighting,
		handleInspectBeacon,
		zoomToDataset,
	])

	// Pan lock and magnifier
	const togglePanLock = useCallback(() => {
		if (!editor) return
		const next = !panLocked
		editor.setPanLocked(next)
		setPanLocked(next)
	}, [editor, panLocked, setPanLocked])

	// Search result handling
	const zoomToSearchResult = useCallback((result: GeoSearchResult) => {
		if (!map.current) return
		if (result.boundingbox) {
			const [west, south, east, north] = result.boundingbox
			map.current.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ padding: 40, duration: 500 },
			)
			return
		}
		map.current.flyTo({
			center: [result.coordinates.lon, result.coordinates.lat],
			zoom: 14,
			duration: 500,
		})
	}, [])

	// Handle locate button - zoom to user's current location and show marker
	const handleLocate = useCallback(
		(coords: { lat: number; lon: number; accuracy?: number } | null) => {
			setUserLocation(coords)

			// Only fly to location on first update (when tracking starts)
			if (coords && isFirstLocationUpdate.current && map.current) {
				map.current.flyTo({
					center: [coords.lon, coords.lat],
					zoom: 15,
					duration: 1000,
				})
				isFirstLocationUpdate.current = false
			}

			// Reset flag when tracking stops
			if (!coords) {
				isFirstLocationUpdate.current = true
			}
		},
		[],
	)

	const handleSearchResultSelect = useCallback(
		(result: GeoSearchResult) => {
			zoomToSearchResult(result)
		},
		[zoomToSearchResult],
	)

	// Zoom to a single editor feature
	const handleZoomToFeature = useCallback(
		(feature: EditorFeature) => {
			if (!map.current || !feature.geometry) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature as GeoJSON.Feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						handleZoomToBounds(bbox)
					}
				})
				.catch((err) => {
					console.warn('Failed to zoom to feature:', err)
				})
		},
		[handleZoomToBounds],
	)

	// Mention actions (naddr resolution, zoom-to, visibility toggle with focus exit)
	const {
		handleMentionZoomTo,
		handleMentionVisibilityToggle,
		handleToggleVisibilityWithExitFocus,
		handleToggleAllVisibilityWithExitFocus,
	} = useMentionActions({
		geoEvents: mapGeoEvents,
		resolvedCollectionResolver,
		handleZoomToBounds,
		zoomToDataset,
		getDatasetKey,
		isFocused,
		clearFocus,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
	})

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'

	// Desktop status bar + chat are passed to StudioShell as slots; the shell
	// owns the responsive frame (widths/insets from the --shell-* CSS vars).
	const statusBarSlot = (
		<StudioStatusBar
			mapRef={map}
			mapReady={mounted}
			sightingsCount={sightings.length}
			beaconsCount={beacons.length}
			onRelayClick={() => {
				setSettingsTab('relays')
				navigateToView('settings')
			}}
		/>
	)

	const chatSlot = (
		<AssistantSidebar
			open={desktopChatOpen}
			geoEvents={geoEvents}
			mapContextEvents={mapContextEvents}
			availableFeatures={availableFeatures}
			getDatasetName={getDatasetName}
			onStartNewDataset={startNewDataset}
			onSwitchWorkspace={switchToWorkspace}
			onOpenSettings={() => navigateToView('settings')}
			onClose={() => setChatOpen(false)}
		/>
	)

	// Mobile tool-strip overflow actions in PRIORITY order (extract to the strip
	// first as the screen grows; collapse into ••• as it shrinks). How many fit is
	// measured from the viewport width against the fixed strip content.
	const mobileOverflowActions = [
		{
			key: 'lock',
			label: panLocked ? 'Unlock pan while drawing' : 'Lock pan while drawing',
			icon: panLocked ? Lock : LockOpen,
			onClick: togglePanLock,
			active: panLocked,
			attention: isMobile && isDrawingMode && !panLocked,
		},
		{
			key: 'magnifier',
			label: magnifierEnabled ? 'Hide magnifier' : 'Show magnifier',
			icon: Search,
			onClick: toggleMagnifier,
			active: magnifierEnabled,
		},
		{
			key: 'snap',
			label: 'Toggle snapping',
			icon: Waypoints,
			onClick: () => executeEditorCommand('toggle_snapping'),
		},
		{ key: 'undo', label: 'Undo', icon: Undo2, onClick: () => executeEditorCommand('undo') },
		{ key: 'redo', label: 'Redo', icon: Redo2, onClick: () => executeEditorCommand('redo') },
		{
			key: 'export',
			label: 'Export GeoJSON',
			icon: Download,
			onClick: exportGeoJSON,
			disabled: stats.total === 0,
		},
		{
			key: 'clear',
			label: 'Clear draft',
			icon: Trash2,
			onClick: handleClear,
			disabled: stats.total === 0,
			danger: true,
		},
	] as const
	const stripHasFinish = currentMode === 'draw_linestring' || currentMode === 'draw_polygon'
	const overflowVisibleCount = (() => {
		if (!isMobile) return 0
		const ITEM_W = 42 // 36px button + 6px gap
		// Fixed strip content: px-2 padding + draw-tools group + the always-present
		// ••• menu + Publish + a Finish button (when drawing) + inter-item gaps.
		const fixed = 16 + 146 + 42 + 60 + 18 + (stripHasFinish ? 66 : 0)
		const available = viewportWidth - fixed
		const count = Math.floor(available / ITEM_W)
		return Math.max(0, Math.min(mobileOverflowActions.length, count))
	})()
	// The strip shows as many quick-access shortcut icons as fit; the full command
	// set always lives in the ••• MobileToolMenu regardless of what's extracted.
	const stripOverflowActions = mobileOverflowActions.slice(0, overflowVisibleCount)

	// Mobile browse-rail bundles — the self-subscribing entity lists rendered in the
	// bottom sheet (§14a). Mirror the desktop AppSidebar prop objects, but bound to
	// the raw GeoEditorView handlers (which surface the editor via the mobile 'edit'
	// tab through ensureInfoPanelVisible).
	const mobileSightingsPanelProps = {
		currentUserPubkey,
		onOpenSighting: handleInspectSighting,
		onCreateSighting: handleCreateSighting,
		onEditSighting: handleEditSighting,
		onDeleteSighting: handleDeleteSighting,
		onZoomToSighting: handleZoomToSighting,
		onAddToMapStack: addSightingToMapStack,
		deletingKey,
		selectedKey: lastInspectedSightingKey ?? null,
	}
	const mobileBeaconsPanelProps = {
		currentUserPubkey,
		onShareLocation: handleShareLocation,
		onOpenBeacon: handleInspectBeacon,
		onWatchOnMap: handleZoomToBeacon,
		onAddToMapStack: addBeaconToMapStack,
		onStopBeacon: () => handleStopBeacon(),
		onAdjustBeacon: handleAdjustBeacon,
		selectedKey: lastInspectedBeaconKey ?? null,
	}
	const mobileStoriesPanelProps = {
		currentUserPubkey,
		onOpenStory: handleInspectStory,
		onCreateStory: handleCreateStory,
		onEditStory: handleEditStory,
		onDeleteStory: handleDeleteStory,
		deletingKey,
	}
	const privateDatasetActions = {
		getDatasetKey,
		getDatasetName,
		onAddToMap: addPrivateDatasetToMapStack,
		onRemoveFromMap: removePrivateDatasetFromMapStack,
		onZoomTo: zoomToDataset,
		onLoadIntoEditor: handleDatasetSelect,
	}
	const fieldDatasetActions = {
		getDatasetKey,
		getDatasetName,
		onAddToMap: addFieldDatasetToMapStack,
		onRemoveFromMap: removeFieldDatasetFromMapStack,
		onZoomTo: zoomToDataset,
		onLoadIntoEditor: handleDatasetSelect,
	}

	// Entity editors are mutually exclusive: close any OTHER open editor before
	// starting a new one so a lingering editor (e.g. an unfinished Story) can't leak
	// into the next entity's surface (incl. the dataset draft's Map Stack editor).
	// `keep` names the entity being created — we must NOT close it: the create-handler
	// resets its own state, and for map-first entities (sighting/beacon) closing it
	// first would disarm the pin-drop (`editor.setMode('select')`) in the same tick as
	// the create arms it (`setMode('draw_point')`), which cancels the placement.
	const startCreate = (create: () => void, keep?: 'story' | 'context' | 'sighting' | 'beacon') => {
		if (keep !== 'story') handleCloseStoryEditor()
		if (keep !== 'context') handleCloseContextEditor()
		if (keep !== 'sighting') handleCloseSightingEditor()
		if (keep !== 'beacon') handleCloseBeaconControl()
		create()
	}
	return (
		<StudioShell
			mapContainerRef={mapContainerRef}
			statusBar={statusBarSlot}
			chat={chatSlot}
			sidebar={
				<AppSidebar
					geoEvents={scopedGeoEvents}
					mapContextEvents={mapContextEvents}
					activeDataset={activeDataset}
					currentUserPubkey={currentUserPubkey}
					datasetVisibility={effectiveVisibility}
					isPublishing={isPublishing}
					deletingKey={deletingKey}
					onLoadDataset={handleDatasetSelect}
					onStartNewDataset={startNewDataset}
					privateDatasetActions={privateDatasetActions}
					fieldDatasetActions={fieldDatasetActions}
					fieldSessionEvents={fieldTransport.events}
					onPublishFieldSessionEvent={fieldTransport.publishEvent}
					onRefreshFieldSessionEvents={fieldTransport.refresh}
					onSwitchWorkspace={switchToWorkspace}
					onDeleteWorkspace={deleteWorkspace}
					onAddDraftToWorkspace={createDraftInWorkspace}
					onToggleVisibility={handleToggleVisibilityWithExitFocus}
					onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
					onZoomToDataset={zoomToDataset}
					onAddDatasetToMap={addDatasetToMapStack}
					onRemoveDatasetFromMap={removeDatasetFromMapStack}
					onDeleteDataset={onDeleteDataset}
					onDeleteContext={onDeleteContext}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onOpenGeometryEditor={handleOpenGeometryEditor}
					onInspectDataset={handleInspectDatasetWithModeSwitch}
					onInspectContext={handleInspectContext}
					onOpenDebug={handleOpenDebug}
					onCreateContext={handleCreateContext}
					onEditContext={handleEditContext}
					isFocused={isFocused}
					onExitFocus={clearFocus}
					multiSelectModifier={multiSelectModifierLabel}
					// Editor panel props
					onCommentGeometryVisibility={handleCommentGeometryVisibility}
					onZoomToBounds={handleZoomToBounds}
					onZoomToSighting={handleZoomToSighting}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					isMentionVisible={isMentionVisible}
					contextEditorMode={contextEditorMode}
					editingContext={editingContext}
					onSaveContext={handleSaveContext}
					onCloseContextEditor={handleCloseContextEditor}
					storyEditorMode={storyEditorMode}
					editingStory={editingStory}
					onCreateStory={handleCreateStory}
					onInspectStory={handleInspectStory}
					onEditStory={handleEditStory}
					onSaveStory={handleSaveStory}
					onCloseStoryEditor={handleCloseStoryEditor}
					onDeleteStory={handleDeleteStory}
					onStoryUpdated={handleInspectStory}
					sightingEditorMode={sightingEditorMode}
					editingSighting={editingSighting}
					viewSighting={viewSighting}
					selectedSightingKey={lastInspectedSightingKey}
					sightingFocusCommentId={sightingFocusCommentId}
					beaconFocusCommentId={beaconFocusCommentId}
					placedSightingGeometry={placedSightingGeometry}
					onCreateSighting={handleCreateSighting}
					onInspectSighting={handleInspectSighting}
					onEditSighting={handleEditSighting}
					onSaveSighting={handleSaveSighting}
					onCloseSightingEditor={handleCloseSightingEditor}
					onDeleteSighting={handleDeleteSighting}
					onDrawSightingArea={handleDrawSightingArea}
					onClearSightingView={clearSightingView}
					beaconControlMode={beaconControlMode}
					adjustingBeacon={adjustingBeacon}
					viewBeacon={viewBeacon}
					isFollowingBeacon={isFollowingBeacon}
					onToggleFollowBeacon={toggleFollowBeacon}
					selectedBeaconKey={lastInspectedBeaconKey}
					beaconIsStarting={beaconSubState === 'searching' && !beaconIsLive}
					onShareLocation={handleShareLocation}
					onStartBeacon={handleStartBeacon}
					onCloseBeaconControl={handleCloseBeaconControl}
					onInspectBeacon={handleInspectBeacon}
					onWatchOnMapBeacon={handleZoomToBeacon}
					onAddBeaconToMapStack={addBeaconToMapStack}
					onAddSightingToMapStack={addSightingToMapStack}
					onStopBeacon={() => handleStopBeacon()}
					onAdjustBeacon={handleAdjustBeacon}
					onClearBeaconView={clearBeaconView}
					onZoomToFeature={handleZoomToFeature}
					onExitViewMode={exitViewMode}
					// Blossom upload props - callback adds blob ref to store, does NOT publish
					featureCollectionForUpload={memoizedFeatureCollection}
					onBlossomUploadComplete={handleBlobUploadComplete}
					// Contributor Group-attach publish wiring (GROUP-02/04)
					onPublishNew={handlePublishNew}
					canPublishNew={canPublishNew}
					// User profile props
					userPubkey={userPubkey}
					focusCommentId={focusCommentId}
					// Filter visibility sync
					onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
					onToggleProposalOverlay={handleToggleProposalOverlay}
					onProposalAccepted={handleProposalAccepted}
					visibleProposalIds={visibleProposalIds}
				/>
			}
		>
			<MapComponent
				className="w-full h-full touch-none"
				onLoad={(m) => {
					map.current = m
					setMounted(true)
					if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
						// Dev-only debug handle (pairs with __earthlyPool/__earthlyEventStore).
						;(window as unknown as Record<string, unknown>).__earthlyMap = m
					}
				}}
				mapSource={mapSource}
				onLocate={handleLocate}
				attributionCompact={!isMobile}
				// On mobile the bottom sheet + tool strip/dock occupy the lower edge,
				// so the control stack lives top-right (clear of the sheet at every
				// detent). Desktop keeps them bottom-right (thumb-free, above the status bar).
				controlsPosition={isMobile ? 'top-right' : 'bottom-right'}
				controlsChildren={
					!isMobile ? (
						<ControlGroup>
							<ControlButton
								onClick={() => setMapPopupsEnabled((current) => !current)}
								label={mapPopupsEnabled ? 'Disable map popups' : 'Enable map popups'}
							>
								{mapPopupsEnabled ? (
									<MessageSquare className="h-4 w-4" />
								) : (
									<MessageSquareOff className="h-4 w-4" />
								)}
							</ControlButton>
							<ControlButton
								onClick={() =>
									setMapPopupPlacement((current) => (current === 'geometry' ? 'dock' : 'geometry'))
								}
								label={
									mapPopupPlacement === 'geometry'
										? 'Dock popups in the top-right corner'
										: 'Show popups above geometry'
								}
								disabled={!mapPopupsEnabled}
							>
								{mapPopupPlacement === 'geometry' ? (
									<MapPinned className="h-4 w-4" />
								) : (
									<PanelTopOpen className="h-4 w-4" />
								)}
							</ControlButton>
						</ControlGroup>
					) : stance !== 'author' ? (
						// Mobile browse/inspect: desktop-toolbar parity actions (search,
						// location lookup, theme, share). Hidden while authoring — the
						// edit tool strip + MobileToolMenu own that surface.
						<MobileMapActions onSearchResultSelect={handleSearchResultSelect} />
					) : null
				}
			>
				<Editor />
			</MapComponent>
			{/* User location marker - pulsating blue dot */}
			<UserLocationMarker
				map={map.current}
				coordinates={userLocation}
				accuracy={userLocation?.accuracy}
			/>
			{/* Pin bubbles above sighting/beacon points: sighting primary photo,
			    beacon author avatar (SPEC §5.1/§6.1). Overlay only — the circle
			    layers in useMapLayers stay the hit/hover surface and fallback. */}
			<EntityPinBubbles
				mapRef={map}
				mounted={mounted}
				sightings={visibleSightingsFromStack}
				beacons={visibleBeaconsFromStack}
				onInspectSighting={handleInspectSighting}
				onInspectBeacon={handleInspectBeacon}
			/>
			{/* Amber preview of the Sighting geometry being placed/edited — the
			    transient draw feature is deleted after capture, so this is the only
			    thing on the map showing where the pin/area landed. */}
			<SightingPlacementPreview
				map={map.current}
				geometry={sightingEditorMode !== 'none' ? (placedSightingGeometry ?? null) : null}
				mapReady={mounted}
			/>
			<Magnifier
				enabled={magnifierEnabled}
				visible={magnifierVisible}
				position={magnifierPosition}
				center={magnifierCenter}
				mainMap={map.current}
				size={MAGNIFIER_SIZE}
				zoomOffset={magnifierZoomOffset}
			/>
			{/* Inspector Popup - appears near cursor when inspector is active */}
			<LocationInspectorPopup
				isOpen={inspectorActive && inspectorClickPosition !== null}
				loading={reverseLookupStatus === 'loading'}
				error={reverseLookupError}
				result={reverseLookupResult}
				clickPosition={inspectorClickPosition}
				containerRef={mapContainerRef}
				onClose={() => {
					setInspectorClickPosition(null)
					setReverseLookupResult(null)
					setReverseLookupError(null)
				}}
			/>
			{/* Feature Popup + remote geometry interaction handling */}
			<MapFeatureHoverOverlay
				mapRef={map}
				containerRef={mapContainerRef}
				remoteLayersReady={remoteLayersReady}
				clusteredSourceId={CLUSTERED_SOURCE_ID}
				geoEventsRef={geoEventsRef}
				currentUserPubkey={currentUser?.pubkey}
				getDatasetName={getDatasetName}
				handleInspectDatasetWithoutFocus={handleInspectDatasetWithoutFocus}
				sightingsRef={sightingsRef}
				onInspectSighting={handleInspectSighting}
				popupsEnabled={mapPopupsEnabled}
				placementMode={mapPopupPlacement}
				toolbarOffset={mapPopupToolbarOffset}
				suppressed={mapPopupPlacement === 'dock' && Boolean(displayedAnnotationPopupData)}
			/>
			{mapPopupsEnabled && (
				<CommentAnnotationPopup
					data={displayedAnnotationPopupData}
					containerRef={mapContainerRef}
					placementMode={mapPopupPlacement}
					toolbarOffset={mapPopupToolbarOffset}
					onHoverChange={handleAnnotationPopupHoverChange}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					onClose={handleCloseAnnotationPopup}
				/>
			)}
			{privateWorkspace ? (
				<div className="pointer-events-none absolute right-2 top-2 z-20 md:top-[calc(var(--shell-toolbar-h)+0.5rem)]">
					<div className="flex items-center gap-1.5 rounded-[2px] border border-primary/35 bg-background/95 px-2 py-1.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur">
						<Lock className="h-3 w-3 text-primary" />
						<span className="max-w-40 truncate">
							{privateWorkspace.metadata?.name ?? 'Private group'}
						</span>
						<span className="text-muted-foreground">· MLS-encrypted saves</span>
					</div>
				</div>
			) : null}
			{fieldSession ? (
				<div className="pointer-events-none absolute right-2 top-2 z-20 md:top-[calc(var(--shell-toolbar-h)+0.5rem)]">
					<div className="flex items-center gap-1.5 rounded-[2px] border border-emerald-500/35 bg-background/95 px-2 py-1.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur">
						<RadioTower className="h-3 w-3 text-emerald-600" />
						<span className="max-w-40 truncate">{fieldSession.name}</span>
						<span className="text-muted-foreground">
							· {fieldSession.internetPolicy === 'never' ? 'nearby only' : 'nearby now'}
						</span>
					</div>
				</div>
			) : null}
			{mapError && (
				<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-destructive/10 border border-destructive/40 text-destructive px-4 py-3 rounded z-50">
					<p className="font-bold">Map Error</p>
					<p>{mapError}</p>
				</div>
			)}
			{/* Map-first pin-drop overlay (Phase 11, D-01): shown while a Sighting
					    placement is armed. "Click the map to drop your sighting" + a
					    "Cancel placement" button (Esc is the keyboard alternative). */}
			{sightingPlacementArmed && (
				<div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
					<div className="pointer-events-auto flex items-center gap-3 rounded-none border border-border bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
						<span className="text-foreground">Click the map to drop your sighting</span>
						<button
							type="button"
							onClick={cancelSightingPlacement}
							className="rounded-none border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
						>
							Cancel placement
						</button>
					</div>
				</div>
			)}
			{/* Always-on "you are live" running banner (Phase 12, BEACON-02,
					    UI-SPEC § Net-New 3). Pinned over the map whenever a publisher
					    session is live, regardless of which panel is open — the one piece
					    of always-on chrome + a one-tap Stop. */}
			{beaconIsLive && (
				<RunningBeaconBanner
					subState={beaconSubState}
					countdown={beaconBannerCountdown}
					onStop={handleStopBeacon}
				/>
			)}
			{/* Desktop: map controls (zoom/compass/locate/pitch/globe/fullscreen
					    + the popup toggles via controlsChildren) live inside mapcn's
					    MapControls — see <MapComponent> above. */}
			{!isMobile && (
				<div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
					<div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-muted-foreground text-center pointer-events-auto">
						Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
						{selectionCount > 0 ? ` • ${selectionCount} selected` : ''}
					</div>
				</div>
			)}
			<div className="pointer-events-none absolute top-2 left-2 right-2 z-10 hidden md:pointer-events-auto md:fixed md:inset-x-0 md:top-0 md:z-30 md:flex md:h-[var(--shell-toolbar-h)] md:items-center md:border-b md:border-border md:bg-[var(--surface-chrome)] md:p-0">
				<div className="w-full">
					<Toolbar
						datasetActions={{
							onExportGeoJSON: exportGeoJSON,
							onExportSHP: exportSHP,
							canExport: stats.total > 0,
							onImport: handleImport,
							onClear: handleClear,
							onPublishNew: handlePublishNew,
							canPublishNew,
							onPublishUpdate: handlePublishUpdate,
							canPublishUpdate,
							onPublishCopy: handlePublishCopy,
							canPublishCopy,
							onProposeEdit: handleProposeEdit,
							canProposeEdit,
							publishMode: datasetPublishMode,
							isPublishing,
						}}
						isMobile={isMobile}
						showLogin={true}
						onSearchResultSelect={handleSearchResultSelect}
						onInspectorDeactivate={disableInspector}
						onStartNewDataset={startNewDataset}
						onCancelEditing={tearDownEditSession}
						onOsmQueryClick={handleOsmQueryClick}
						onOsmQueryView={handleOsmQueryView}
						onOsmAdvanced={() => setImportOsmDialogOpen(true)}
						mapStackOpen={toolbarMapStackOpen}
						mapStackEntryCount={mapStackStats.total}
						mapStackVisibleCount={mapStackStats.visible}
						chatOpen={desktopChatOpen}
						onToggleMapStack={toggleToolbarMapStack}
						onToggleChat={toggleChat}
						onExitFocus={exitViewMode}
					/>
				</div>
			</div>
			{!isMobile && desktopMapStackOpen && (
				<div className="pointer-events-auto absolute top-[var(--shell-mapstack-top)] left-2 z-20 flex max-h-[calc(100vh-5rem)] w-[var(--shell-mapstack-w)] max-w-[calc(100vw-1rem)] flex-col shadow-lg">
					<MapStackPanel
						geoEvents={scopedGeoEvents}
						mapContextEvents={mapContextEvents}
						getDatasetKey={getDatasetKey}
						getDatasetName={getDatasetName}
						onAddDatasetToMap={addDatasetToMapStack}
						onInspectDataset={handleInspectDatasetWithModeSwitch}
						onZoomToDataset={zoomToDataset}
						onLoadDataset={handleDatasetSelect}
						onInspectContext={handleInspectContext}
						onSetEntryVisible={setMapStackVisibility}
						onSetEntryIsolated={setMapStackIsolation}
						onRemoveEntry={removeFromMapStack}
						onOpenDraftEditor={openDraftEditor}
						onZoomToDraft={zoomToDraft}
						onClear={clearMapStackAndVisibility}
						onClose={() => setMapStackOpen(false)}
						compact
					/>
				</div>
			)}
			{/* Mobile Panel - unified tabbed drawer */}
			{isMobile && (
				<MobilePanel
					geoEvents={scopedGeoEvents}
					mapContextEvents={mapContextEvents}
					activeDataset={activeDataset}
					currentUserPubkey={currentUser?.pubkey}
					userPubkey={userPubkey}
					datasetVisibility={effectiveVisibility}
					isPublishing={isPublishing}
					deletingKey={deletingKey}
					isFocused={isFocused}
					multiSelectModifier={multiSelectModifierLabel}
					onLoadDataset={loadDatasetForEditing}
					onStartNewDataset={startNewDataset}
					privateDatasetActions={privateDatasetActions}
					fieldDatasetActions={fieldDatasetActions}
					fieldSessionEvents={fieldTransport.events}
					onPublishFieldSessionEvent={fieldTransport.publishEvent}
					onRefreshFieldSessionEvents={fieldTransport.refresh}
					onSwitchWorkspace={switchToWorkspace}
					onDeleteWorkspace={deleteWorkspace}
					onToggleVisibility={handleToggleVisibilityWithExitFocus}
					onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
					onZoomToDataset={zoomToDataset}
					onAddDatasetToMap={addDatasetToMapStack}
					onRemoveDatasetFromMap={removeDatasetFromMapStack}
					onSetMapStackEntryVisible={setMapStackVisibility}
					onSetMapStackEntryIsolated={setMapStackIsolation}
					onRemoveMapStackEntry={removeFromMapStack}
					onOpenDraftEditor={openDraftEditor}
					onZoomToDraft={zoomToDraft}
					onClearMapStack={clearMapStackAndVisibility}
					onDeleteDataset={onDeleteDataset}
					onDeleteContext={onDeleteContext}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onOpenGeometryEditor={handleOpenGeometryEditor}
					onInspectDataset={handleInspectDatasetWithModeSwitch}
					onExitFocus={clearFocus}
					onInspectContext={handleInspectContext}
					onCreateContext={handleCreateContext}
					onEditContext={handleEditContext}
					onOpenDebug={handleOpenDebug}
					onExitViewMode={exitViewMode}
					onCommentGeometryVisibility={handleCommentGeometryVisibility}
					onZoomToBounds={handleZoomToBounds}
					onZoomToSighting={handleZoomToSighting}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					isMentionVisible={isMentionVisible}
					contextEditorMode={contextEditorMode}
					editingContext={editingContext}
					onSaveContext={handleSaveContext}
					onCloseContextEditor={handleCloseContextEditor}
					storyEditorMode={storyEditorMode}
					editingStory={editingStory}
					onSaveStory={handleSaveStory}
					onCloseStoryEditor={handleCloseStoryEditor}
					onEditStory={handleEditStory}
					onDeleteStory={handleDeleteStory}
					onStoryUpdated={handleInspectStory}
					sightingEditorMode={sightingEditorMode}
					editingSighting={editingSighting}
					viewSighting={viewSighting}
					selectedSightingKey={lastInspectedSightingKey}
					sightingFocusCommentId={sightingFocusCommentId}
					beaconFocusCommentId={beaconFocusCommentId}
					placedSightingGeometry={placedSightingGeometry}
					onDrawSightingArea={handleDrawSightingArea}
					onSaveSighting={handleSaveSighting}
					onCloseSightingEditor={handleCloseSightingEditor}
					onEditSighting={handleEditSighting}
					onDeleteSighting={handleDeleteSighting}
					beaconControlMode={beaconControlMode}
					adjustingBeacon={adjustingBeacon}
					viewBeacon={viewBeacon}
					isFollowingBeacon={isFollowingBeacon}
					onToggleFollowBeacon={toggleFollowBeacon}
					selectedBeaconKey={lastInspectedBeaconKey}
					beaconIsStarting={beaconSubState === 'searching' && !beaconIsLive}
					onShareLocation={handleShareLocation}
					onStartBeacon={handleStartBeacon}
					onCloseBeaconControl={handleCloseBeaconControl}
					onInspectBeacon={handleInspectBeacon}
					onOpenBeacon={handleInspectBeacon}
					onWatchOnMapBeacon={handleZoomToBeacon}
					onAddBeaconToMapStack={addBeaconToMapStack}
					onAddSightingToMapStack={addSightingToMapStack}
					onStopBeacon={() => handleStopBeacon()}
					onAdjustBeacon={handleAdjustBeacon}
					onClearBeaconView={clearBeaconView}
					onZoomToFeature={handleZoomToFeature}
					featureCollectionForUpload={memoizedFeatureCollection}
					onBlossomUploadComplete={handleBlobUploadComplete}
					focusCommentId={focusCommentId}
					onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
					onToggleProposalOverlay={handleToggleProposalOverlay}
					onProposalAccepted={handleProposalAccepted}
					visibleProposalIds={visibleProposalIds}
					sightingsPanelProps={mobileSightingsPanelProps}
					beaconsPanelProps={mobileBeaconsPanelProps}
					storiesPanelProps={mobileStoriesPanelProps}
				/>
			)}
			{/* Mobile tool strip (redesign §14a Row 0) — pinned at the very bottom;
			    the sheet docks directly above it. Draw tools left, Publish right. */}
			{isMobile && stance === 'author' && (
				<div className="fixed inset-x-0 bottom-0 z-[60] flex min-h-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] items-center gap-1.5 border-t border-border bg-[var(--surface-chrome)] px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
					<div className="inline-flex shrink-0 overflow-hidden rounded-[2px] border border-border">
						{(
							[
								{ mode: 'select', icon: MousePointer2, label: 'Select / pan' },
								{ mode: 'draw_point', icon: MapPin, label: 'Draw point' },
								{ mode: 'draw_linestring', icon: Spline, label: 'Draw line' },
								{ mode: 'draw_polygon', icon: Hexagon, label: 'Draw polygon' },
							] as const
						).map((tool) => {
							const ToolIcon = tool.icon
							const active = currentMode === tool.mode
							return (
								<button
									key={tool.mode}
									type="button"
									onClick={() => executeEditorCommand('set_mode', { mode: tool.mode })}
									aria-label={tool.label}
									aria-pressed={active}
									title={tool.label}
									className={cn(
										'flex h-9 w-9 items-center justify-center transition-colors [&:not(:first-child)]:border-border [&:not(:first-child)]:border-l',
										active
											? 'bg-edit text-white'
											: 'bg-card text-muted-foreground hover:text-foreground',
									)}
								>
									<ToolIcon className="h-4 w-4" />
								</button>
							)
						})}
					</div>
					{/* Responsive overflow (§14a): items extract into the strip as the
					    screen grows (measured show-what-fits, priority: lock → snapping →
					    the rest) and collapse into ••• as it shrinks. */}
					{stripOverflowActions.map((action) => {
						const ActionIcon = action.icon
						return (
							<Button
								key={action.key}
								variant={'active' in action && action.active ? 'default' : 'ghost'}
								size="icon-sm"
								className={cn(
									'h-9 w-9 shrink-0 rounded-[2px]',
									'danger' in action && action.danger && 'hover:text-destructive',
									'attention' in action && action.attention && 'mobile-pan-lock-attention',
								)}
								onClick={action.onClick}
								disabled={'disabled' in action ? action.disabled : false}
								aria-label={action.label}
								title={action.label}
							>
								<ActionIcon className="h-4 w-4" />
							</Button>
						)
					})}
					{/* ••• — the full desktop authoring toolbar (Draw / Edit / Geometry
					    ops / File / Publish) in one menu. Always present; the strip icons
					    above are just responsive fast-access shortcuts. */}
					<MobileToolMenu
						panLocked={panLocked}
						panLockAttention={isDrawingMode && !panLocked}
						panLockTriggerAttention={isDrawingMode && !panLocked && overflowVisibleCount === 0}
						onTogglePanLock={togglePanLock}
						magnifierEnabled={magnifierEnabled}
						onToggleMagnifier={toggleMagnifier}
						onExportGeoJSON={exportGeoJSON}
						onExportSHP={exportSHP}
						onImport={handleImport}
						onClear={handleClear}
						onCancelEditing={tearDownEditSession}
						canExport={stats.total > 0}
						canClear={stats.total > 0}
						onPublishUpdate={handlePublishUpdate}
						canPublishUpdate={canPublishUpdate}
						onPublishCopy={handlePublishCopy}
						canPublishCopy={canPublishCopy}
						onProposeEdit={handleProposeEdit}
						canProposeEdit={canProposeEdit}
						isPublishing={isPublishing}
						publishMode={datasetPublishMode}
						onOsmClick={handleOsmQueryClick}
						onOsmView={handleOsmQueryView}
						onOsmAdvanced={() => setImportOsmDialogOpen(true)}
					/>
					{currentMode === 'draw_linestring' || currentMode === 'draw_polygon' ? (
						<Button
							size="sm"
							className="h-9 shrink-0 rounded-[2px]"
							onClick={() => editor?.finishDrawing()}
							disabled={!canFinishDrawing}
						>
							Finish
						</Button>
					) : null}
					<div className="min-w-0 flex-1" />
					<Button
						size="sm"
						className="h-9 shrink-0 rounded-[2px] bg-primary text-primary-foreground hover:bg-primary/90"
						onClick={handlePublishNew}
						disabled={!canPublishNew}
					>
						{datasetPublishMode === 'public' ? 'Publish' : 'Save'}
					</Button>
				</div>
			)}
			{/* Map-first mobile dock. Navigation opens horizontally; map-bound work
			    opens vertically. Create remains the additive center action. */}
			{isMobile && stance !== 'author' && (
				<nav
					aria-label="Primary"
					data-tour="mobile-dock"
					className="fixed inset-x-0 bottom-0 z-[60] flex min-h-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] items-stretch justify-around border-t border-border bg-[var(--surface-chrome)] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
				>
					<button
						type="button"
						onClick={() => (mobileSidebarOpen ? closeMobileSidebar() : openMobileSidebar())}
						aria-pressed={mobileSidebarOpen}
						data-tour="mobile-dock-menu"
						className={cn(
							'flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] transition-colors',
							mobileSidebarOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
						)}
					>
						<Menu className="h-5 w-5" />
						Menu
					</button>
					<button
						type="button"
						onClick={() => setMobileSearchOpen(true)}
						data-tour="mobile-dock-search"
						className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<Search className="h-5 w-5" />
						Search
					</button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label="Create"
								data-tour="mobile-create"
								className="flex flex-1 flex-col items-center justify-center"
							>
								<span className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-primary text-primary-foreground shadow-sm">
									<Plus className="h-5 w-5" />
								</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent side="top" align="center" className="w-52">
							<DropdownMenuLabel>Create</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => startCreate(startNewDataset)}>
								<Database className="h-4 w-4" />
								Dataset
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => startCreate(handleCreateContext, 'context')}>
								<Globe className="h-4 w-4" />
								Context
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => startCreate(handleCreateStory, 'story')}>
								<BookOpen className="h-4 w-4" />
								Story
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => startCreate(handleCreateSighting, 'sighting')}>
								<Eye className="h-4 w-4" />
								Sighting
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => startCreate(handleShareLocation, 'beacon')}>
								<Radio className="h-4 w-4" />
								Live beacon
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<button
						type="button"
						onClick={toggleToolbarMapStack}
						aria-pressed={toolbarMapStackOpen}
						data-tour="mobile-dock-map-stack"
						className={cn(
							'flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] transition-colors',
							toolbarMapStackOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
						)}
					>
						<Layers className="h-5 w-5" />
						Map stack
					</button>
					<button
						type="button"
						onClick={() => {
							closeMobileSidebar()
							setMobilePanelOpen(false)
							setMobileSearchOpen(false)
						}}
						data-tour="mobile-dock-map"
						className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<MapIcon className="h-5 w-5" />
						Map
					</button>
				</nav>
			)}
			{debugEvent && (
				<DebugDialog event={debugEvent} open={debugDialogOpen} onOpenChange={setDebugDialogOpen} />
			)}
			{/* Blossom Upload Dialog */}
			;
			<BlossomUploadDialog
				open={blossomUploadDialogOpen}
				onOpenChange={setBlossomUploadDialogOpen}
				geojson={pendingPublishCollection ?? memoizedFeatureCollection}
				onUploadComplete={handleBlobUploadComplete}
				onPublishWithUpload={handlePublishWithBlossomUpload}
				onSkip={handlePublishNew}
				allowSkip={false}
				title="Dataset Size Warning"
			/>
			{/* Import OSM Dialog */}
			;
			<ImportOsmDialog
				open={importOsmDialogOpen}
				onOpenChange={setImportOsmDialogOpen}
				mapCenter={
					map.current
						? (() => {
								const center = map.current.getCenter()
								return { lat: center.lat, lon: center.lng }
							})()
						: undefined
				}
				mapBounds={
					map.current
						? (() => {
								const bounds = map.current.getBounds()
								return {
									west: bounds.getWest(),
									south: bounds.getSouth(),
									east: bounds.getEast(),
									north: bounds.getNorth(),
								}
							})()
						: undefined
				}
				onImport={(features) => {
					if (!editor) return
					// INFRA-02 / D-08: route through the Authoring API (normalizes raw
					// features internally via toEditorFeature; append with dedup-by-id).
					createAuthoring(editor).writeGeoJSON(features, { replace: false })
				}}
			/>
			{/* OSM Query Results Panel (cursor-oriented) */}
			;<OsmResultsPanel onImport={handleOsmImport} onClose={clearOsmQuery} />
		</StudioShell>
	)
}
