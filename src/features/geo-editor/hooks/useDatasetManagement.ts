import { coordAll } from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import maplibregl from 'maplibre-gl'
import { useCallback, useRef } from 'react'
import { resolveGeoEventFeatureCollection } from '@/lib/geo/resolveBlobReferences'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent, GeoBlobReference } from '@/lib/ndk/NDKGeoEvent'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
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
	geoEvents: NDKGeoEvent[],
) {
	const resolvedCollectionsRef = useRef<Map<string, ResolvedCache>>(new Map())
	const isMountedRef = useRef(true)
	const geoEventsRef = useRef<NDKGeoEvent[]>([])

	// Keep ref in sync
	geoEventsRef.current = geoEvents

	// Store actions
	const editor = useEditorStore((state) => state.editor)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setActiveDataset = useEditorStore((state) => state.setActiveDataset)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)
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
	const setViewDataset = useEditorStore((state) => state.setViewDataset)
	const setViewCollection = useEditorStore((state) => state.setViewCollection)
	const setDatasetResolving = useEditorStore((state) => state.setDatasetResolving)
	const setDatasetResolvingProgress = useEditorStore((state) => state.setDatasetResolvingProgress)
	const setActiveGeoEditDraftId = useEditorStore((state) => state.setActiveGeoEditDraftId)
	const createGeoEditDraft = useEditorStore((state) => state.createGeoEditDraft)
	const activeContextScopeCoordinate = useEditorStore((state) => state.activeContextScopeCoordinate)

	const getDatasetKey = useCallback(
		(event: NDKGeoEvent) => `${event.pubkey}:${event.datasetId ?? event.id}`,
		[],
	)

	const getDatasetName = useCallback(
		(event: NDKGeoEvent) =>
			getCollectionName(event.featureCollection) ?? event.datasetId ?? event.id,
		[],
	)

	const resolvedCollectionResolver = useCallback(
		(event: NDKGeoEvent) => {
			const datasetKey = getDatasetKey(event)
			return resolvedCollectionsRef.current.get(datasetKey)?.featureCollection
		},
		[getDatasetKey],
	)

	const ensureResolvedFeatureCollection = useCallback(
		async (event: NDKGeoEvent) => {
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

	const zoomToDataset = useCallback(
		(event: NDKGeoEvent) => {
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

	const zoomToCollection = useCallback(
		(collection: NDKGeoCollectionEvent, eventsInCollection: NDKGeoEvent[]) => {
			if (!mapRef.current) return
			const bbox = collection.boundingBox
			if (bbox && bbox.length === 4) {
				mapRef.current.fitBounds(
					[
						[bbox[0], bbox[1]],
						[bbox[2], bbox[3]],
					],
					{ padding: 40, duration: 500 },
				)
				return
			}

			const eventsToUse =
				eventsInCollection.length > 0
					? eventsInCollection
					: geoEventsRef.current.filter((event) => {
							const datasetId = event.datasetId ?? event.dTag ?? event.id
							if (!datasetId) return false
							const coordinate = `${event.kind ?? GEO_EVENT_KIND}:${event.pubkey}:${datasetId}`
							return collection.datasetReferences.includes(coordinate)
						})

			if (eventsToUse.length === 0) return

			const collectionFc = convertGeoEventsToFeatureCollection(
				eventsToUse,
				resolvedCollectionResolver,
			)
			const coords = coordAll(collectionFc)
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
		(event: NDKGeoEvent) => {
			const key = getDatasetKey(event)
			setDatasetVisibility((prev) => ({
				...prev,
				[key]: !(prev[key] !== false),
			}))
		},
		[getDatasetKey, setDatasetVisibility],
	)

	const toggleAllDatasetVisibility = useCallback(
		(visible: boolean) => {
			setDatasetVisibility((prev) => {
				const next = { ...prev }
				for (const event of geoEventsRef.current) {
					const key = getDatasetKey(event)
					next[key] = visible
				}
				return next
			})
		},
		[getDatasetKey, setDatasetVisibility],
	)

	const loadDatasetForEditing = useCallback(
		async (event: NDKGeoEvent) => {
			if (!editor) return
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
			const draftSourceId = `dataset:${getDatasetKey(event)}`

			setActiveGeoEditDraftId(null)
			editor.setFeatures(datasetFeatures)
			setFeatures(datasetFeatures)
			setActiveDataset(event)
			setActiveDatasetContextRefs(event.contextReferences)
			setPublishMessage(null)
			setPublishError(null)
			setSelectedFeatureIds([])
			setCollectionMeta(collectionMeta)
			setNewCollectionProp({ key: '', value: '' })
			setNewFeatureProp({ key: '', value: '' })
			setBlobReferences(convertGeoBlobReferencesToEditor(event.blobReferences))
			setBlobPreviewCollection(null)
			setPreviewingBlobReferenceId(null)
			setBlobDraftUrl('')
			setBlobDraftStatus('idle')
			setBlobDraftError(null)
			// Switch to edit mode and clear view state
			setViewMode('edit')
			setViewDataset(null)
			setViewCollection(null)
			createGeoEditDraft(draftSourceId, {
				name: collectionMeta.name,
				description: collectionMeta.description,
				collectionMeta,
				features: datasetFeatures,
				selectedFeatureIds: [],
			})
		},
		[
			editor,
			ensureResolvedFeatureCollection,
			setPublishError,
			getDatasetKey,
			resolvedCollectionResolver,
			setFeatures,
			setActiveDataset,
			setActiveDatasetContextRefs,
			setPublishMessage,
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
			setViewCollection,
			setActiveGeoEditDraftId,
			createGeoEditDraft,
		],
	)

	const clearEditingSession = useCallback(() => {
		if (!editor) return
		setActiveGeoEditDraftId(null)
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
	])

	/**
	 * Start a new dataset editing session.
	 * Clears any existing data and switches to edit mode.
	 */
	const startNewDataset = useCallback(() => {
		if (!editor) return
		const collectionMeta = createDefaultCollectionMeta()
		const contextRefs = activeContextScopeCoordinate ? [activeContextScopeCoordinate] : []
		const draftSourceId = createBlankDraftSourceId()

		setActiveGeoEditDraftId(null)
		editor.setFeatures([])
		setFeatures([])
		setActiveDataset(null)
		setActiveDatasetContextRefs(contextRefs)
		setPublishMessage(null)
		setPublishError(null)
		setSelectedFeatureIds([])
		setCollectionMeta(collectionMeta)
		setNewCollectionProp({ key: '', value: '' })
		setNewFeatureProp({ key: '', value: '' })
		resetBlobReferenceState()
		// Switch to edit mode
		setViewMode('edit')
		setViewDataset(null)
		setViewCollection(null)
		createGeoEditDraft(draftSourceId, {
			name: '',
			description: '',
			collectionMeta,
			features: [],
			selectedFeatureIds: [],
		})
	}, [
		editor,
		setFeatures,
		setActiveDataset,
		activeContextScopeCoordinate,
		setActiveDatasetContextRefs,
		setPublishMessage,
		setPublishError,
		setSelectedFeatureIds,
		setCollectionMeta,
		setNewCollectionProp,
		setNewFeatureProp,
		resetBlobReferenceState,
		setViewMode,
		setViewDataset,
		setViewCollection,
		setActiveGeoEditDraftId,
		createGeoEditDraft,
	])

	/**
	 * Cancel editing and return to view mode.
	 * Clears the editor and any unsaved changes.
	 */
	const cancelEditing = useCallback(() => {
		if (!editor) return
		setActiveGeoEditDraftId(null)
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
		// Return to view mode
		setViewMode('view')
		setViewDataset(null)
		setViewCollection(null)
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
		setViewMode,
		setViewDataset,
		setViewCollection,
		setActiveGeoEditDraftId,
	])

	const resolveEventsForCollection = useCallback(
		(collection: NDKGeoCollectionEvent): NDKGeoEvent[] => {
			const references = new Set(collection.datasetReferences)
			if (references.size === 0) return []
			return geoEventsRef.current.filter((event) => {
				const datasetId = event.datasetId ?? event.dTag ?? event.id
				if (!datasetId) return false
				const coordinate = `${event.kind ?? GEO_EVENT_KIND}:${event.pubkey}:${datasetId}`
				return references.has(coordinate)
			})
		},
		[],
	)

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
		resolveEventsForCollection,
		// Actions
		zoomToDataset,
		zoomToCollection,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		clearEditingSession,
		startNewDataset,
		cancelEditing,
	}
}
