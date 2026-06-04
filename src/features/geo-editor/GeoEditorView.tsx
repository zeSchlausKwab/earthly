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
import { AssistantSidebar } from './components/AssistantSidebar'
import { Editor } from './components/Editor'
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MapFeatureHoverOverlay } from './components/MapFeatureHoverOverlay'
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

	const { handleCommentGeometryVisibility, annotationPopupData, setAnnotationPopupData } =
		useCommentGeometry(map, mounted)
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
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const contextMapScopeMode = useEditorStore((state) => state.contextMapScopeMode)
	const setContextMapScopeMode = useEditorStore((state) => state.setContextMapScopeMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const editIsolationEnabled = useEditorStore((state) => state.editIsolationEnabled)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)
	const clearMapStack = useEditorStore((state) => state.clearMapStack)
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)
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
		clearEditingSession,
		startNewDataset,
		cancelEditing,
	} = useDatasetManagement(map, geoEvents)

	const addDatasetToMapStack = useCallback(
		(event: GeoDataset, source: 'manual' | 'route' = 'manual') => {
			const datasetKey = getDatasetKey(event)
			addMapStackEntry({
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source,
				visible: true,
				pinned: false,
			})
			setDatasetVisibility((prev) => ({
				...prev,
				[datasetKey]: true,
			}))
			if (source === 'manual') {
				toast.success(`Added "${getDatasetName(event)}" to the map.`)
			}
		},
		[addMapStackEntry, getDatasetKey, getDatasetName, setDatasetVisibility],
	)

	const setMapStackVisibility = useCallback(
		(entry: MapStackEntry, visible: boolean) => {
			setMapStackEntryVisible(entry.id, visible)
			if (entry.entityType === 'dataset') {
				setDatasetVisibility((prev) => ({
					...prev,
					[entry.entityKey]: visible,
				}))
			}
		},
		[setDatasetVisibility, setMapStackEntryVisible],
	)

	const removeFromMapStack = useCallback(
		(entry: MapStackEntry) => {
			removeMapStackEntry(entry.id)
			if (entry.entityType === 'dataset') {
				setDatasetVisibility((prev) => ({
					...prev,
					[entry.entityKey]: false,
				}))
			}
		},
		[removeMapStackEntry, setDatasetVisibility],
	)

	const clearMapStackAndVisibility = useCallback(() => {
		const datasetKeys = mapStackOrder
			.map((entryId) => mapStackEntries[entryId])
			.filter((entry): entry is MapStackEntry => Boolean(entry))
			.filter((entry) => entry.entityType === 'dataset')
			.map((entry) => entry.entityKey)
		clearMapStack()
		if (datasetKeys.length > 0) {
			setDatasetVisibility((prev) => {
				const next = { ...prev }
				datasetKeys.forEach((key) => {
					next[key] = false
				})
				return next
			})
		}
	}, [clearMapStack, mapStackEntries, mapStackOrder, setDatasetVisibility])

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
		mapContexts: mapContextEvents,
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

	// Track filtered dataset keys from sidebar filter (for map visibility sync)
	const [filteredDatasetKeys, setFilteredDatasetKeys] = useState<Set<string> | null>(null)
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

	const activeContextScopeLabel = useMemo(() => {
		if (!contextNaddr) return null
		if (activeContextScope) {
			return (
				activeContextScope.context.name ||
				activeContextScope.contextId ||
				activeContextScope.id ||
				'Context scope'
			)
		}
		return `Context ${contextNaddr.slice(0, 12)}…`
	}, [activeContextScope, contextNaddr])

	const focusedContext = useMemo(() => {
		if (focusedType !== 'mapcontext' || !focusedNaddr) return null
		return (
			mapContextEvents.find((context) => {
				const contextNaddr = encodeContextNaddr(context)
				return contextNaddr === focusedNaddr
			}) ?? null
		)
	}, [focusedType, focusedNaddr, mapContextEvents, encodeContextNaddr])

	const focusedDataset = useMemo(() => {
		if (focusedType !== 'geoevent' || !focusedNaddr) return null
		return (
			geoEvents.find((event) => {
				const eventNaddr = encodeGeoEventNaddr(event)
				return eventNaddr === focusedNaddr
			}) ?? null
		)
	}, [focusedType, focusedNaddr, geoEvents, encodeGeoEventNaddr])

	const toolbarFocusLabel = useMemo(() => {
		if (!focusedNaddr || !focusedType) return null
		if (focusedType === 'mapcontext') {
			if (contextNaddr && focusedNaddr === contextNaddr) return null
			return focusedContext
				? focusedContext.context.name ||
						focusedContext.contextId ||
						focusedContext.id ||
						'Focused context'
				: `Context ${focusedNaddr.slice(0, 12)}...`
		}
		return focusedDataset
			? getDatasetName(focusedDataset)
			: `Dataset ${focusedNaddr.slice(0, 12)}...`
	}, [focusedNaddr, focusedType, contextNaddr, focusedContext, focusedDataset, getDatasetName])

	const toolbarFocusKind =
		focusedType === 'geoevent' ? 'dataset' : focusedType === 'mapcontext' ? 'context' : null

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
	const visibleMapStackDatasetKeys = useMemo(() => {
		const keys = new Set<string>()
		mapStackOrder.forEach((entryId) => {
			const entry = mapStackEntries[entryId]
			if (entry?.entityType === 'dataset' && entry.visible) {
				keys.add(entry.entityKey)
			}
		})
		return keys
	}, [mapStackEntries, mapStackOrder])
	const mapStackHasDatasetEntries = useMemo(
		() => mapStackOrder.some((entryId) => mapStackEntries[entryId]?.entityType === 'dataset'),
		[mapStackEntries, mapStackOrder],
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

	// Visible geo events based on visibility toggle, focus mode, AND filter state
	const visibleGeoEvents = useMemo(() => {
		if (viewMode === 'edit' && editIsolationEnabled) {
			return []
		}

		const activeContextDatasetKeys = new Set(
			activeContextDatasets.map((event) => getDatasetKey(event)),
		)

		const isAllowedByContextScope = (event: GeoDataset) => {
			if (!mapFilterContextCoordinate || !mapFilterContext) return true
			if (!activeContextDatasetKeys.has(getDatasetKey(event))) return false
			if (mapFilterContext.context.contextUse === 'taxonomy') return true
			const validation = activeContextValidationByDatasetKey.get(getDatasetKey(event))
			if (!validation) {
				return contextFilterMode !== 'strict'
			}
			return isDatasetAllowedByContextFilter(validation, contextFilterMode)
		}

		// Helper: check if event passes visibility + filter criteria
		const isEventVisible = (event: GeoDataset, includeSidebarFilter = true) => {
			const key = getDatasetKey(event)
			if (mapStackHasDatasetEntries && !visibleMapStackDatasetKeys.has(key)) return false
			// Must be marked visible
			if (datasetVisibility[key] === false) return false
			// Must pass active context scope (if one is set)
			if (!isAllowedByContextScope(event)) return false
			// Must pass filter (if filter is active)
			if (includeSidebarFilter && filteredDatasetKeys !== null && !filteredDatasetKeys.has(key)) {
				return false
			}
			return true
		}

		// If in focused mode, filter to show only the focused item(s)
		if (focusedNaddr && focusedType) {
			if (focusedType === 'geoevent') {
				// Find the single dataset that matches the naddr
				const dataset = geoEvents.find((event) => {
					const eventNaddr = encodeGeoEventNaddr(event)
					return eventNaddr === focusedNaddr
				})
				return dataset && isEventVisible(dataset, false) ? [dataset] : []
			} else if (focusedType === 'mapcontext' && mapFilterContext) {
				const attachedVisible = activeContextDatasets.filter((event) =>
					isEventVisible(event, false),
				)
				if (mapFilterContext.context.contextUse === 'taxonomy') {
					return attachedVisible
				}

				return attachedVisible.filter((event) => {
					const validation = activeContextValidationByDatasetKey.get(getDatasetKey(event))
					if (!validation) {
						return contextFilterMode !== 'strict'
					}
					return isDatasetAllowedByContextFilter(validation, contextFilterMode)
				})
			}
		}
		// Default: filter by visibility toggles AND sidebar filter
		return geoEvents.filter((event) => isEventVisible(event, true))
	}, [
		geoEvents,
		datasetVisibility,
		getDatasetKey,
		focusedNaddr,
		focusedType,
		encodeGeoEventNaddr,
		mapFilterContext,
		activeContextDatasets,
		mapFilterContextCoordinate,
		activeContextValidationByDatasetKey,
		contextFilterMode,
		filteredDatasetKeys,
		viewMode,
		editIsolationEnabled,
		mapStackHasDatasetEntries,
		visibleMapStackDatasetKeys,
	])

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

	// Effective visibility for sidebar - shows actual visibility state including focus mode
	const effectiveVisibility = useMemo(() => {
		// When focused, only focused items are visible
		if (focusedNaddr && focusedType) {
			const effectiveMap: Record<string, boolean> = {}
			const visibleKeys = new Set(visibleGeoEvents.map((e) => getDatasetKey(e)))
			geoEvents.forEach((event) => {
				const key = getDatasetKey(event)
				effectiveMap[key] = visibleKeys.has(key)
			})
			return effectiveMap
		}
		if (mapStackHasDatasetEntries) {
			const effectiveMap: Record<string, boolean> = {}
			geoEvents.forEach((event) => {
				const key = getDatasetKey(event)
				effectiveMap[key] = visibleMapStackDatasetKeys.has(key) && datasetVisibility[key] !== false
			})
			return effectiveMap
		}
		// Default: use actual visibility state
		return datasetVisibility
	}, [
		geoEvents,
		visibleGeoEvents,
		datasetVisibility,
		getDatasetKey,
		focusedNaddr,
		focusedType,
		mapStackHasDatasetEntries,
		visibleMapStackDatasetKeys,
	])

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

	// Sync default dataset visibility
	useEffect(() => {
		setDatasetVisibility((prev) => {
			const next: Record<string, boolean> = {}
			let changed = false

			geoEvents.forEach((event) => {
				const key = getDatasetKey(event)
				const value = prev[key] === undefined ? true : prev[key]
				next[key] = value
				if (prev[key] !== value) changed = true
			})

			if (Object.keys(prev).length !== Object.keys(next).length) changed = true
			return changed ? next : prev
		})
	}, [geoEvents, getDatasetKey, setDatasetVisibility])

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
				newFeatures.forEach((f) => {
					editor.addFeature(f as EditorFeature)
				})
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
				await handleDeleteDataset(event, clearEditingSession)
			} finally {
				setDeletingKey(null)
			}
		},
		[getDatasetKey, handleDeleteDataset, clearEditingSession],
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

				newFeatures.forEach((f) => {
					editor.addFeature(f as EditorFeature)
				})

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
		clearEditorModes,
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
		if (geoEvents.length === 0 && mapContextEvents.length === 0) return

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
		}
	}, [
		route.focusType,
		route.naddr,
		geoEvents,
		mapContextEvents,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		addDatasetToMapStack,
		handleInspectDataset,
		handleInspectContext,
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
	const desktopShellStyle = useMemo<CSSProperties | undefined>(() => {
		if (isMobile || !desktopChatOpen) return undefined
		return {
			'--sidebar-width': sidebarExpanded ? '32vw' : '25vw',
		} as CSSProperties
	}, [desktopChatOpen, isMobile, sidebarExpanded])

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
					onDeleteDataset={onDeleteDataset}
					onDeleteContext={onDeleteContext}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onOpenGeometryEditor={handleOpenGeometryEditor}
					onClearEntityEditors={clearEditorModes}
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
					onZoomToFeature={handleZoomToFeature}
					onExitViewMode={exitViewMode}
					// Blossom upload props - callback adds blob ref to store, does NOT publish
					featureCollectionForUpload={memoizedFeatureCollection}
					onBlossomUploadComplete={handleBlobUploadComplete}
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
								onCancelEditing={cancelEditing}
								onOsmQueryClick={handleOsmQueryClick}
								onOsmQueryView={handleOsmQueryView}
								onOsmAdvanced={() => setImportOsmDialogOpen(true)}
								mapStackOpen={toolbarMapStackOpen}
								mapStackEntryCount={mapStackStats.total}
								mapStackVisibleCount={mapStackStats.visible}
								chatOpen={desktopChatOpen}
								contextScopeLabel={activeContextScopeLabel}
								focusLabel={toolbarFocusLabel}
								focusKind={toolbarFocusKind}
								onToggleMapStack={toggleToolbarMapStack}
								onToggleChat={() => setDesktopChatOpen((open) => !open)}
								onClearContextScope={contextNaddr ? clearContextScope : undefined}
								onClearFocus={focusedNaddr ? clearFocus : undefined}
							/>
						</div>
					</div>

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
								onRemoveEntry={removeFromMapStack}
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
							onSetMapStackEntryVisible={setMapStackVisibility}
							onRemoveMapStackEntry={removeFromMapStack}
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
							features.forEach((feature) => {
								editor.addFeature(toEditorFeature(feature))
							})
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
