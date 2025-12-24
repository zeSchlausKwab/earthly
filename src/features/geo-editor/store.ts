import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { earthlyGeoServer } from '../../ctxcn/EarthlyGeoServerClient'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { EditorFeature, EditorMode, GeoEditor } from './core'
import type { CollectionMeta, EditorBlobReference, GeoSearchResult } from './types'
import {
	detectBlobScope,
	ensureFeatureCollection,
	fetchGeoJsonPayload,
	summarizeFeatureCollection
} from './utils'

interface EditorStats {
	points: number
	lines: number
	polygons: number
	total: number
}

interface EditorState {
	editor: GeoEditor | null
	features: EditorFeature[]
	stats: EditorStats
	mode: EditorMode
	selectedFeatureIds: string[]
	snappingEnabled: boolean
	panLocked: boolean
	canFinishDrawing: boolean
	history: {
		canUndo: boolean
		canRedo: boolean
	}

	// Metadata & Dataset State
	collectionMeta: CollectionMeta
	activeDataset: NDKGeoEvent | null
	datasetVisibility: Record<string, boolean>

	// Publishing State
	isPublishing: boolean
	publishMessage: string | null
	publishError: string | null

	// Blob References State
	blobReferences: EditorBlobReference[]
	blobDraftUrl: string
	blobDraftStatus: 'idle' | 'loading' | 'error'
	blobDraftError: string | null
	previewingBlobReferenceId: string | null
	blobPreviewCollection: FeatureCollection | null

	// View Mode State
	viewMode: 'edit' | 'view'
	viewDataset: NDKGeoEvent | null
	viewCollection: NDKGeoCollectionEvent | null
	viewCollectionEvents: NDKGeoEvent[]

	// UI Input State (moved from view)
	newCollectionProp: { key: string; value: string }
	newFeatureProp: { key: string; value: string }

	// UI State
	showTips: boolean
	showDatasetsPanel: boolean
	showInfoPanel: boolean
	mobileDatasetsOpen: boolean
	mobileInfoOpen: boolean
	mobileToolsOpen: boolean
	mobileSearchOpen: boolean
	mobileActionsOpen: boolean
	inspectorActive: boolean

	// Search State
	searchQuery: string
	searchResults: GeoSearchResult[]
	searchLoading: boolean
	searchError: string | null

	// Actions
	setEditor: (editor: GeoEditor | null) => void
	setFeatures: (features: EditorFeature[]) => void
	setMode: (mode: EditorMode) => void
	setSelectedFeatureIds: (ids: string[]) => void
	setSnappingEnabled: (enabled: boolean) => void
	setPanLocked: (locked: boolean) => void
	setCanFinishDrawing: (canFinish: boolean) => void
	setHistoryState: (canUndo: boolean, canRedo: boolean) => void

	setCollectionMeta: (meta: CollectionMeta) => void
	setActiveDataset: (dataset: NDKGeoEvent | null) => void
	setDatasetVisibility: (
		visibility:
			| Record<string, boolean>
			| ((prev: Record<string, boolean>) => Record<string, boolean>)
	) => void

	setIsPublishing: (isPublishing: boolean) => void
	setPublishMessage: (message: string | null) => void
	setPublishError: (error: string | null) => void

	setBlobReferences: (refs: EditorBlobReference[]) => void
	setBlobDraftUrl: (url: string) => void
	setBlobDraftStatus: (status: 'idle' | 'loading' | 'error') => void
	setBlobDraftError: (error: string | null) => void
	setPreviewingBlobReferenceId: (id: string | null) => void
	setBlobPreviewCollection: (collection: FeatureCollection | null) => void

	fetchBlobReference: () => Promise<void>
	previewBlobReference: (id: string) => Promise<void>
	removeBlobReference: (id: string) => void

	setViewMode: (mode: 'edit' | 'view') => void
	setViewDataset: (dataset: NDKGeoEvent | null) => void
	setViewCollection: (collection: NDKGeoCollectionEvent | null) => void
	setViewCollectionEvents: (events: NDKGeoEvent[]) => void

	setNewCollectionProp: (prop: { key: string; value: string }) => void
	setNewFeatureProp: (prop: { key: string; value: string }) => void

	// UI Actions
	setShowTips: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowDatasetsPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowInfoPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setMobileDatasetsOpen: (open: boolean) => void
	setMobileInfoOpen: (open: boolean) => void
	setMobileToolsOpen: (open: boolean) => void
	setMobileSearchOpen: (open: boolean) => void
	setMobileActionsOpen: (open: boolean) => void
	setMobileActiveState: (state: 'datasets' | 'info' | 'tools' | 'search' | 'actions' | null) => void
	setInspectorActive: (active: boolean) => void

	// Search Actions
	setSearchQuery: (query: string) => void
	setSearchResults: (results: GeoSearchResult[]) => void
	setSearchLoading: (loading: boolean) => void
	setSearchError: (error: string | null) => void
	performSearch: () => Promise<void>
	clearSearch: () => void

	setMapSource: (source: EditorState['mapSource']) => void
	setShowMapSettings: (show: boolean) => void

	// Map Source State
	mapSource: {
		type: 'default' | 'pmtiles' | 'blossom'
		location: 'remote' | 'local'
		url?: string
		file?: File
		/** Base URL for fetching PMTiles chunks (used with blossom) */
		blossomServer?: string
		/** URL to fetch the announcement record (used with blossom) */
		announcementUrl?: string
	}
	showMapSettings: boolean

	// Computed/Helpers
	updateStats: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
	editor: null,
	features: [],
	stats: { points: 0, lines: 0, polygons: 0, total: 0 },
	mode: 'select',
	selectedFeatureIds: [],
	snappingEnabled: true,
	panLocked: false,
	canFinishDrawing: false,
	history: { canUndo: false, canRedo: false },

	collectionMeta: {
		name: '',
		description: '',
		color: '#3b82f6',
		customProperties: {}
	},
	activeDataset: null,
	datasetVisibility: {},

	isPublishing: false,
	publishMessage: null,
	publishError: null,

	blobReferences: [],
	blobDraftUrl: '',
	blobDraftStatus: 'idle',
	blobDraftError: null,
	previewingBlobReferenceId: null,
	blobPreviewCollection: null,

	viewMode: 'edit',
	viewDataset: null,
	viewCollection: null,
	viewCollectionEvents: [],

	newCollectionProp: { key: '', value: '' },
	newFeatureProp: { key: '', value: '' },

	// UI State
	showTips: true,
	showDatasetsPanel: false,
	showInfoPanel: false,
	mobileDatasetsOpen: false,
	mobileInfoOpen: false,
	mobileToolsOpen: false,
	mobileSearchOpen: false,
	mobileActionsOpen: false,
	inspectorActive: false,

	// Search State
	searchQuery: '',
	searchResults: [],
	searchLoading: false,
	searchError: null,

	setEditor: (editor) => set({ editor }),

	setFeatures: (features) => {
		set({ features })
		get().updateStats()
	},

	setMode: (mode) => {
		const { editor } = get()
		if (editor && editor.getMode() !== mode) {
			editor.setMode(mode)
		}
		set({ mode })
	},

	setSelectedFeatureIds: (selectedFeatureIds) => set({ selectedFeatureIds }),

	setSnappingEnabled: (snappingEnabled) => {
		set({ snappingEnabled })
	},

	setPanLocked: (panLocked) => {
		const { editor } = get()
		if (editor) {
			editor.setPanLocked(panLocked)
		}
		set({ panLocked })
	},

	setCanFinishDrawing: (canFinishDrawing) => set({ canFinishDrawing }),

	setHistoryState: (canUndo, canRedo) => set({ history: { canUndo, canRedo } }),

	setCollectionMeta: (collectionMeta) => set({ collectionMeta }),
	setActiveDataset: (activeDataset) => set({ activeDataset }),
	setDatasetVisibility: (update) =>
		set((state) => ({
			datasetVisibility: typeof update === 'function' ? update(state.datasetVisibility) : update
		})),

	setIsPublishing: (isPublishing) => set({ isPublishing }),
	setPublishMessage: (publishMessage) => set({ publishMessage }),
	setPublishError: (publishError) => set({ publishError }),

	setBlobReferences: (blobReferences) => set({ blobReferences }),
	setBlobDraftUrl: (blobDraftUrl) => set({ blobDraftUrl }),
	setBlobDraftStatus: (blobDraftStatus) => set({ blobDraftStatus }),
	setBlobDraftError: (blobDraftError) => set({ blobDraftError }),
	setPreviewingBlobReferenceId: (previewingBlobReferenceId) => set({ previewingBlobReferenceId }),
	setBlobPreviewCollection: (blobPreviewCollection) => set({ blobPreviewCollection }),

	fetchBlobReference: async () => {
		const { blobDraftUrl, blobDraftStatus } = get()
		const url = blobDraftUrl.trim()
		if (!url) return

		set({ blobDraftStatus: 'loading', blobDraftError: null })

		try {
			const { payload, size, mimeType } = await fetchGeoJsonPayload(url)
			const normalized = ensureFeatureCollection(payload)
			const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
			const summary = summarizeFeatureCollection(collection)
			const scopeInfo = detectBlobScope(collection)
			const id = crypto.randomUUID()

			const reference: EditorBlobReference = {
				id,
				url,
				scope: scopeInfo.scope,
				featureId: scopeInfo.featureId,
				status: 'ready',
				featureCount: summary.featureCount,
				geometryTypes: summary.geometryTypes,
				previewCollection: collection,
				size,
				mimeType
			}

			set((state) => ({
				blobReferences: [...state.blobReferences, reference],
				blobPreviewCollection: collection,
				previewingBlobReferenceId: id,
				blobDraftUrl: '',
				blobDraftStatus: 'idle'
			}))
		} catch (error) {
			console.error('Failed to fetch external GeoJSON', error)
			set({
				blobDraftStatus: 'error',
				blobDraftError: error instanceof Error ? error.message : 'Failed to fetch external GeoJSON.'
			})
		}
	},

	previewBlobReference: async (id: string) => {
		const { blobReferences } = get()
		const reference = blobReferences.find((ref) => ref.id === id)
		if (!reference) return

		if (reference.status === 'ready' && reference.previewCollection) {
			set({
				previewingBlobReferenceId: id,
				blobPreviewCollection: reference.previewCollection
			})
			return
		}

		set((state) => ({
			blobReferences: state.blobReferences.map((ref) =>
				ref.id === id ? { ...ref, status: 'loading', error: undefined } : ref
			)
		}))

		try {
			const { payload, size, mimeType } = await fetchGeoJsonPayload(reference.url)
			const normalized = ensureFeatureCollection(payload)
			const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
			const summary = summarizeFeatureCollection(collection)
			const scopeInfo = detectBlobScope(collection)

			set((state) => ({
				blobReferences: state.blobReferences.map((ref) =>
					ref.id === id
						? {
								...ref,
								...scopeInfo,
								status: 'ready',
								featureCount: summary.featureCount,
								geometryTypes: summary.geometryTypes,
								previewCollection: collection,
								size: size ?? ref.size,
								mimeType: mimeType ?? ref.mimeType
							}
						: ref
				),
				blobPreviewCollection: collection,
				previewingBlobReferenceId: id
			}))
		} catch (error) {
			console.error('Failed to preview blob reference', error)
			set((state) => ({
				blobReferences: state.blobReferences.map((ref) =>
					ref.id === id
						? {
								...ref,
								status: 'error',
								error: error instanceof Error ? error.message : 'Failed to load external GeoJSON.'
							}
						: ref
				)
			}))
		}
	},

	removeBlobReference: (id: string) => {
		const { previewingBlobReferenceId } = get()
		set((state) => {
			const newState: Partial<EditorState> = {
				blobReferences: state.blobReferences.filter((reference) => reference.id !== id)
			}
			if (previewingBlobReferenceId === id) {
				newState.previewingBlobReferenceId = null
				newState.blobPreviewCollection = null
			}
			return newState
		})
	},

	setViewMode: (viewMode) => set({ viewMode }),
	setViewDataset: (viewDataset) => set({ viewDataset }),
	setViewCollection: (viewCollection) => set({ viewCollection }),
	setViewCollectionEvents: (viewCollectionEvents) => set({ viewCollectionEvents }),

	setNewCollectionProp: (newCollectionProp) => set({ newCollectionProp }),
	setNewFeatureProp: (newFeatureProp) => set({ newFeatureProp }),

	// UI Actions
	setShowTips: (showTips) =>
		set((state) => ({
			showTips: typeof showTips === 'function' ? showTips(state.showTips) : showTips
		})),
	setShowDatasetsPanel: (show) =>
		set((state) => ({
			showDatasetsPanel: typeof show === 'function' ? show(state.showDatasetsPanel) : show
		})),
	setShowInfoPanel: (show) =>
		set((state) => ({
			showInfoPanel: typeof show === 'function' ? show(state.showInfoPanel) : show
		})),
	setMobileDatasetsOpen: (open) => set({ mobileDatasetsOpen: open }),
	setMobileInfoOpen: (open) => set({ mobileInfoOpen: open }),
	setMobileToolsOpen: (open) => set({ mobileToolsOpen: open }),
	setMobileSearchOpen: (open) => set({ mobileSearchOpen: open }),
	setMobileActionsOpen: (open) => set({ mobileActionsOpen: open }),
	setMobileActiveState: (state) =>
		set({
			mobileDatasetsOpen: state === 'datasets',
			mobileInfoOpen: state === 'info',
			mobileToolsOpen: state === 'tools',
			mobileSearchOpen: state === 'search',
			mobileActionsOpen: state === 'actions'
		}),
	setInspectorActive: (active) => set({ inspectorActive: active }),

	// Search Actions
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setSearchResults: (searchResults) => set({ searchResults }),
	setSearchLoading: (searchLoading) => set({ searchLoading }),
	setSearchError: (searchError) => set({ searchError }),

	performSearch: async () => {
		const { searchQuery } = get()
		const trimmed = searchQuery.trim()
		if (!trimmed) {
			set({ searchError: 'Enter a search query', searchResults: [] })
			return
		}

		set({ searchLoading: true, searchError: null })

		try {
			const response = await earthlyGeoServer.SearchLocation(trimmed, 8)
			set({ searchResults: response.result?.results ?? [] })
		} catch (error) {
			set({
				searchError: error instanceof Error ? error.message : 'Search failed',
				searchResults: []
			})
		} finally {
			set({ searchLoading: false })
		}
	},

	clearSearch: () => set({ searchQuery: '', searchResults: [], searchError: null }),

	mapSource: {
		type: 'default',
		location: 'remote',
		url: 'https://build.protomaps.com/20251202.pmtiles'
	},
	showMapSettings: false,

	setMapSource: (mapSource) => set({ mapSource }),
	setShowMapSettings: (showMapSettings) => set({ showMapSettings }),

	updateStats: () => {
		const { features } = get()
		const stats = {
			points: features.filter((f) => f.geometry.type === 'Point').length,
			lines: features.filter((f) => f.geometry.type === 'LineString').length,
			polygons: features.filter((f) => f.geometry.type === 'Polygon').length,
			total: features.length
		}
		set({ stats })
	}
}))
