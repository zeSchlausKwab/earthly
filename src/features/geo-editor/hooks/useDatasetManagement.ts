import { coordAll } from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import maplibregl from 'maplibre-gl'
import { useCallback, useRef } from 'react'
import { useChatStore } from '@/features/chat'
import { resolveGeoEventFeatureCollection } from '@/lib/geo/resolveBlobReferences'
import type { GeoDataset, GeoBlobReference } from '@/lib/nostr/geo-event'
import { useEditorStore } from '../store'
import type { EditorBlobReference } from '../types'
import {
	convertGeoEventsToEditorFeatures,
	convertGeoEventsToFeatureCollection,
	createDefaultCollectionMeta,
	extractCollectionMeta,
} from '../utils'

interface ResolvedCache {
	eventId?: string | null
	featureCollection: FeatureCollection
}

function createBlankDraftSourceId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `session:${crypto.randomUUID()}`
	}
	return `session:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getCollectionName(collection: FeatureCollection): string | undefined {
	const maybeName = (collection as FeatureCollection & { name?: unknown }).name
	return typeof maybeName === 'string' ? maybeName : undefined
}

function getCollectionBbox(
	collection: FeatureCollection | undefined,
): [number, number, number, number] | undefined {
	if (!collection) return undefined
	const rawBbox = (collection as FeatureCollection & { bbox?: unknown }).bbox
	if (!Array.isArray(rawBbox) || rawBbox.length !== 4) return undefined
	const [west, south, east, north] = rawBbox
	if (
		!Number.isFinite(west) ||
		!Number.isFinite(south) ||
		!Number.isFinite(east) ||
		!Number.isFinite(north)
	) {
		return undefined
	}
	return [west, south, east, north]
}

export function useDatasetManagement(
	mapRef: React.MutableRefObject<maplibregl.Map | null>,
	geoEvents: GeoDataset[],
) {
	const resolvedCollectionsRef = useRef<Map<string, ResolvedCache>>(new Map())
	const isMountedRef = useRef(true)
	const geoEventsRef = useRef<GeoDataset[]>([])

	// Keep ref in sync
	geoEventsRef.current = geoEvents

	// Store actions
	const editor = useEditorStore((state) => state.editor)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setActiveDataset = useEditorStore((state) => state.setActiveDataset)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const setNewCollectionProp = useEditorStore((state) => state.setNewCollectionProp)
	const setNewFeatureProp = useEditorStore((state) => state.setNewFeatureProp)
	const setPublishMessage = useEditorStore((state) => state.setPublishMessage)
	const setPublishError = useEditorStore((state) => state.setPublishError)
	const setBlobReferences = useEditorStore((state) => state.setBlobReferences)
	const setBlobPreviewCollection = useEditorStore((state) => state.setBlobPreviewCollection)
	const setPreviewingBlobReferenceId = useEditorStore((state) => state.setPreviewingBlobReferenceId)
	const setBlobDraftUrl = useEditorStore((state) => state.setBlobDraftUrl)
	const setBlobDraftStatus = useEditorStore((state) => state.setBlobDraftStatus)
	const setBlobDraftError = useEditorStore((state) => state.setBlobDraftError)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const setStance = useEditorStore((state) => state.setStance)
	const setViewDataset = useEditorStore((state) => state.setViewDataset)
	const setDatasetResolving = useEditorStore((state) => state.setDatasetResolving)
	const setDatasetResolvingProgress = useEditorStore((state) => state.setDatasetResolvingProgress)
	const setActiveGeoEditDraftId = useEditorStore((state) => state.setActiveGeoEditDraftId)
	const createGeoEditDraft = useEditorStore((state) => state.createGeoEditDraft)
	const loadGeoEditDraft = useEditorStore((state) => state.loadGeoEditDraft)
	const deleteGeoEditDraft = useEditorStore((state) => state.deleteGeoEditDraft)
	const createWorkspace = useEditorStore((state) => state.createWorkspace)
	const updateWorkspace = useEditorStore((state) => state.updateWorkspace)
	const deleteWorkspaceState = useEditorStore((state) => state.deleteWorkspace)
	const setActiveWorkspaceId = useEditorStore((state) => state.setActiveWorkspaceId)
	const activeContextScopeCoordinate = useEditorStore((state) => state.activeContextScopeCoordinate)

	const getDatasetKey = useCallback(
		(event: GeoDataset) => `${event.pubkey}:${event.datasetId ?? event.id}`,
		[],
	)

	const getDatasetName = useCallback(
		(event: GeoDataset) =>
			getCollectionName(event.featureCollection) ?? event.datasetId ?? event.id,
		[],
	)

	const resolvedCollectionResolver = useCallback(
		(event: GeoDataset) => {
			const datasetKey = getDatasetKey(event)
			return resolvedCollectionsRef.current.get(datasetKey)?.featureCollection
		},
		[getDatasetKey],
	)

	const ensureResolvedFeatureCollection = useCallback(
		async (event: GeoDataset) => {
			if (event.blobReferences.length === 0) {
				return event.featureCollection
			}
			const datasetKey = getDatasetKey(event)
			const cached = resolvedCollectionsRef.current.get(datasetKey)
			if (cached && cached.eventId === event.id) {
				return cached.featureCollection
			}
			// Track resolving state for UI feedback
			setDatasetResolving(datasetKey, true)

			// Throttle progress updates to prevent excessive re-renders
			let lastProgressUpdate = 0
			const THROTTLE_MS = 100

			try {
				const resolved = await resolveGeoEventFeatureCollection(event, {
					onProgress: (loaded, total) => {
						const now = Date.now()
						const isComplete = loaded >= total
						// Update immediately on first call, completion, or if throttle time has passed
						if (lastProgressUpdate === 0 || isComplete || now - lastProgressUpdate >= THROTTLE_MS) {
							lastProgressUpdate = now
							setDatasetResolvingProgress(datasetKey, loaded, total)
						}
					},
				})
				resolvedCollectionsRef.current.set(datasetKey, {
					eventId: event.id,
					featureCollection: resolved,
				})
				return resolved
			} finally {
				setDatasetResolving(datasetKey, false)
			}
		},
		[getDatasetKey, setDatasetResolving, setDatasetResolvingProgress],
	)

	const convertGeoBlobReferencesToEditor = useCallback(
		(references: GeoBlobReference[] = []): EditorBlobReference[] =>
			references.map((reference) => ({
				...reference,
				id: crypto.randomUUID(),
				// These references already exist on the event (i.e. already uploaded / externally hosted).
				status: reference.url ? ('ready' as const) : ('idle' as const),
			})),
		[],
	)

	const resetBlobReferenceState = useCallback(() => {
		setBlobReferences([])
		setBlobPreviewCollection(null)
		setPreviewingBlobReferenceId(null)
		setBlobDraftUrl('')
		setBlobDraftStatus('idle')
		setBlobDraftError(null)
	}, [
		setBlobReferences,
		setBlobPreviewCollection,
		setPreviewingBlobReferenceId,
		setBlobDraftUrl,
		setBlobDraftStatus,
		setBlobDraftError,
	])

	const activateWorkspaceChat = useCallback((chatSessionId: string | null) => {
		if (!chatSessionId) return
		useChatStore.getState().switchChat(chatSessionId)
	}, [])

	const createWorkspaceChat = useCallback(() => {
		const chatStore = useChatStore.getState()
		chatStore.createChat()
		return useChatStore.getState().activeChatId
	}, [])

	const applyEditingState = useCallback(
		({
			features,
			activeDataset,
			contextRefs,
			collectionMeta,
			blobReferences,
		}: {
			features: ReturnType<typeof convertGeoEventsToEditorFeatures>
			activeDataset: GeoDataset | null
			contextRefs: string[]
			collectionMeta: ReturnType<typeof extractCollectionMeta>
			blobReferences: GeoBlobReference[]
		}) => {
			if (!editor) return
			setActiveGeoEditDraftId(null)
			editor.setFeatures(features)
			setFeatures(features)
			setActiveDataset(activeDataset)
			setActiveDatasetContextRefs(contextRefs)
			setPublishMessage(null)
			setPublishError(null)
			setSelectedFeatureIds([])
			setCollectionMeta(collectionMeta)
			setNewCollectionProp({ key: '', value: '' })
			setNewFeatureProp({ key: '', value: '' })
			setBlobReferences(convertGeoBlobReferencesToEditor(blobReferences))
			setBlobPreviewCollection(null)
			setPreviewingBlobReferenceId(null)
			setBlobDraftUrl('')
			setBlobDraftStatus('idle')
			setBlobDraftError(null)
			setViewMode('edit')
			setViewDataset(null)
			// Stance transition: loading a dataset for editing means the user
			// has committed to authoring it.
			setStance('author')
			// Round C.3: surface the in-edit state as a map-stack entry. It's
			// rendered by the editor's draft layer (not via `visibleGeoEvents`)
			// so the stack entry is informational — but it lets the panel
			// honestly reflect what's contributing to the map and lets the
			// user end the session from the same surface.
			const draftTitle =
				collectionMeta?.name || (activeDataset ? getDatasetName(activeDataset) : 'Untitled draft')
			addMapStackEntry({
				id: 'draft:active',
				entityType: 'draft',
				entityKey: 'draft:active',
				title: draftTitle,
				source: 'workspace',
				visible: true,
				pinned: false,
			})
		},
		[
			editor,
			setActiveGeoEditDraftId,
			setFeatures,
			setActiveDataset,
			setActiveDatasetContextRefs,
			setPublishMessage,
			setPublishError,
			setSelectedFeatureIds,
			setCollectionMeta,
			setNewCollectionProp,
			setNewFeatureProp,
			setBlobReferences,
			convertGeoBlobReferencesToEditor,
			setBlobPreviewCollection,
			setPreviewingBlobReferenceId,
			setBlobDraftUrl,
			setBlobDraftStatus,
			setBlobDraftError,
			setViewMode,
			setViewDataset,
			setStance,
			addMapStackEntry,
			getDatasetName,
		],
	)

	const switchToWorkspace = useCallback(
		async (workspaceId: string) => {
			if (!editor) return
			const store = useEditorStore.getState()
			const workspace = store.workspaces[workspaceId]
			if (!workspace) return

			setActiveWorkspaceId(workspaceId)
			const chatSessionId = workspace.chatSessionId ?? createWorkspaceChat()
			if (!workspace.chatSessionId) {
				updateWorkspace(workspaceId, { chatSessionId })
			}
			activateWorkspaceChat(chatSessionId)

			const event = workspace.datasetKey
				? (geoEventsRef.current.find(
						(geoEvent) => getDatasetKey(geoEvent) === workspace.datasetKey,
					) ?? null)
				: null

			if (event) {
				try {
					await ensureResolvedFeatureCollection(event)
				} catch (error) {
					console.error('Failed to resolve external blobs for workspace dataset', error)
					setPublishError('Failed to restore dataset blobs for this workspace.')
					return
				}
			}

			const draft = workspace.activeDraftId ? store.geoEditDrafts[workspace.activeDraftId] : null
			if (draft) {
				applyEditingState({
					features: draft.features,
					activeDataset: event,
					contextRefs:
						event?.contextReferences ??
						(workspace.kind === 'scratch' && activeContextScopeCoordinate
							? [activeContextScopeCoordinate]
							: []),
					collectionMeta: draft.collectionMeta,
					blobReferences: event?.blobReferences ?? [],
				})
				loadGeoEditDraft(draft.id)
				return
			}

			if (event) {
				const datasetFeatures = convertGeoEventsToEditorFeatures(
					[event],
					resolvedCollectionResolver,
				)
				const collection = resolvedCollectionResolver(event) ?? event.featureCollection
				const collectionMeta = extractCollectionMeta(collection)
				applyEditingState({
					features: datasetFeatures,
					activeDataset: event,
					contextRefs: event.contextReferences,
					collectionMeta,
					blobReferences: event.blobReferences,
				})
				const draftId = createGeoEditDraft(workspace.sourceId, {
					name: collectionMeta.name,
					description: collectionMeta.description,
					collectionMeta,
					features: datasetFeatures,
					selectedFeatureIds: [],
				})
				updateWorkspace(workspaceId, {
					activeDraftId: draftId,
					datasetKey: workspace.datasetKey ?? getDatasetKey(event),
				})
				return
			}

			const collectionMeta = createDefaultCollectionMeta()
			const contextRefs = activeContextScopeCoordinate ? [activeContextScopeCoordinate] : []
			applyEditingState({
				features: [],
				activeDataset: null,
				contextRefs,
				collectionMeta,
				blobReferences: [],
			})
			const draftId = createGeoEditDraft(workspace.sourceId, {
				name: '',
				description: '',
				collectionMeta,
				features: [],
				selectedFeatureIds: [],
			})
			updateWorkspace(workspaceId, {
				activeDraftId: draftId,
			})
		},
		[
			editor,
			setActiveWorkspaceId,
			activateWorkspaceChat,
			createWorkspaceChat,
			getDatasetKey,
			ensureResolvedFeatureCollection,
			setPublishError,
			applyEditingState,
			activeContextScopeCoordinate,
			loadGeoEditDraft,
			resolvedCollectionResolver,
			createGeoEditDraft,
			updateWorkspace,
		],
	)

	const zoomToDataset = useCallback(
		(event: GeoDataset) => {
			if (!mapRef.current) return
			const resolvedCollection = resolvedCollectionResolver(event)
			const bbox =
				event.boundingBox ??
				getCollectionBbox(resolvedCollection) ??
				getCollectionBbox(event.featureCollection)
			if (bbox && Array.isArray(bbox) && bbox.length === 4) {
				mapRef.current.fitBounds(
					[
						[bbox[0], bbox[1]],
						[bbox[2], bbox[3]],
					],
					{ padding: 40, duration: 500 },
				)
				return
			}

			const collection = convertGeoEventsToFeatureCollection([event], resolvedCollectionResolver)
			const coords = coordAll(collection)
			// Filter out invalid coordinates (NaN, undefined, or out of valid lng/lat range)
			const validCoords = coords.filter(
				(coord): coord is [number, number] =>
					Array.isArray(coord) &&
					coord.length >= 2 &&
					typeof coord[0] === 'number' &&
					typeof coord[1] === 'number' &&
					!Number.isNaN(coord[0]) &&
					!Number.isNaN(coord[1]) &&
					coord[0] >= -180 &&
					coord[0] <= 180 &&
					coord[1] >= -90 &&
					coord[1] <= 90,
			)
			if (validCoords.length === 0) return
			// Slice to [lng, lat] as MapLibre requires exactly 2-element arrays
			const lngLatCoords = validCoords.map((c) => [c[0], c[1]] as [number, number])
			const bounds = lngLatCoords.reduce(
				(acc, coord) => acc.extend(coord),
				new maplibregl.LngLatBounds(lngLatCoords[0], lngLatCoords[0]),
			)
			mapRef.current.fitBounds(bounds, { padding: 40, duration: 500 })
		},
		[mapRef, resolvedCollectionResolver],
	)

	const toggleDatasetVisibility = useCallback(
		(event: GeoDataset) => {
			// Round D.3: "visibility" == stack membership. Toggle by id.
			const key = getDatasetKey(event)
			const entryId = `dataset:${key}`
			const store = useEditorStore.getState()
			if (store.mapStackEntries[entryId]) {
				store.removeMapStackEntry(entryId)
			} else {
				store.addMapStackEntry({
					entityType: 'dataset',
					entityKey: key,
					title: getDatasetName(event),
					source: 'manual',
					visible: true,
					pinned: false,
				})
			}
		},
		[getDatasetKey, getDatasetName],
	)

	const toggleAllDatasetVisibility = useCallback(
		(visible: boolean) => {
			// Round D.3: "show all" pushes every loaded dataset onto the stack;
			// "hide all" removes every dataset entry. Context/draft entries are
			// untouched. This is the bulk-toggle from the catalog column header.
			const store = useEditorStore.getState()
			if (visible) {
				for (const event of geoEventsRef.current) {
					const key = getDatasetKey(event)
					store.addMapStackEntry({
						entityType: 'dataset',
						entityKey: key,
						title: getDatasetName(event),
						source: 'manual',
						visible: true,
						pinned: false,
					})
				}
			} else {
				for (const id of [...store.mapStackOrder]) {
					if (store.mapStackEntries[id]?.entityType === 'dataset') {
						store.removeMapStackEntry(id)
					}
				}
			}
		},
		[getDatasetKey, getDatasetName],
	)

	const loadDatasetForEditing = useCallback(
		async (event: GeoDataset) => {
			if (!editor) return
			const datasetKey = getDatasetKey(event)
			// Round G.2: loading for edit counts as a recent interaction too.
			recordRecentEntity(`dataset:${datasetKey}`)
			const draftSourceId = `dataset:${datasetKey}`
			const existingWorkspace = Object.values(useEditorStore.getState().workspaces).find(
				(workspace) => workspace.sourceId === draftSourceId,
			)
			if (existingWorkspace?.activeDraftId) {
				await switchToWorkspace(existingWorkspace.id)
				return
			}
			try {
				await ensureResolvedFeatureCollection(event)
			} catch (error) {
				console.error('Failed to resolve external blobs for dataset', error)
				setPublishError('Failed to load dataset blobs. Check console for details.')
				return
			}
			const datasetFeatures = convertGeoEventsToEditorFeatures([event], resolvedCollectionResolver)
			const collection = resolvedCollectionResolver(event) ?? event.featureCollection
			const collectionMeta = extractCollectionMeta(collection)
			const workspaceId =
				existingWorkspace?.id ??
				createWorkspace({
					sourceId: draftSourceId,
					label: collectionMeta.name || getDatasetName(event),
					kind: 'dataset',
					datasetKey,
					chatSessionId: existingWorkspace?.chatSessionId ?? createWorkspaceChat(),
				})
			if (existingWorkspace) {
				const chatSessionId = existingWorkspace.chatSessionId ?? createWorkspaceChat()
				setActiveWorkspaceId(existingWorkspace.id)
				activateWorkspaceChat(chatSessionId)
				updateWorkspace(existingWorkspace.id, {
					datasetKey,
					chatSessionId,
				})
			}
			applyEditingState({
				features: datasetFeatures,
				activeDataset: event,
				contextRefs: event.contextReferences,
				collectionMeta,
				blobReferences: event.blobReferences,
			})
			const draftId = createGeoEditDraft(draftSourceId, {
				name: collectionMeta.name,
				description: collectionMeta.description,
				collectionMeta,
				features: datasetFeatures,
				selectedFeatureIds: [],
			})
			updateWorkspace(workspaceId, {
				activeDraftId: draftId,
				datasetKey,
			})
		},
		[
			editor,
			getDatasetName,
			ensureResolvedFeatureCollection,
			getDatasetKey,
			switchToWorkspace,
			resolvedCollectionResolver,
			createWorkspace,
			createWorkspaceChat,
			setActiveWorkspaceId,
			activateWorkspaceChat,
			updateWorkspace,
			applyEditingState,
			createGeoEditDraft,
			setPublishError,
			recordRecentEntity,
		],
	)

	// Phase 1.1: the single, complete edit-session teardown. Previously split
	// across `clearEditingSession` (full teardown, but no viewMode reset) and
	// `cancelEditing` (reset viewMode/viewDataset, but left `draft:active` on
	// the stack AND stance on author — bug 3.6). This unifies both: it is the
	// ONLY place `draft:active` is removed (the draft invariant, Phase 1.4).
	const tearDownEditSession = useCallback(() => {
		if (!editor) return
		setActiveGeoEditDraftId(null)
		setActiveWorkspaceId(null)
		editor.setFeatures([])
		setFeatures([])
		setActiveDataset(null)
		setActiveDatasetContextRefs([])
		setPublishMessage(null)
		setPublishError(null)
		setSelectedFeatureIds([])
		setCollectionMeta(createDefaultCollectionMeta())
		setNewCollectionProp({ key: '', value: '' })
		setNewFeatureProp({ key: '', value: '' })
		resetBlobReferenceState()
		setViewMode('view')
		setViewDataset(null)
		// Stance transition: stopping editing returns to browse. (Phase 1.3 will
		// make stance derived from the route + edit-session and drop this line.)
		setStance('browse')
		// Round C.3: remove the in-edit stack entry on session end.
		removeMapStackEntry('draft:active')
	}, [
		editor,
		setFeatures,
		setActiveDataset,
		setActiveDatasetContextRefs,
		setPublishMessage,
		setPublishError,
		setSelectedFeatureIds,
		setCollectionMeta,
		setNewCollectionProp,
		setNewFeatureProp,
		resetBlobReferenceState,
		setActiveGeoEditDraftId,
		setActiveWorkspaceId,
		setViewMode,
		setViewDataset,
		setStance,
		removeMapStackEntry,
	])

	const deleteWorkspace = useCallback(
		async (workspaceId: string) => {
			const store = useEditorStore.getState()
			const workspace = store.workspaces[workspaceId]
			if (!workspace) return

			const isActiveWorkspace = store.activeWorkspaceId === workspaceId
			const nextWorkspaceId = isActiveWorkspace
				? (Object.values(store.workspaces)
						.filter((candidate) => candidate.id !== workspaceId)
						.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)
				: store.activeWorkspaceId

			if (workspace.chatSessionId) {
				useChatStore.getState().deleteChat(workspace.chatSessionId)
			}
			if (workspace.activeDraftId) {
				deleteGeoEditDraft(workspace.activeDraftId)
			}

			deleteWorkspaceState(workspaceId)

			if (!isActiveWorkspace) return
			if (nextWorkspaceId && editor) {
				await switchToWorkspace(nextWorkspaceId)
				return
			}
			if (editor) {
				tearDownEditSession()
				return
			}

			useEditorStore.getState().setActiveGeoEditDraftId(null)
		},
		[tearDownEditSession, deleteGeoEditDraft, deleteWorkspaceState, editor, switchToWorkspace],
	)

	const createDraftInWorkspace = useCallback(
		async (workspaceId: string) => {
			if (!editor) return
			const beforeSwitch = useEditorStore.getState()
			if (!beforeSwitch.workspaces[workspaceId]) return
			if (beforeSwitch.activeWorkspaceId !== workspaceId) {
				await switchToWorkspace(workspaceId)
			}

			const store = useEditorStore.getState()
			const workspace = store.workspaces[workspaceId]
			if (!workspace) return

			if (workspace.datasetKey) {
				const event =
					geoEventsRef.current.find(
						(geoEvent) => getDatasetKey(geoEvent) === workspace.datasetKey,
					) ?? null
				if (event) {
					try {
						await ensureResolvedFeatureCollection(event)
					} catch (error) {
						console.error('Failed to resolve external blobs for fresh workspace draft', error)
						setPublishError('Failed to load dataset blobs. Check console for details.')
						return
					}

					const datasetFeatures = convertGeoEventsToEditorFeatures(
						[event],
						resolvedCollectionResolver,
					)
					const collection = resolvedCollectionResolver(event) ?? event.featureCollection
					const collectionMeta = extractCollectionMeta(collection)

					applyEditingState({
						features: datasetFeatures,
						activeDataset: event,
						contextRefs: event.contextReferences,
						collectionMeta,
						blobReferences: event.blobReferences,
					})

					const draftId = createGeoEditDraft(workspace.sourceId, {
						name: collectionMeta.name,
						description: collectionMeta.description,
						collectionMeta,
						features: datasetFeatures,
						selectedFeatureIds: [],
					})
					updateWorkspace(workspaceId, {
						activeDraftId: draftId,
					})
					return
				}
			}

			const collectionMeta = createDefaultCollectionMeta()
			const contextRefs = activeContextScopeCoordinate ? [activeContextScopeCoordinate] : []
			applyEditingState({
				features: [],
				activeDataset: null,
				contextRefs,
				collectionMeta,
				blobReferences: [],
			})
			const draftId = createGeoEditDraft(workspace.sourceId, {
				name: '',
				description: '',
				collectionMeta,
				features: [],
				selectedFeatureIds: [],
			})
			updateWorkspace(workspaceId, {
				activeDraftId: draftId,
			})
		},
		[
			editor,
			switchToWorkspace,
			getDatasetKey,
			ensureResolvedFeatureCollection,
			setPublishError,
			resolvedCollectionResolver,
			applyEditingState,
			createGeoEditDraft,
			updateWorkspace,
			activeContextScopeCoordinate,
		],
	)

	/**
	 * Start a new dataset editing session.
	 * Clears any existing data and switches to edit mode.
	 */
	const startNewDataset = useCallback(() => {
		if (!editor) return
		const collectionMeta = createDefaultCollectionMeta()
		const contextRefs = activeContextScopeCoordinate ? [activeContextScopeCoordinate] : []
		const draftSourceId = createBlankDraftSourceId()
		const workspaceId = createWorkspace({
			sourceId: draftSourceId,
			label: 'Untitled workspace',
			kind: 'scratch',
			chatSessionId: createWorkspaceChat(),
		})
		applyEditingState({
			features: [],
			activeDataset: null,
			contextRefs,
			collectionMeta,
			blobReferences: [],
		})
		const draftId = createGeoEditDraft(draftSourceId, {
			name: '',
			description: '',
			collectionMeta,
			features: [],
			selectedFeatureIds: [],
		})
		updateWorkspace(workspaceId, {
			activeDraftId: draftId,
		})
	}, [
		editor,
		activeContextScopeCoordinate,
		createWorkspace,
		createWorkspaceChat,
		applyEditingState,
		createGeoEditDraft,
		updateWorkspace,
	])

	/**
	 * Cancel editing and return to view mode.
	 * Clears the editor and any unsaved changes.
	 */
	return {
		// Refs
		resolvedCollectionsRef,
		isMountedRef,
		geoEventsRef,
		// Helpers
		getDatasetKey,
		getDatasetName,
		resolvedCollectionResolver,
		ensureResolvedFeatureCollection,
		convertGeoBlobReferencesToEditor,
		resetBlobReferenceState,
		// Actions
		zoomToDataset,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		switchToWorkspace,
		deleteWorkspace,
		createDraftInWorkspace,
		tearDownEditSession,
		startNewDataset,
	}
}
