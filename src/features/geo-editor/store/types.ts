import type { FeatureCollection } from 'geojson'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { ContextFilterMode } from '@/lib/context/validation'
import type { ContextMapScopeMode } from '@/lib/context/scope'
import type { EditorFeature, EditorMode, GeoEditor } from '../core'
import type { CollectionMeta, EditorBlobReference, GeoSearchResult } from '../types'

export type SidebarViewMode =
	| 'datasets'
	| 'map-stack'
	| 'contexts'
	| 'context-editor'
	| 'stories'
	| 'sightings'
	| 'beacons'
	| 'combined'
	| 'edit'
	| 'posts'
	| 'settings'
	| 'help'
	| 'user'
	| 'wallet'
	| 'chat'

/**
 * Phase 1.3: the minimal parsed-route shape consumed by `applyRouteState`. A
 * structural subset of useRouting's `RouteState`, declared here so the store
 * slice doesn't import the routing hook (which imports the store → cycle).
 */
export interface RouteSnapshot {
	sidebarView: SidebarViewMode
	focusType: 'none' | 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon'
	naddr?: string
	contextNaddr?: string
	contextCoordinate?: string
}

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

/**
 * Round C.3: the in-edit draft is also represented as a map-stack entry so the
 * panel honestly reflects what's contributing to the map render. The draft is
 * rendered by the editor's draft layer, not by `visibleGeoEvents`, so the
 * stack entry is cosmetic — but it lets the user see, isolate, and end the
 * edit session from the same surface.
 */
export type MapStackEntryType =
	| 'dataset'
	| 'context'
	| 'comment'
	| 'proposal'
	| 'draft'
	| 'ai-result'
export type MapStackEntrySource =
	| 'manual'
	| 'route'
	| 'context-curated'
	| 'context-foreign'
	| 'child-context'
	| 'chat'
	| 'comment'
	| 'proposal'
	| 'workspace'
	/** Round C.4: auto-populated on cold-start Browse so the user lands on
	 * something instead of a blank map. Distinguishable from `manual` so we
	 * can avoid re-triggering after a clear and so future Clear UX can opt
	 * to wipe only these. */
	| 'browse-default'
	/** Phase 10: a dataset referenced by the currently-viewed Story's narrative,
	 * auto-stacked (visible) on open so the article's geometry shows on the map.
	 * The inline ref eye-toggles read membership of these entries as their single
	 * source of truth; entries are removed when the viewed story changes. */
	| 'story'

export interface MapStackEntry {
	id: string
	entityType: MapStackEntryType
	entityKey: string
	title: string
	source: MapStackEntrySource
	visible: boolean
	pinned: boolean
	/**
	 * When true, ONLY this entry renders on the map — all other map-stack
	 * entries + context-scope filters are bypassed. Mutually exclusive: setting
	 * one entry's `isolated=true` clears it on all others.
	 */
	isolated: boolean
	/**
	 * For context entries (Round C.2): dataset keys the user has unchecked in
	 * the inline expand panel. The map skips these when rendering the context's
	 * curated set. Unused for dataset entries (kept on every entry to avoid a
	 * second optional discriminant).
	 */
	exclusions: string[]
	addedAt: number
}

export type MobilePanelTab =
	| 'datasets'
	| 'map-stack'
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
	activeDataset: GeoDataset | null
	activeDatasetContextRefs: string[]
	resolvingDatasets: Set<string>
	resolvingProgress: Map<string, { loaded: number; total: number }>
	isDirty: boolean

	setCollectionMeta: (meta: CollectionMeta) => void
	setActiveDataset: (dataset: GeoDataset | null) => void
	setIsDirty: (isDirty: boolean) => void
	setActiveDatasetContextRefs: (refs: string[]) => void
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
	viewDataset: GeoDataset | null
	viewContext: MapContext | null
	viewStory: Article | null
	viewContextDatasets: GeoDataset[]
	contextFilterMode: ContextFilterMode
	contextMapScopeMode: ContextMapScopeMode
	activeContextScopeNaddr: string | null
	activeContextScopeCoordinate: string | null

	focusedNaddr: string | null
	focusedType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon' | null
	focusedMapGeometry: {
		bbox: [number, number, number, number]
		datasetId?: string
		sourceEventId?: string
		featureId?: string
	} | null

	setViewMode: (mode: 'edit' | 'view') => void
	setViewDataset: (dataset: GeoDataset | null) => void
	setViewContext: (context: MapContext | null) => void
	setViewStory: (story: Article | null) => void
	setViewContextDatasets: (events: GeoDataset[]) => void
	setContextFilterMode: (mode: ContextFilterMode) => void
	setContextMapScopeMode: (mode: ContextMapScopeMode) => void
	setActiveContextScope: (naddr: string | null, coordinate: string | null) => void
	clearActiveContextScope: () => void

	setFocused: (type: 'geoevent' | 'mapcontext' | 'story' | 'sighting', naddr: string) => void
	clearFocused: () => void
	setFocusedMapGeometry: (focused: ViewModeSlice['focusedMapGeometry']) => void
	clearFocusedMapGeometry: () => void

	/**
	 * Phase 1.3: the single atomic writer of navigation-derived state. Given a
	 * parsed route it reconciles `sidebarViewMode`, focus, context scope,
	 * `viewMode`, and `stance` in one `set()` so they can never drift into the
	 * contradictory combinations the verification report flagged (rec #1).
	 *
	 * Subjects (`viewDataset`/`viewContext`) are cleared here when the route has
	 * no focus — that is the Back/Forward stale-inspector fix (report 7.4). When
	 * focus IS present they are left untouched: the resolver effect in
	 * GeoEditorView fills them once the matching event has streamed in (so this
	 * reducer stays free of event-data lookups).
	 *
	 * It never touches the active draft, the `draft:active` stack entry, or the
	 * workspace — those are edit-session state, owned by applyEditingState /
	 * tearDownEditSession (the draft invariant, Phase 1.4).
	 */
	applyRouteState: (route: RouteSnapshot) => void
}

export interface MapStackSlice {
	mapStackEntries: Record<string, MapStackEntry>
	mapStackOrder: string[]

	addMapStackEntry: (
		entry: Omit<MapStackEntry, 'id' | 'addedAt' | 'isolated' | 'exclusions'> & {
			id?: string
			addedAt?: number
			isolated?: boolean
			exclusions?: string[]
		},
	) => string
	removeMapStackEntry: (id: string) => void
	setMapStackEntryVisible: (id: string, visible: boolean) => void
	toggleMapStackEntryVisible: (id: string) => void
	/**
	 * Mutually exclusive: setting `isolated=true` on one entry clears it on
	 * all others. Setting `isolated=false` clears just that entry.
	 */
	setMapStackEntryIsolated: (id: string, isolated: boolean) => void
	/** Clears the `isolated` flag on every entry. */
	clearMapStackIsolation: () => void
	/**
	 * Round C.2: toggle whether a curated dataset (by its dataset key) is
	 * excluded from a context entry's render. No-op for non-context entries.
	 */
	toggleMapStackEntryExclusion: (id: string, datasetKey: string) => void
	/** Replace the full exclusions list for a context entry. */
	setMapStackEntryExclusions: (id: string, exclusions: string[]) => void
	/** Round G.1: pinned entries survive Clear. */
	toggleMapStackEntryPinned: (id: string) => void
	/**
	 * Round G.1: replace the stack order (drag-to-reorder). Must contain
	 * exactly the current ids — otherwise the call is ignored.
	 */
	setMapStackOrder: (order: string[]) => void
	/**
	 * Removes all entries except pinned ones and the active draft. Pinning is
	 * the contract for "keep this through a Clear".
	 */
	clearMapStack: () => void
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
	/**
	 * True once a search has completed for the current query (P2.1). Lets the
	 * dropdown distinguish "no results found" from "haven't searched yet" so an
	 * empty/failed geocode shows feedback instead of silently rendering nothing
	 * (report 8.1). Reset on every query edit and on clear.
	 */
	searchPerformed: boolean

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
	pointClusteringEnabled: boolean

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
	setPointClusteringEnabled: (enabled: boolean) => void
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

export interface SessionSyncSlice {
	hydrateEditorSessionForPubkey: (pubkey: string | null) => void
}

/** The user's explicit top-level intent — drives UI affordances + transitions. */
export type Stance = 'browse' | 'focus' | 'author'

export interface StanceSlice {
	stance: Stance
	setStance: (stance: Stance) => void
}

/** Round G.2: a recently inspected/loaded catalog entity. */
export interface RecentEntity {
	/** `dataset:<pubkey>:<d>` or `context:<coordinate>` — stack-entry id convention. */
	id: string
	at: number
}

export interface CatalogSlice {
	/** Catalog-level pins (favorites) — distinct from map-stack entry pins. */
	pinnedEntityIds: string[]
	recentEntities: RecentEntity[]
	togglePinnedEntity: (entityId: string) => void
	recordRecentEntity: (entityId: string) => void
	hydrateCatalogPrefsForPubkey: (pubkey: string | null) => void
}

/** Combined state — intersection of all slices */
export type EditorState = EditorCoreSlice &
	DraftSlice &
	WorkspaceSlice &
	MetadataSlice &
	PublishingSlice &
	ViewModeSlice &
	MapStackSlice &
	UISlice &
	SearchSlice &
	MapSourceSlice &
	SessionSyncSlice &
	StanceSlice &
	CatalogSlice
