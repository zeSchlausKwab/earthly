import type { FeatureCollection } from 'geojson'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import type { ContextFilterMode } from '@/lib/context/validation'
import type { ContextMapScopeMode } from '@/lib/context/scope'
import type { EditorFeature, EditorMode, GeoEditor } from '../core'
import type { CollectionMeta, EditorBlobReference, GeoSearchResult } from '../types'

export type SidebarViewMode =
	| 'datasets'
	| 'contexts'
	| 'context-editor'
	| 'combined'
	| 'edit'
	| 'posts'
	| 'settings'
	| 'help'
	| 'user'
	| 'wallet'
	| 'chat'

export interface EditorStats {
	points: number
	lines: number
	polygons: number
	total: number
}

export interface AnnouncementSourceMeta {
	name: string | null
	about: string | null
	pubkey: string | null
	createdAt: number | null
}

export interface MapLayerState {
	id: string
	title: string
	kind: string
	enabled: boolean
	opacity: number
	blossomServer?: string
	file?: string
	pmtilesType?: string
}

export type MobilePanelTab =
	| 'datasets'
	| 'contexts'
	| 'context-editor'
	| 'edit'
	| 'chat'
	| 'profile'
	| 'posts'
	| 'wallet'
	| 'settings'
	| 'help'

export type MobilePanelSnap = 'peek' | 'expanded'

export interface GeoCollectionEditDraft {
	id: string
	sourceId: string
	name: string
	description: string
	collectionMeta: CollectionMeta
	features: EditorFeature[]
	selectedFeatureIds: string[]
	createdAt: number
	updatedAt: number
}

export interface GeoEditorWorkspace {
	id: string
	sourceId: string
	label: string
	kind: 'dataset' | 'scratch'
	datasetKey: string | null
	activeDraftId: string | null
	chatSessionId: string | null
	createdAt: number
	updatedAt: number
}

// --- Slice State Interfaces ---

export interface EditorCoreSlice {
	editor: GeoEditor | null
	features: EditorFeature[]
	stats: EditorStats
	mode: EditorMode
	selectedFeatureIds: string[]
	snappingEnabled: boolean
	panLocked: boolean
	canFinishDrawing: boolean
	history: { canUndo: boolean; canRedo: boolean }

	setEditor: (editor: GeoEditor | null) => void
	setFeatures: (features: EditorFeature[]) => void
	setMode: (mode: EditorMode) => void
	setSelectedFeatureIds: (ids: string[]) => void
	setSnappingEnabled: (enabled: boolean) => void
	setPanLocked: (locked: boolean) => void
	setCanFinishDrawing: (canFinish: boolean) => void
	setHistoryState: (canUndo: boolean, canRedo: boolean) => void
	updateStats: () => void
}

export interface DraftSlice {
	geoEditDrafts: Record<string, GeoCollectionEditDraft>
	activeGeoEditDraftId: string | null

	createGeoEditDraft: (
		sourceId: string,
		seed?: Partial<
			Pick<
				GeoCollectionEditDraft,
				'name' | 'description' | 'collectionMeta' | 'features' | 'selectedFeatureIds'
			>
		>,
	) => string
	setActiveGeoEditDraftId: (id: string | null) => void
	saveGeoEditDraft: (
		id: string,
		updates: Partial<
			Pick<
				GeoCollectionEditDraft,
				'sourceId' | 'name' | 'description' | 'collectionMeta' | 'features' | 'selectedFeatureIds'
			>
		>,
	) => void
	loadGeoEditDraft: (id: string) => void
	deleteGeoEditDraft: (id: string) => void
}

export interface WorkspaceSlice {
	workspaces: Record<string, GeoEditorWorkspace>
	activeWorkspaceId: string | null

	createWorkspace: (input: {
		sourceId: string
		label: string
		kind: GeoEditorWorkspace['kind']
		datasetKey?: string | null
		activeDraftId?: string | null
		chatSessionId?: string | null
	}) => string
	updateWorkspace: (
		id: string,
		updates: Partial<Omit<GeoEditorWorkspace, 'id' | 'createdAt'>>,
	) => void
	deleteWorkspace: (id: string) => void
	setActiveWorkspaceId: (id: string | null) => void
	touchActiveWorkspace: (
		updates?: Partial<
			Pick<GeoEditorWorkspace, 'label' | 'activeDraftId' | 'chatSessionId' | 'datasetKey'>
		>,
	) => void
}

export interface MetadataSlice {
	collectionMeta: CollectionMeta
	activeDataset: NDKGeoEvent | null
	activeDatasetContextRefs: string[]
	datasetVisibility: Record<string, boolean>
	resolvingDatasets: Set<string>
	resolvingProgress: Map<string, { loaded: number; total: number }>

	setCollectionMeta: (meta: CollectionMeta) => void
	setActiveDataset: (dataset: NDKGeoEvent | null) => void
	setActiveDatasetContextRefs: (refs: string[]) => void
	setDatasetVisibility: (
		visibility:
			| Record<string, boolean>
			| ((prev: Record<string, boolean>) => Record<string, boolean>),
	) => void
	setDatasetResolving: (datasetKey: string, resolving: boolean) => void
	setDatasetResolvingProgress: (datasetKey: string, loaded: number, total: number) => void
}

export interface PublishingSlice {
	isPublishing: boolean
	publishMessage: string | null
	publishError: string | null
	blossomUploadDialogOpen: boolean
	pendingPublishCollection: FeatureCollection | null

	blobReferences: EditorBlobReference[]
	blobDraftUrl: string
	blobDraftStatus: 'idle' | 'loading' | 'error'
	blobDraftError: string | null
	previewingBlobReferenceId: string | null
	blobPreviewCollection: FeatureCollection | null

	setIsPublishing: (isPublishing: boolean) => void
	setPublishMessage: (message: string | null) => void
	setPublishError: (error: string | null) => void
	setBlossomUploadDialogOpen: (open: boolean) => void
	setPendingPublishCollection: (collection: FeatureCollection | null) => void

	setBlobReferences: (refs: EditorBlobReference[]) => void
	setBlobDraftUrl: (url: string) => void
	setBlobDraftStatus: (status: 'idle' | 'loading' | 'error') => void
	setBlobDraftError: (error: string | null) => void
	setPreviewingBlobReferenceId: (id: string | null) => void
	setBlobPreviewCollection: (collection: FeatureCollection | null) => void

	fetchBlobReference: () => Promise<void>
	previewBlobReference: (id: string) => Promise<void>
	removeBlobReference: (id: string) => void
}

export interface ViewModeSlice {
	viewMode: 'edit' | 'view'
	editIsolationEnabled: boolean
	viewDataset: NDKGeoEvent | null
	viewContext: NDKMapContextEvent | null
	viewContextDatasets: NDKGeoEvent[]
	contextFilterMode: ContextFilterMode
	contextMapScopeMode: ContextMapScopeMode
	activeContextScopeNaddr: string | null
	activeContextScopeCoordinate: string | null

	focusedNaddr: string | null
	focusedType: 'geoevent' | 'mapcontext' | null
	focusedMapGeometry: {
		bbox: [number, number, number, number]
		datasetId?: string
		sourceEventId?: string
		featureId?: string
	} | null

	setViewMode: (mode: 'edit' | 'view') => void
	setViewDataset: (dataset: NDKGeoEvent | null) => void
	setViewContext: (context: NDKMapContextEvent | null) => void
	setViewContextDatasets: (events: NDKGeoEvent[]) => void
	setContextFilterMode: (mode: ContextFilterMode) => void
	setContextMapScopeMode: (mode: ContextMapScopeMode) => void
	setActiveContextScope: (naddr: string | null, coordinate: string | null) => void
	clearActiveContextScope: () => void
	setEditIsolationEnabled: (enabled: boolean) => void
	toggleEditIsolation: () => void

	setFocused: (type: 'geoevent' | 'mapcontext', naddr: string) => void
	clearFocused: () => void
	setFocusedMapGeometry: (focused: ViewModeSlice['focusedMapGeometry']) => void
	clearFocusedMapGeometry: () => void
}

export interface UISlice {
	newCollectionProp: { key: string; value: string }
	newFeatureProp: { key: string; value: string }

	showTips: boolean
	showDatasetsPanel: boolean
	showInfoPanel: boolean
	mobileDatasetsOpen: boolean
	mobileInfoOpen: boolean
	mobileToolsOpen: boolean
	mobileSearchOpen: boolean
	mobileActionsOpen: boolean
	mobilePanelOpen: boolean
	mobilePanelTab: MobilePanelTab
	mobilePanelSnap: MobilePanelSnap
	inspectorActive: boolean
	sidebarViewMode: SidebarViewMode
	sidebarExpanded: boolean

	setNewCollectionProp: (prop: { key: string; value: string }) => void
	setNewFeatureProp: (prop: { key: string; value: string }) => void

	setShowTips: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowDatasetsPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowInfoPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setMobileDatasetsOpen: (open: boolean) => void
	setMobileInfoOpen: (open: boolean) => void
	setMobileToolsOpen: (open: boolean) => void
	setMobileSearchOpen: (open: boolean) => void
	setMobileActionsOpen: (open: boolean) => void
	setMobileActiveState: (state: 'datasets' | 'info' | 'tools' | 'search' | 'actions' | null) => void
	setMobilePanelOpen: (open: boolean) => void
	setMobilePanelTab: (tab: MobilePanelTab) => void
	setMobilePanelSnap: (snap: MobilePanelSnap) => void
	openMobilePanel: (tab?: MobilePanelTab) => void
	closeMobilePanel: () => void
	setInspectorActive: (active: boolean) => void
	setSidebarViewMode: (mode: SidebarViewMode) => void
	setSidebarExpanded: (expanded: boolean) => void
	toggleSidebarExpanded: () => void
}

export interface SearchSlice {
	searchQuery: string
	searchResults: GeoSearchResult[]
	searchLoading: boolean
	searchError: string | null

	osmQueryMode: 'idle' | 'click' | 'loading'
	osmQueryFilter: string
	osmQueryPosition: { x: number; y: number; lat: number; lon: number } | null
	osmQueryResults: GeoJSON.Feature[]
	osmQueryError: string | null
	osmQuerySelectedIds: Set<string>

	setSearchQuery: (query: string) => void
	setSearchResults: (results: GeoSearchResult[]) => void
	setSearchLoading: (loading: boolean) => void
	setSearchError: (error: string | null) => void
	performSearch: () => Promise<void>
	clearSearch: () => void

	setOsmQueryMode: (mode: 'idle' | 'click' | 'loading') => void
	setOsmQueryFilter: (filter: string) => void
	setOsmQueryPosition: (position: { x: number; y: number; lat: number; lon: number } | null) => void
	setOsmQueryResults: (results: GeoJSON.Feature[]) => void
	setOsmQueryError: (error: string | null) => void
	toggleOsmQuerySelection: (id: string) => void
	clearOsmQuery: () => void
}

export interface MapSourceSlice {
	mapSource: {
		type: 'default' | 'pmtiles' | 'blossom'
		location: 'remote' | 'local'
		url?: string
		file?: File
		blossomServer?: string
		boundsLocked?: boolean
	}
	showMapSettings: boolean

	mapLayers: MapLayerState[]
	announcementSource: AnnouncementSourceMeta | null

	currentBbox: [number, number, number, number] | null
	mapAreaRect: {
		bbox: [number, number, number, number]
		areaSqKm: number
	} | null
	isDrawingMapArea: boolean

	setMapSource: (source: MapSourceSlice['mapSource']) => void
	setShowMapSettings: (show: boolean) => void
	setMapLayers: (layers: MapLayerState[]) => void
	updateMapLayerState: (
		id: string,
		updates: Partial<Pick<MapLayerState, 'enabled' | 'opacity'>>,
	) => void
	reorderMapLayers: (fromIndex: number, toIndex: number) => void
	setAnnouncementSource: (meta: AnnouncementSourceMeta | null) => void
	setCurrentBbox: (bbox: [number, number, number, number] | null) => void
	setMapAreaRect: (rect: MapSourceSlice['mapAreaRect']) => void
	clearMapAreaRect: () => void
	setIsDrawingMapArea: (drawing: boolean) => void
}

/** Combined state — intersection of all slices */
export type EditorState = EditorCoreSlice &
	DraftSlice &
	WorkspaceSlice &
	MetadataSlice &
	PublishingSlice &
	ViewModeSlice &
	UISlice &
	SearchSlice &
	MapSourceSlice
