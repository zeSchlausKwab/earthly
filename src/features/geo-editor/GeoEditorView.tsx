import { useActiveAccount } from 'applesauce-react/hooks'
import {
	Layers,
	Lock,
	LockOpen,
	MapPinned,
	MessageSquare,
	MessageSquareOff,
	PanelTopOpen,
	Search,
} from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AppSidebar } from '@/components/AppSidebar'
import { ControlButton, ControlGroup } from '@/components/ui/map'
import { BlossomUploadDialog } from '@/components/BlossomUploadDialog'
import { DebugDialog } from '@/components/DebugDialog'
import { MapStackPanel } from '@/components/MapStackPanel'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useAvailableGeoFeatures } from '@/lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useGeoDatasets, useMapContexts } from '@/lib/hooks/useGeoDatasets'
import { useGroups } from '@/lib/hooks/useGroups'
import { useStories } from '@/lib/hooks/useStories'
import { nip19 } from 'nostr-tools'
import type { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { deleteStory } from '@/lib/nostr/story'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { type MapContext, deleteMapContext } from '@/lib/nostr/map-context'
import { accounts } from '@/lib/nostr'
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
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MapFeatureHoverOverlay } from './components/MapFeatureHoverOverlay'
import { BrowseLandingPrompt } from './components/BrowseLandingPrompt'
import { MobilePanel } from './components/MobilePanel'
import { CommentAnnotationPopup } from './components/CommentAnnotationPopup'
import type { CommentAnnotationPopupData } from './components/CommentAnnotationPopup'
import type { MapPopupPlacement } from './components/map-popup-positioning'
import { UserLocationMarker } from './components/UserLocationMarker'
import { GeoEditorMap as MapComponent } from './components/map'
import { OsmResultsPanel } from './components/OsmResultsPanel'
import { Toolbar } from './components/Toolbar'
import type { EditorFeature } from './core'
import {
	MAGNIFIER_SIZE,
	useBlobResolution,
	useContextEditor,
	useStoryEditor,
	useCommentGeometry,
	useProposalGeometry,
	useDatasetManagement,
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
import { useEditorStore, type MapStackEntry } from './store'
import type { GeoSearchResult } from './types'
import { ensureFeatureCollection, extractCollectionMeta, toEditorFeature } from './utils'

export function GeoEditorView() {
	const map = useRef<maplibregl.Map | null>(null)
	const [mounted, setMounted] = useState(false)
	const [mapError, _setMapError] = useState<string | null>(null)
	const [deletingKey, setDeletingKey] = useState<string | null>(null)
	const [resolvedCollectionsVersion, setResolvedCollectionsVersion] = useState(0)
	const [mapPopupsEnabled, setMapPopupsEnabled] = useState(true)
	const [mapPopupPlacement, setMapPopupPlacement] = useState<MapPopupPlacement>('dock')
	const [desktopMapStackOpen, setDesktopMapStackOpen] = useState(true)
	const [desktopChatOpen, setDesktopChatOpen] = useState(false)

	// Drawing mode state
	const [isDrawingMode] = useState(false)
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
	// Mobile Tools/Search/Actions toggles are no longer used — the responsive
	// toolbar replaces them. Store fields stay for backward compat.
	const panLocked = useEditorStore((state) => state.panLocked)
	const setPanLocked = useEditorStore((state) => state.setPanLocked)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const currentMode = useEditorStore((state) => state.mode)
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
	const { events: mapContextEvents } = useMapContexts()
	// Groups (kind 37518, slimmed) the contributor can `c`-attach to (GROUP-02).
	const { events: groups } = useGroups()
	// Stories (kind 37520) — used to resolve a /stories/story/:naddr deep link to the
	// Article cast so the focus-route effect can open it (Phase 10, D-04).
	const { events: stories } = useStories()
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
	} = useDatasetManagement(map, geoEvents)

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
			removeMapStackEntry(entry.id)
		},
		[removeMapStackEntry, tearDownEditSession],
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
		clearMapStack()
	}, [clearMapStack])

	// Round C.4: cold-start auto-populate. On Browse with an empty stack, drop
	// in the most recent N datasets so the user doesn't land on a blank map.
	// One-shot per page load (guarded by ref) so a manual Clear stays cleared.
	const stance = useEditorStore((state) => state.stance)
	// Round E.2: the cold-start auto-seed became an explicit landing prompt.
	// Dismissal is session-local; the prompt re-appears after a manual Clear
	// (empty stack again) unless dismissed.
	const [browseLandingDismissed, setBrowseLandingDismissed] = useState(false)
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
				.filter((entry) => entry.entityType !== 'draft')
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
	const seedRecentDatasets = useCallback(() => {
		const SEED_COUNT = 5
		const seeded = [...geoEvents]
			.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
			.slice(0, SEED_COUNT)
		for (const event of seeded) {
			addDatasetToMapStack(event, 'browse-default')
		}
	}, [geoEvents, addDatasetToMapStack])
	const showBrowseLandingPrompt =
		stance === 'browse' &&
		stackUrlHydrated &&
		!browseLandingDismissed &&
		mapStackOrder.length === 0 &&
		geoEvents.length > 0

	// Store state for viewMode
	const viewMode = useEditorStore((state) => state.viewMode)

	// Blossom upload dialog state
	const blossomUploadDialogOpen = useEditorStore((state) => state.blossomUploadDialogOpen)
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const pendingPublishCollection = useEditorStore((state) => state.pendingPublishCollection)

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

	// Routing hook for URL-based focus mode
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
		commentId: focusCommentId,
	} = useRouting()

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
		geoEvents,
		onEnsureInfoPanelVisible: ensureInfoPanelVisible,
		onNavigateToFocus: navigateTo,
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
		if (!mapFilterContext || !mapFilterContextCoordinate) return geoEvents
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
		geoEvents,
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
			return geoEvents.filter((event) => isolatedKeys.has(getDatasetKey(event)))
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
		return geoEvents
			.filter((event) => rankByKey.has(getDatasetKey(event)))
			.sort(
				(a, b) => (rankByKey.get(getDatasetKey(a)) ?? 0) - (rankByKey.get(getDatasetKey(b)) ?? 0),
			)
	}, [geoEvents, getDatasetKey, mapStackEntries, mapStackOrder, mapContextEvents])

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
		setDesktopMapStackOpen((open) => !open)
	}, [isMobile, mobilePanelOpen, mobilePanelTab, openMobilePanel, setMobilePanelOpen])

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
		if (!viewingDataset) return geoEvents
		if (geoEvents.some((ev) => ev.id === viewingDataset.id)) return geoEvents
		return [...geoEvents, viewingDataset]
	}, [geoEvents, viewingDataset])

	const availableFeatures = useAvailableGeoFeatures(
		geoEventsForMentions,
		resolvedCollectionResolver,
		mapContextEvents,
	)

	// Map layers hook
	const { remoteLayersReady, CLUSTERED_SOURCE_ID } = useMapLayers({
		mapRef: map,
		mounted,
		visibleGeoEvents,
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

	// Pan lock sync with drawing mode
	useEffect(() => {
		const shouldLock = isDrawingMode
		setPanLocked(shouldLock)
		if (editor) {
			editor.setPanLocked(shouldLock)
		}
	}, [isDrawingMode, editor, setPanLocked])

	// Round D.3: the "sync default visibility on geoEvents change" effect
	// is gone — visibility is no longer a separate sticky map. Stack
	// membership is the canonical signal; events that aren't on the stack
	// simply aren't rendered, regardless of how many datasets land in the
	// subscription. This drops O(geoEvents) work on every relay update too.

	// Initialize mobile/desktop UI
	const closeMobilePanel = useEditorStore((state) => state.closeMobilePanel)
	useEffect(() => {
		if (isMobile) {
			closeMobilePanel()
			setShowToolbar(false)
			setShowTips(false)
		} else {
			setShowDatasetsPanel(true)
			setShowInfoPanel(true)
			setShowToolbar(true)
			setShowTips(true)
		}
	}, [isMobile, closeMobilePanel, setShowTips, setShowDatasetsPanel, setShowInfoPanel])

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
			const text = e.clipboardData?.getData('text/plain')
			if (!text) return

			try {
				const json = JSON.parse(text)
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
		if (geoEvents.length === 0 && mapContextEvents.length === 0 && stories.length === 0) return

		if (route.focusType === 'geoevent') {
			// Find the dataset matching the naddr
			const dataset = geoEvents.find((event) => {
				const eventNaddr = encodeGeoEventNaddr(event)
				return eventNaddr === route.naddr
			})
			if (dataset) {
				addDatasetToMapStack(dataset, 'route')
				handleInspectDataset(dataset)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'mapcontext') {
			const context = mapContextEvents.find((ctx) => encodeContextNaddr(ctx) === route.naddr)
			if (context) {
				handleInspectContext(context)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'story') {
			const story = stories.find((s) => encodeStoryNaddr(s) === route.naddr)
			if (story) {
				handleInspectStory(story)
				focusHandledRef.current = routeKey
			}
		}
	}, [
		route.focusType,
		route.naddr,
		geoEvents,
		mapContextEvents,
		stories,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		encodeStoryNaddr,
		addDatasetToMapStack,
		handleInspectDataset,
		handleInspectContext,
		handleInspectStory,
	])

	// Pan lock and magnifier
	const togglePanLock = useCallback(() => {
		if (!editor) return
		if (isDrawingMode) return
		const next = !panLocked
		editor.setPanLocked(next)
		setPanLocked(next)
	}, [editor, isDrawingMode, panLocked, setPanLocked])

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
		geoEvents,
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
	const sidebarExpanded = useEditorStore((state) => state.sidebarExpanded)
	const setSidebarExpanded = useEditorStore((state) => state.setSidebarExpanded)
	// Size the desktop sidebar from its own expand state — NOT the chat-open
	// state. Previously this returned undefined whenever chat was closed, so
	// `--sidebar-width` fell back to the 16rem default (content panel ~13rem,
	// far too narrow) and the Expand/Shrink button was a no-op unless chat
	// happened to be open.
	const desktopShellStyle = useMemo<CSSProperties | undefined>(() => {
		if (isMobile) return undefined
		return {
			'--sidebar-width': sidebarExpanded ? '32vw' : '25vw',
		} as CSSProperties
	}, [isMobile, sidebarExpanded])

	return (
		<SidebarProvider
			sidebarExpanded={sidebarExpanded}
			onExpandedChange={setSidebarExpanded}
			style={desktopShellStyle}
		>
			{/* Sidebar - desktop only */}
			{!isMobile && (
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
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
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
			)}

			<SidebarInset>
				<div
					ref={mapContainerRef}
					data-tour="map-canvas"
					className="relative h-screen w-full"
					style={{ height: '100dvh', minHeight: '100svh' }}
				>
					<MapComponent
						className="w-full h-full touch-none"
						onLoad={(m) => {
							map.current = m
							setMounted(true)
						}}
						mapSource={mapSource}
						onLocate={handleLocate}
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
											setMapPopupPlacement((current) =>
												current === 'geometry' ? 'dock' : 'geometry',
											)
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

					{mapError && (
						<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
							<p className="font-bold">Map Error</p>
							<p>{mapError}</p>
						</div>
					)}

					{/* Desktop: map controls (zoom/compass/locate/pitch/globe/fullscreen
					    + the popup toggles via controlsChildren) live inside mapcn's
					    MapControls — see <MapComponent> above. */}

					{!isMobile && (
						<div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
							<div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-gray-500 text-center pointer-events-auto">
								Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
								{selectionCount > 0 ? ` • ${selectionCount} selected` : ''}
							</div>
						</div>
					)}

					<div className="absolute top-2 left-2 right-2 z-10 pointer-events-none flex">
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
								onToggleChat={() => setDesktopChatOpen((open) => !open)}
								onExitFocus={exitViewMode}
							/>
						</div>
					</div>

					{showBrowseLandingPrompt ? (
						<BrowseLandingPrompt
							onShowNewest={seedRecentDatasets}
							onBrowseDatasets={() => {
								// Browsing is a choice too — dismiss so the prompt doesn't
								// linger behind the opened catalog.
								setBrowseLandingDismissed(true)
								navigateToView('datasets')
							}}
							onBrowseContexts={() => {
								setBrowseLandingDismissed(true)
								navigateToView('contexts')
							}}
							onStartDrawing={startNewDataset}
							onDismiss={() => setBrowseLandingDismissed(true)}
						/>
					) : null}

					{!isMobile && desktopMapStackOpen && (
						<div className="pointer-events-auto absolute top-14 left-2 z-20 w-80 max-w-[calc(100vw-1rem)] shadow-lg">
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
								onClose={() => setDesktopMapStackOpen(false)}
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
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={handleMentionVisibilityToggle}
							onMentionZoomTo={handleMentionZoomTo}
							contextEditorMode={contextEditorMode}
							editingContext={editingContext}
							onSaveContext={handleSaveContext}
							onCloseContextEditor={handleCloseContextEditor}
							onEditStory={handleEditStory}
							onDeleteStory={handleDeleteStory}
							onZoomToFeature={handleZoomToFeature}
							featureCollectionForUpload={memoizedFeatureCollection}
							onBlossomUploadComplete={handleBlobUploadComplete}
							focusCommentId={focusCommentId}
							onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
							onToggleProposalOverlay={handleToggleProposalOverlay}
							onProposalAccepted={handleProposalAccepted}
							visibleProposalIds={visibleProposalIds}
						/>
					)}

					{isMobile && (
						<>
							<div className="fixed bottom-2 left-2 z-50 md:hidden">
								<div className="flex gap-2">
									{/* Locate now lives in mapcn's MapControls (top-level of the map). */}
									<Button
										variant={panLocked ? 'default' : 'outline'}
										className="shadow-lg h-10 w-10 p-0 rounded-full bg-white/95 backdrop-blur hover:bg-white"
										onClick={togglePanLock}
										aria-label="Toggle pan lock while drawing"
										disabled={isDrawingMode}
										title={isDrawingMode ? 'Pan is auto-locked while drawing' : 'Toggle pan lock'}
									>
										{panLocked ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}
									</Button>
									{(currentMode === 'draw_linestring' || currentMode === 'draw_polygon') && (
										<Button
											variant="default"
											className="shadow-lg h-10 px-4 rounded-full"
											onClick={() => editor?.finishDrawing()}
											aria-label="Finish current drawing"
											disabled={!canFinishDrawing}
										>
											Finish
										</Button>
									)}
									<div className="relative">
										<Button
											ref={magnifierButtonRef}
											variant={magnifierEnabled ? 'default' : 'outline'}
											className="shadow-lg h-10 w-10 p-0 rounded-full"
											onPointerDown={handleMagnifierPointerDown}
											onPointerUp={handleMagnifierPointerUp}
											onPointerLeave={clearMagnifierLongPress}
											onPointerCancel={clearMagnifierLongPress}
											onContextMenu={(event) => event.preventDefault()}
											aria-label="Toggle magnifier"
										>
											<Search className="h-5 w-5" />
										</Button>
										{magnifierMenuOpen && (
											<div
												ref={magnifierMenuRef}
												className="pointer-events-auto absolute bottom-14 left-0 z-50 w-52 rounded-xl border border-gray-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
											>
												<div className="mb-3 text-xs font-medium text-gray-600">Magnifier zoom</div>
												<div className="flex items-center gap-3">
													<Button
														type="button"
														variant="outline"
														size="icon"
														className="h-8 w-8 text-sm"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.max(1, value - 0.5))
														}
														aria-label="Decrease magnifier zoom"
													>
														-
													</Button>
													<Input
														type="range"
														min={1}
														max={6}
														step={0.5}
														value={magnifierZoomOffset}
														onChange={(event) => setMagnifierZoomOffset(Number(event.target.value))}
														className="h-2 w-full"
														aria-label="Magnifier zoom level"
													/>
													<Button
														type="button"
														variant="outline"
														size="icon"
														className="h-8 w-8 text-sm"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.min(6, value + 0.5))
														}
														aria-label="Increase magnifier zoom"
													>
														+
													</Button>
												</div>
												<div className="mt-2 text-xs text-gray-500">
													Zoom +{magnifierZoomOffset}
												</div>
											</div>
										)}
									</div>
								</div>
							</div>
							{/* Mobile drawer toggle (MobilePanel bottom-sheet). The old
							    Draw/Search/Actions toggles are gone — the unified responsive
							    toolbar (with overflow-x-auto on narrow screens) replaces
							    them. */}
							<div
								className={`fixed bottom-2 right-2 z-50 flex flex-col gap-2 md:hidden transition-all duration-300 ${
									mobilePanelOpen
										? mobilePanelSnap === 'expanded'
											? 'bottom-[calc(82vh+0.5rem)]'
											: 'bottom-[calc(45vh+0.5rem)]'
										: ''
								}`}
							>
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobilePanelOpen ? 'default' : 'outline'}
									onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
									aria-label="Toggle panel"
								>
									<Layers className="h-5 w-5" />
								</Button>
							</div>
						</>
					)}

					{debugEvent && (
						<DebugDialog
							event={debugEvent}
							open={debugDialogOpen}
							onOpenChange={setDebugDialogOpen}
						/>
					)}

					{/* Blossom Upload Dialog */}
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
					<OsmResultsPanel onImport={handleOsmImport} onClose={clearOsmQuery} />
				</div>
			</SidebarInset>
			{!isMobile && desktopChatOpen && (
				<AssistantSidebar
					geoEvents={geoEvents}
					mapContextEvents={mapContextEvents}
					availableFeatures={availableFeatures}
					getDatasetName={getDatasetName}
					onStartNewDataset={startNewDataset}
					onSwitchWorkspace={switchToWorkspace}
					onOpenSettings={() => navigateToView('settings')}
					onClose={() => setDesktopChatOpen(false)}
				/>
			)}
		</SidebarProvider>
	)
}
