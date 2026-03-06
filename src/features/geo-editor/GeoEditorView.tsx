import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import { Edit3, Globe, Layers, Lock, LockOpen, Search, UploadCloud, X } from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppSidebar } from '@/components/AppSidebar'
import { BlossomUploadDialog } from '@/components/BlossomUploadDialog'
import { DebugDialog } from '@/components/DebugDialog'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useAvailableGeoFeatures } from '@/lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useGeoCollections, useMapContexts, useStations } from '@/lib/hooks/useStations'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
import {
	defaultContextFilterMode,
	getContextCoordinate,
	isDatasetAllowedByContextFilter,
	validateDatasetForContext,
} from '@/lib/context/validation'
import { Editor } from './components/Editor'
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocateButton } from './components/LocateButton'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MapFeatureHoverOverlay } from './components/MapFeatureHoverOverlay'
import { MobilePanel } from './components/MobilePanel'
import { UserLocationMarker } from './components/UserLocationMarker'
import { GeoEditorMap as MapComponent } from './components/Map'
import { OsmResultsPanel } from './components/OsmResultsPanel'
import { Toolbar } from './components/Toolbar'
import type { EditorFeature } from './core'
import {
	MAGNIFIER_SIZE,
	useBlobResolution,
	useCollectionContextEditor,
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
import { useEditorStore } from './store'
import type { GeoSearchResult } from './types'
import { ensureFeatureCollection, extractCollectionMeta, toEditorFeature } from './utils'

export function GeoEditorView() {
	const map = useRef<maplibregl.Map | null>(null)
	const [mounted, setMounted] = useState(false)
	const [mapError, _setMapError] = useState<string | null>(null)
	const [deletingKey, setDeletingKey] = useState<string | null>(null)
	const [resolvedCollectionsVersion, setResolvedCollectionsVersion] = useState(0)

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

	const { handleCommentGeometryVisibility } = useCommentGeometry(map)
	const { visibleProposalIds, handleToggleProposalOverlay } = useProposalGeometry(map)

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

	// Collection visibility state (local to view)
	const [collectionVisibility, setCollectionVisibility] = useState<Record<string, boolean>>({})

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
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewContextCollections = useEditorStore((state) => state.setViewContextCollections)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setShowTips = useEditorStore((state) => state.setShowTips)
	// Unified mobile panel state
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	// Mobile toolbar state (for upper toolbar sections)
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const setMobileToolsOpen = useEditorStore((state) => state.setMobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const setMobileSearchOpen = useEditorStore((state) => state.setMobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const setMobileActionsOpen = useEditorStore((state) => state.setMobileActionsOpen)
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
	const { events: geoEvents } = useStations([{ limit: 50 }])
	const { events: collectionEvents } = useGeoCollections([{ limit: 50 }])
	const { events: mapContextEvents } = useMapContexts([{ limit: 100 }])
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const isMobile = useIsMobile()

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
		zoomToCollection,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		switchToWorkspace,
		deleteWorkspace,
		clearEditingSession,
		startNewDataset,
		cancelEditing,
	} = useDatasetManagement(map, geoEvents)

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
		ndk: ndk ?? undefined,
		currentUserPubkey: currentUser?.pubkey,
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
		encodeCollectionNaddr,
		encodeContextNaddr,
		isFocused,
		contextNaddr,
		contextCoordinate,
		userPubkey,
	} = useRouting()

	const {
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleInspectCollection,
		handleOpenDebug,
	} = useViewMode({
		geoEvents,
		onEnsureInfoPanelVisible: ensureInfoPanelVisible,
		onNavigateToFocus: navigateTo,
		onClearRouteFocus: clearFocus,
		onZoomToDataset: zoomToDataset,
		onZoomToCollection: zoomToCollection,
	})

	// Store focus state
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)

	// Track filtered dataset keys from sidebar filter (for map visibility sync)
	const [filteredDatasetKeys, setFilteredDatasetKeys] = useState<Set<string> | null>(null)
	const handleFilteredDatasetKeysChange = useCallback((keys: Set<string>) => {
		setFilteredDatasetKeys(new Set(keys))
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

	const activeContext = activeContextScope ?? focusedContext
	const activeContextCoordinate = useMemo(() => {
		if (activeContextScope && contextCoordinate) return contextCoordinate
		if (!activeContext) return null
		return getContextCoordinate(activeContext)
	}, [activeContext, activeContextScope, contextCoordinate])

	const activeContextAttachedDatasets = useMemo(() => {
		if (!activeContextCoordinate) return []
		return geoEvents.filter((event) => event.contextReferences.includes(activeContextCoordinate))
	}, [geoEvents, activeContextCoordinate])

	const activeContextReferenceCollections = useMemo(() => {
		if (!activeContextCoordinate) return []
		return collectionEvents.filter((collection) =>
			collection.contextReferences.includes(activeContextCoordinate),
		)
	}, [collectionEvents, activeContextCoordinate])

	const validationModeForActiveContext = contextFilterMode === 'off' ? 'warn' : contextFilterMode

	const activeContextValidationByDatasetKey = useMemo(() => {
		const map = new Map<string, ReturnType<typeof validateDatasetForContext>>()
		if (!activeContext || !activeContextCoordinate) return map
		if (activeContext.context.contextUse === 'taxonomy') return map

		activeContextAttachedDatasets.forEach((event) => {
			const collection = resolvedCollectionResolver(event) ?? event.featureCollection
			map.set(
				getDatasetKey(event),
				validateDatasetForContext(event, activeContext, collection, validationModeForActiveContext),
			)
		})

		return map
	}, [
		activeContext,
		activeContextCoordinate,
		activeContextAttachedDatasets,
		resolvedCollectionResolver,
		getDatasetKey,
		validationModeForActiveContext,
	])

	const scopedGeoEvents = useMemo(() => {
		if (!activeContext || !activeContextCoordinate) return geoEvents
		if (activeContext.context.contextUse === 'taxonomy') {
			return activeContextAttachedDatasets
		}
		return activeContextAttachedDatasets.filter((event) => {
			const key = getDatasetKey(event)
			const validation = activeContextValidationByDatasetKey.get(key)
			if (!validation) {
				return contextFilterMode !== 'strict'
			}
			return isDatasetAllowedByContextFilter(validation, contextFilterMode)
		})
	}, [
		activeContext,
		activeContextCoordinate,
		activeContextAttachedDatasets,
		activeContextValidationByDatasetKey,
		getDatasetKey,
		contextFilterMode,
		geoEvents,
	])

	const scopedCollectionEvents = useMemo(() => {
		if (!activeContextCoordinate) return collectionEvents
		return activeContextReferenceCollections
	}, [activeContextCoordinate, activeContextReferenceCollections, collectionEvents])

	// Visible geo events based on visibility toggle, focus mode, AND filter state
	const visibleGeoEvents = useMemo(() => {
		const isAllowedByContextScope = (event: NDKGeoEvent) => {
			if (!activeContextCoordinate || !activeContext) return true
			if (!event.contextReferences.includes(activeContextCoordinate)) return false
			if (activeContext.context.contextUse === 'taxonomy') return true
			const validation = activeContextValidationByDatasetKey.get(getDatasetKey(event))
			if (!validation) {
				return contextFilterMode !== 'strict'
			}
			return isDatasetAllowedByContextFilter(validation, contextFilterMode)
		}

		// Helper: check if event passes visibility + filter criteria
		const isEventVisible = (event: NDKGeoEvent, includeSidebarFilter = true) => {
			const key = getDatasetKey(event)
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
			} else if (focusedType === 'collection') {
				// Find the collection and return its referenced datasets
				const collection = collectionEvents.find((col) => {
					const colNaddr = encodeCollectionNaddr(col)
					return colNaddr === focusedNaddr
				})
				if (!collection) return []
				const references = new Set(collection.datasetReferences)
				return geoEvents.filter((event) => {
					const datasetId = event.datasetId ?? event.dTag ?? event.id
					if (!datasetId) return false
					const coordinate = `${event.kind ?? GEO_EVENT_KIND}:${event.pubkey}:${datasetId}`
					const inCollection = references.has(coordinate)
					if (!inCollection) return false

					// Also respect visibility toggle and active scope constraints
					return isEventVisible(event, false)
				})
			} else if (focusedType === 'mapcontext' && activeContext) {
				const attachedVisible = activeContextAttachedDatasets.filter((event) =>
					isEventVisible(event, false),
				)
				if (activeContext.context.contextUse === 'taxonomy') {
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
		collectionEvents,
		datasetVisibility,
		getDatasetKey,
		focusedNaddr,
		focusedType,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		activeContext,
		activeContextAttachedDatasets,
		activeContextCoordinate,
		activeContextValidationByDatasetKey,
		contextFilterMode,
		filteredDatasetKeys,
	])

	const lastContextCoordinateRef = useRef<string | null>(null)
	useEffect(() => {
		if (!activeContext) {
			lastContextCoordinateRef.current = null
			setViewContext(null)
			setViewContextDatasets([])
			setViewContextCollections([])
			return
		}

		const coordinate = getContextCoordinate(activeContext)
		setViewContext(activeContext)
		setViewContextDatasets(activeContextAttachedDatasets)
		setViewContextCollections(activeContextReferenceCollections)

		if (coordinate && lastContextCoordinateRef.current !== coordinate) {
			lastContextCoordinateRef.current = coordinate
			setContextFilterMode(defaultContextFilterMode(activeContext))
		}
	}, [
		activeContext,
		activeContextAttachedDatasets,
		activeContextReferenceCollections,
		setViewContext,
		setViewContextDatasets,
		setViewContextCollections,
		setContextFilterMode,
	])

	// Auto-attach scope context for fresh geometry creation only.
	useEffect(() => {
		if (activeDataset) return
		if (features.length > 0) return

		if (activeContextCoordinate) {
			if (
				activeDatasetContextRefs.length === 1 &&
				activeDatasetContextRefs[0] === activeContextCoordinate
			) {
				return
			}
			setActiveDatasetContextRefs([activeContextCoordinate])
			return
		}

		if (activeDatasetContextRefs.length > 0) {
			setActiveDatasetContextRefs([])
		}
	}, [
		activeDataset,
		features.length,
		activeContextCoordinate,
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
		// Default: use actual visibility state
		return datasetVisibility
	}, [geoEvents, visibleGeoEvents, datasetVisibility, getDatasetKey, focusedNaddr, focusedType])

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

	// Initial zoom to latest geometry on app load
	const initialZoomPerformed = useRef(false)
	useEffect(() => {
		if (initialZoomPerformed.current || !map.current || !mounted) return

		// Only perform initial zoom if we're on the home route (no focus, no context scope)
		if (route.focusType !== 'none' || route.contextNaddr) return

		if (geoEvents.length === 0) return

		// Sort events by creation time (descending)
		const sortedEvents = [...geoEvents].sort((a, b) => {
			return (b.created_at || 0) - (a.created_at || 0)
		})

		const latestEvent = sortedEvents[0]
		if (!latestEvent) return

		const performZoom = async () => {
			try {
				const col = latestEvent.featureCollection
				if (!col) return

				const turf = await import('@turf/turf')
				const bbox = turf.bbox(col)

				if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
					map.current?.fitBounds(
						[
							[bbox[0], bbox[1]],
							[bbox[2], bbox[3]],
						],
						{ padding: 100, duration: 1500, maxZoom: 16 },
					)
					initialZoomPerformed.current = true
				}
			} catch (err) {
				console.warn('Failed to auto-zoom to latest event:', err)
			}
		}

		performZoom()
	}, [geoEvents, mounted, route])

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
	const handleDatasetSelect = (event: NDKGeoEvent) => {
		handleLoadDatasetForEditing(event)
	}

	const handleClear = useCallback(() => {
		if (!editor) return
		const all = editor.getAllFeatures()
		editor.deleteFeatures(all.map((f) => f.id))
		setSelectedFeatureIds([])
	}, [editor, setSelectedFeatureIds])

	const onDeleteDataset = useCallback(
		async (event: NDKGeoEvent) => {
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

	// Export/Import
	const exportGeoJSON = useCallback(() => {
		if (!editor) return

		const geojson = {
			type: 'FeatureCollection',
			features: editor.getAllFeatures(),
		}

		const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = 'features.geojson'
		a.click()
		URL.revokeObjectURL(url)
	}, [editor])

	const handleImport = useCallback(
		async (file: File) => {
			if (!editor) return
			const text = await file.text()
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

				const meta = extractCollectionMeta(collection)
				if (meta) setCollectionMeta(meta)
			} catch (e) {
				console.error('Failed to import GeoJSON:', e)
				alert('Failed to import GeoJSON')
			}
		},
		[editor, setCollectionMeta],
	)

	// OSM Query hook
	const { handleOsmQueryClick, handleOsmQueryView, handleOsmImport, clearOsmQuery } = useOsmQuery(
		map,
		editor,
	)

	// Collection & Context Editor hooks
	const {
		collectionEditorMode,
		editingCollection,
		contextEditorMode,
		editingContext,
		handleCreateCollection,
		handleEditCollection,
		handleSaveCollection,
		handleCloseCollectionEditor,
		handleLoadDatasetForEditing,
		handleInspectContext,
		handleCreateContext,
		handleEditContext,
		handleSaveContext,
		handleCloseContextEditor,
		handleOpenGeometryEditor,
		handleInspectDatasetWithModeSwitch,
		handleInspectCollectionWithModeSwitch,
	} = useCollectionContextEditor({
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
		handleInspectCollection,
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
		if (geoEvents.length === 0 && collectionEvents.length === 0 && mapContextEvents.length === 0)
			return

		if (route.focusType === 'geoevent') {
			// Find the dataset matching the naddr
			const dataset = geoEvents.find((event) => {
				const eventNaddr = encodeGeoEventNaddr(event)
				return eventNaddr === route.naddr
			})
			if (dataset) {
				handleInspectDataset(dataset)
				focusHandledRef.current = routeKey
			}
		} else if (route.focusType === 'collection') {
			// Find the collection matching the naddr
			const collection = collectionEvents.find((col) => {
				const colNaddr = encodeCollectionNaddr(col)
				return colNaddr === route.naddr
			})
			if (collection) {
				handleInspectCollection(collection, [])
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
		collectionEvents,
		mapContextEvents,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		encodeContextNaddr,
		handleInspectDataset,
		handleInspectCollection,
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

	// Get collection key for visibility tracking
	const getCollectionKey = useCallback((collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}, [])

	// Toggle collection visibility
	const handleToggleCollectionVisibility = useCallback(
		(collection: NDKGeoCollectionEvent) => {
			const key = getCollectionKey(collection)
			setCollectionVisibility((prev) => ({
				...prev,
				[key]: prev[key] === false,
			}))
		},
		[getCollectionKey],
	)

	// Toggle all collection visibility
	const handleToggleAllCollectionVisibility = useCallback(
		(visible: boolean) => {
			setCollectionVisibility(() => {
				const next: Record<string, boolean> = {}
				collectionEvents.forEach((collection) => {
					const key = getCollectionKey(collection)
					next[key] = visible
				})
				return next
			})
		},
		[collectionEvents, getCollectionKey],
	)

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'
	const sidebarExpanded = useEditorStore((state) => state.sidebarExpanded)
	const setSidebarExpanded = useEditorStore((state) => state.setSidebarExpanded)

	return (
		<SidebarProvider sidebarExpanded={sidebarExpanded} onExpandedChange={setSidebarExpanded}>
			{/* Sidebar - desktop only */}
			{!isMobile && (
				<AppSidebar
					geoEvents={scopedGeoEvents}
					collectionEvents={scopedCollectionEvents}
					mapContextEvents={mapContextEvents}
					activeDataset={activeDataset}
					currentUserPubkey={currentUser?.pubkey}
					datasetVisibility={effectiveVisibility}
					collectionVisibility={collectionVisibility}
					isPublishing={isPublishing}
					deletingKey={deletingKey}
					onClearEditing={clearEditingSession}
					onLoadDataset={handleDatasetSelect}
					onStartNewDataset={startNewDataset}
					onSwitchWorkspace={switchToWorkspace}
					onDeleteWorkspace={deleteWorkspace}
					onToggleVisibility={handleToggleVisibilityWithExitFocus}
					onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
					onToggleCollectionVisibility={handleToggleCollectionVisibility}
					onToggleAllCollectionVisibility={handleToggleAllCollectionVisibility}
					onZoomToDataset={zoomToDataset}
					onDeleteDataset={onDeleteDataset}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onOpenGeometryEditor={handleOpenGeometryEditor}
					onZoomToCollection={zoomToCollection}
					onInspectDataset={handleInspectDatasetWithModeSwitch}
					onInspectCollection={handleInspectCollectionWithModeSwitch}
					onInspectContext={handleInspectContext}
					onOpenDebug={handleOpenDebug}
					onCreateCollection={handleCreateCollection}
					onCreateContext={handleCreateContext}
					onEditCollection={handleEditCollection}
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
					collectionEditorMode={collectionEditorMode}
					editingCollection={editingCollection}
					onSaveCollection={handleSaveCollection}
					onCloseCollectionEditor={handleCloseCollectionEditor}
					contextEditorMode={contextEditorMode}
					editingContext={editingContext}
					onSaveContext={handleSaveContext}
					onCloseContextEditor={handleCloseContextEditor}
					onZoomToFeature={handleZoomToFeature}
					onExitViewMode={exitViewMode}
					// Blossom upload props - callback adds blob ref to store, does NOT publish
					featureCollectionForUpload={memoizedFeatureCollection}
					onBlossomUploadComplete={handleBlobUploadComplete}
					ndk={ndk}
					// User profile props
					userPubkey={userPubkey}
					// Filter visibility sync
					onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
					onToggleProposalOverlay={handleToggleProposalOverlay}
					visibleProposalIds={visibleProposalIds}
				/>
			)}

			<SidebarInset>
				<div
					ref={mapContainerRef}
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
					/>

					{mapError && (
						<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
							<p className="font-bold">Map Error</p>
							<p>{mapError}</p>
						</div>
					)}

					{/* Desktop: Floating locate button */}
					{!isMobile && (
						<div className="absolute bottom-12 right-4 z-10">
							<LocateButton onLocate={handleLocate} />
						</div>
					)}

					{!isMobile && (
						<div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
							<div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-gray-500 text-center pointer-events-auto">
								Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
								{selectionCount > 0 ? ` • ${selectionCount} selected` : ''}
							</div>
						</div>
					)}

					{mounted && editor && (
						<div className="absolute top-2 left-2 right-2 z-10 pointer-events-none flex">
							<div className="w-full">
								<Toolbar
									datasetActions={{
										onExport: exportGeoJSON,
										canExport: stats.total > 0,
										onImport: handleImport,
										onClear: handleClear,
										onPublishNew: handlePublishNew,
										canPublishNew,
										onPublishUpdate: handlePublishUpdate,
										canPublishUpdate,
										onPublishCopy: handlePublishCopy,
										canPublishCopy,
										onProposeEdit: () => {
											const description = prompt('Describe your proposed changes:')
											if (description) {
												handleProposeEdit(description)
											}
										},
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
								/>
							</div>
						</div>
					)}

					{contextNaddr && activeContextScopeLabel && (
						<div
							className={`absolute left-2 right-2 z-20 pointer-events-none flex justify-center ${
								mounted && editor ? 'top-16' : 'top-3'
							}`}
						>
							<div className="pointer-events-auto inline-flex max-w-[min(90vw,520px)] items-center gap-2 rounded-full border border-sky-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur">
								<Globe className="h-3.5 w-3.5 text-sky-700 shrink-0" />
								<span className="truncate text-xs font-medium text-sky-900">
									{activeContextScopeLabel}
								</span>
								<button
									type="button"
									onClick={clearContextScope}
									aria-label="Leave context scope"
									className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-700 hover:bg-sky-100"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					)}

					{/* Mobile Panel - unified tabbed drawer */}
					{isMobile && (
						<MobilePanel
							geoEvents={scopedGeoEvents}
							collectionEvents={scopedCollectionEvents}
							mapContextEvents={mapContextEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUser?.pubkey}
							userPubkey={userPubkey}
							datasetVisibility={effectiveVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							isFocused={isFocused}
							multiSelectModifier={multiSelectModifierLabel}
							onClearEditing={clearEditingSession}
							onLoadDataset={loadDatasetForEditing}
							onStartNewDataset={startNewDataset}
							onSwitchWorkspace={switchToWorkspace}
							onDeleteWorkspace={deleteWorkspace}
							onToggleVisibility={handleToggleVisibilityWithExitFocus}
							onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
							onZoomToDataset={zoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onOpenGeometryEditor={handleOpenGeometryEditor}
							onInspectDataset={handleInspectDatasetWithModeSwitch}
							onExitFocus={clearFocus}
							onToggleCollectionVisibility={handleToggleCollectionVisibility}
							onToggleAllCollectionVisibility={handleToggleAllCollectionVisibility}
							onZoomToCollection={zoomToCollection}
							onInspectCollection={handleInspectCollectionWithModeSwitch}
							onInspectContext={handleInspectContext}
							onCreateCollection={handleCreateCollection}
							onCreateContext={handleCreateContext}
							onEditCollection={handleEditCollection}
							onEditContext={handleEditContext}
							onOpenDebug={handleOpenDebug}
							onExitViewMode={exitViewMode}
							onCommentGeometryVisibility={handleCommentGeometryVisibility}
							onZoomToBounds={handleZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={handleMentionVisibilityToggle}
							onMentionZoomTo={handleMentionZoomTo}
							collectionEditorMode={collectionEditorMode}
							editingCollection={editingCollection}
							onSaveCollection={handleSaveCollection}
							onCloseCollectionEditor={handleCloseCollectionEditor}
							contextEditorMode={contextEditorMode}
							editingContext={editingContext}
							onSaveContext={handleSaveContext}
							onCloseContextEditor={handleCloseContextEditor}
							onZoomToFeature={handleZoomToFeature}
							featureCollectionForUpload={memoizedFeatureCollection}
							onBlossomUploadComplete={handleBlobUploadComplete}
							ndk={ndk}
							onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
							onToggleProposalOverlay={handleToggleProposalOverlay}
							visibleProposalIds={visibleProposalIds}
						/>
					)}

					{isMobile && (
						<>
							<div className="fixed bottom-2 left-2 z-50 md:hidden">
								<div className="flex gap-2">
									<LocateButton onLocate={handleLocate} />
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
													<button
														type="button"
														className="h-8 w-8 rounded-md border border-gray-200 text-sm text-gray-700"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.max(1, value - 0.5))
														}
														aria-label="Decrease magnifier zoom"
													>
														-
													</button>
													<input
														type="range"
														min={1}
														max={6}
														step={0.5}
														value={magnifierZoomOffset}
														onChange={(event) => setMagnifierZoomOffset(Number(event.target.value))}
														className="h-2 w-full"
														aria-label="Magnifier zoom level"
													/>
													<button
														type="button"
														className="h-8 w-8 rounded-md border border-gray-200 text-sm text-gray-700"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.min(6, value + 0.5))
														}
														aria-label="Increase magnifier zoom"
													>
														+
													</button>
												</div>
												<div className="mt-2 text-xs text-gray-500">
													Zoom +{magnifierZoomOffset}
												</div>
											</div>
										)}
									</div>
								</div>
							</div>
							{/* Mobile buttons - positioned to move up when drawer is open */}
							<div
								className={`fixed bottom-2 right-2 z-50 flex flex-col gap-2 md:hidden transition-all duration-300 ${
									mobilePanelOpen
										? mobilePanelSnap === 'expanded'
											? 'bottom-[calc(82vh+0.5rem)]'
											: 'bottom-[calc(45vh+0.5rem)]'
										: ''
								}`}
							>
								{/* Draw tools toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileToolsOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileSearchOpen(false)
										setMobileActionsOpen(false)
										setMobileToolsOpen(!mobileToolsOpen)
									}}
									aria-label="Toggle draw tools"
								>
									<Edit3 className="h-5 w-5" />
								</Button>
								{/* Search tools toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileSearchOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileToolsOpen(false)
										setMobileActionsOpen(false)
										setMobileSearchOpen(!mobileSearchOpen)
									}}
									aria-label="Toggle search"
								>
									<Search className="h-5 w-5" />
								</Button>
								{/* Actions toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileActionsOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileToolsOpen(false)
										setMobileSearchOpen(false)
										setMobileActionsOpen(!mobileActionsOpen)
									}}
									aria-label="Toggle actions"
								>
									<UploadCloud className="h-5 w-5" />
								</Button>
								{/* Panel toggle */}
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
						ndk={ndk}
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
		</SidebarProvider>
	)
}
