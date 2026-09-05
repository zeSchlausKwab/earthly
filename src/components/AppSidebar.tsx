import {
	ArrowLeft,
	Bell,
	BookOpen,
	CloudUpload,
	Compass,
	Database,
	Globe,
	MapPin,
	MessageSquare,
	Search,
	Settings,
	Users,
	WalletCards,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import type { MapContext } from '@/lib/nostr/map-context'
import { DEFAULT_WORK_VIEW } from '@/features/geo-editor/defaults'
import { ShoutboxPanel } from './optionalSurfaces.tsx'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { EmbeddedListPanelContext } from './entity-list'
import { StoriesPanelContent } from './StoriesPanel'
import { SightingsPanelContent } from './SightingsPanel'
import { BeaconsPanelContent } from './BeaconsPanel'
import { UserProfilePanel } from './optionalSurfaces.tsx'
import { GeoEditorInfoPanelContent } from './optionalSurfaces.tsx'
import { HelpPanel } from './HelpPanel'
import { PrivateGroupsPanel } from './optionalSurfaces.tsx'
import { FieldSessionsPanel } from './optionalSurfaces.tsx'
import type { FieldDatasetActions } from '@/features/field-sessions/FieldSessionsPanel'
import type { PrivateDatasetActions } from '../features/private-maps/PrivateGeometryReferences'
import { LoginSessionButtons } from '../features/auth/LoginSessionButtons'
import { SignedOutCta } from '../features/auth/SignedOutCta'
import { SignupDialog } from '../features/auth/SignupDialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable'
import { MapSettingsPanel } from './optionalSurfaces.tsx'
import { Nip60Wallet } from './optionalSurfaces.tsx'
import {
	getRetainedDatasetSurfaceTarget,
	hasRetainedDatasetSurface,
	useEditorStore,
	type InspectionSubject,
} from '../features/geo-editor/store'
import {
	navigateToRoute,
	useRouting,
	type SidebarViewMode,
} from '../features/geo-editor/hooks/useRouting'
import type { PlacedSightingGeometry } from '../features/geo-editor/hooks/useSightingEditor'
import type { GeoFeatureItem, StoryViewCapture } from './editor'
import type { StoryViewDraftContext } from './editor/StoryViewDraftContext'
import type {
	MapPresentationAuthorization,
	MapPresentationSource,
	MapPresentationV1,
	StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import type { EditorFeature } from '../features/geo-editor/core'
import { BrowseEntityTabs, EntitySearchPopover, type EntitySearchResult } from './entity-search'
import {
	LocalDraftsPanel,
	type LocalDraftDestinationOption,
	type WorkspaceDraftNavigatorProps,
} from './WorkspaceDraftNavigator'
import { Button } from './ui/button'
import { buildInboxTargetHref, InboxPanel, useInboxFeed } from '../features/inbox'
import { PublishOutboxPanel } from '../features/delivery'
import type { GroupCreationSeed } from '../features/groups/creationSeed'
import type { Group } from '@/lib/nostr/group'
import type { Article } from '@/lib/nostr/article'
import { naddrToCoordinate } from '@/lib/nostr/references'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>
type EntityWorkspace = 'geometry' | 'context' | 'story' | 'sighting' | 'beacon'
type WorkViewMode =
	| 'drafts'
	| 'map-stack'
	| 'datasets'
	| 'contexts'
	| 'field-sessions'
	| 'private-groups'
	| 'stories'
	| 'sightings'
	| 'beacons'
	| 'user'
type MetaViewMode = 'posts' | 'delivery' | 'wallet' | 'settings' | 'help'

const WORK_VIEW_MODES: WorkViewMode[] = [
	'drafts',
	'map-stack',
	'datasets',
	'contexts',
	'field-sessions',
	'private-groups',
	'stories',
	'sightings',
	'beacons',
	'user',
]
const META_VIEW_MODES: MetaViewMode[] = ['posts', 'delivery', 'wallet', 'settings', 'help']

const WORK_VIEW_LABELS: Record<WorkViewMode, string> = {
	drafts: 'Local drafts',
	'map-stack': 'Shelf',
	datasets: 'Maps',
	contexts: 'Atlases',
	'field-sessions': 'Nearby',
	'private-groups': 'Circles',
	stories: 'Stories',
	sightings: 'Sightings',
	beacons: 'Live positions',
	user: 'Me',
}

function isWorkMode(mode: SidebarContentMode): mode is WorkViewMode {
	return (WORK_VIEW_MODES as SidebarContentMode[]).includes(mode)
}

function isMetaMode(mode: SidebarContentMode): mode is MetaViewMode {
	return (META_VIEW_MODES as SidebarContentMode[]).includes(mode)
}

/**
 * Phase 13 (13-uat, finding B): the per-kind inspect-subject state the two
 * show-panel effects read. Extracted as pure predicates so the beacon regression
 * (beacon omitted from BOTH the catalog-override guard and the show-panel switch,
 * which snapped a deep-linked /beacon/:naddr back to the LIST) is pinned by a test
 * without a live React tree. All fields optional so callers pass their raw props.
 */
export interface InspectSubjectState {
	inspectionSubject?: InspectionSubject | null
	viewContext?: unknown
	viewDataset?: unknown
	viewStory?: unknown
	viewSighting?: unknown
	viewBeacon?: unknown
	contextEditorMode?: 'none' | 'create' | 'edit'
	storyEditorMode?: 'none' | 'create' | 'edit'
	sightingEditorMode?: 'none' | 'create' | 'edit'
	beaconControlMode?: 'none' | 'create' | 'adjust'
}

type InspectionEntity<K extends InspectionSubject['kind']> = Extract<
	InspectionSubject,
	{ kind: K }
>['entity']

export interface InspectionSubjectReplayHandlers {
	dataset?: (entity: InspectionEntity<'dataset'>) => void
	context?: (entity: InspectionEntity<'context'>) => void
	story?: (entity: InspectionEntity<'story'>) => void
	sighting?: (entity: InspectionEntity<'sighting'>) => void
	beacon?: (entity: InspectionEntity<'beacon'>) => void
}

/**
 * Re-enter the canonical inspect path whenever the Inspector is recalled. This
 * deliberately does not compare object identity: the panel may already retain
 * the entity while its focused URL was replaced by catalog/editor navigation.
 */
export function replayInspectionSubject(
	subject: InspectionSubject,
	handlers: InspectionSubjectReplayHandlers,
): void {
	switch (subject.kind) {
		case 'dataset':
			handlers.dataset?.(subject.entity)
			break
		case 'context':
			handlers.context?.(subject.entity)
			break
		case 'story':
			handlers.story?.(subject.entity)
			break
		case 'sighting':
			handlers.sighting?.(subject.entity)
			break
		case 'beacon':
			handlers.beacon?.(subject.entity)
			break
	}
}

/** True when ANY kind has an active inspect/edit subject — beacon INCLUDED. */
export function hasActiveInspectSubject(s: InspectSubjectState): boolean {
	return (
		Boolean(s.viewContext) ||
		Boolean(s.viewDataset) ||
		Boolean(s.viewStory) ||
		Boolean(s.viewSighting) ||
		Boolean(s.viewBeacon) ||
		(s.contextEditorMode !== undefined && s.contextEditorMode !== 'none') ||
		(s.storyEditorMode !== undefined && s.storyEditorMode !== 'none') ||
		(s.sightingEditorMode !== undefined && s.sightingEditorMode !== 'none') ||
		(s.beaconControlMode !== undefined && s.beaconControlMode !== 'none')
	)
}

/**
 * The active entity a subject resolves to for the full inspect panel, or null for
 * the catalog list. The normalized subject is authoritative; legacy hook-local
 * subjects are only fallbacks while all inspect flows move onto the shared state.
 */
export function resolveActiveInspectEntity(
	s: InspectSubjectState,
): 'beacon' | 'sighting' | 'story' | 'context' | 'geometry' | null {
	if (s.inspectionSubject) {
		switch (s.inspectionSubject.kind) {
			case 'dataset':
				return 'geometry'
			case 'context':
				return 'context'
			case 'story':
				return 'story'
			case 'sighting':
				return 'sighting'
			case 'beacon':
				return 'beacon'
		}
	}
	// An explicit read subject wins over every retained editor. This is what lets
	// Inspector show Dataset B while a Story or Context draft remains parked.
	if (s.viewBeacon) return 'beacon'
	if (s.viewSighting) return 'sighting'
	if (s.viewStory) return 'story'
	if (s.viewContext) return 'context'
	if (s.viewDataset) return 'geometry'
	if (s.beaconControlMode !== undefined && s.beaconControlMode !== 'none') return 'beacon'
	if (s.sightingEditorMode !== undefined && s.sightingEditorMode !== 'none') return 'sighting'
	if (s.storyEditorMode !== undefined && s.storyEditorMode !== 'none') return 'story'
	if (s.contextEditorMode !== undefined && s.contextEditorMode !== 'none') return 'context'
	return null
}

export interface AppSidebarProps {
	/** The shell preserves sidebar state on phones, but only MobilePanel mounts editors. */
	isMobile?: boolean
	/**
	 * Retained temporarily as an integration seam for callers completing the
	 * atomic shell cutover. The Margin is now the only production presentation.
	 */
	layout?: 'margin'
	/** Detailed `/shelf` surface supplied by the canvas controller. */
	shelfPanel?: ReactNode
	/** @deprecated Global navigation owns Discover in the Margin shell. */
	onOpenDiscover?: () => void
	discoverOpen?: boolean
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	mapGroups?: Group[]
	mapStories?: Article[]
	activeDataset: GeoDataset | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: GeoDataset, options?: DatasetEditOptions) => void
	onStartNewDataset?: () => void
	privateDatasetActions?: PrivateDatasetActions
	fieldDatasetActions?: FieldDatasetActions
	fieldSessionEvents?: import('nostr-tools').NostrEvent[]
	onPublishFieldSessionEvent?: (event: import('nostr-tools').NostrEvent) => Promise<void>
	onRefreshFieldSessionEvents?: () => Promise<void>
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	onLoadDraft?: (workspaceId: string, draftId: string) => void | Promise<void>
	onDeleteDraft?: (workspaceId: string, draftId: string) => void | Promise<void>
	draftDestinationOptions?: LocalDraftDestinationOption[]
	onResolveDraftDestination?: WorkspaceDraftNavigatorProps['onResolveDraftDestination']
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset, source?: 'manual' | 'route' | 'browse-default') => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onOpenGeometryEditor?: () => void
	onInspectDataset: (event: GeoDataset) => void
	onInspectContext: (context: MapContext) => void
	onOpenDebug: (event: GeoDataset | MapContext) => void
	onCreateContext: (creationSeed?: GroupCreationSeed) => void
	onEditContext: (context: MapContext) => void
	isFocused: boolean
	onExitFocus: () => void
	multiSelectModifier?: string
	onCommentGeometryVisibility?: (
		comment: import('@/features/geo-editor/hooks/useCommentGeometry').CommentGeometryRecord,
		visible: boolean,
	) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	isMentionVisible?: (address: string, featureId: string | undefined) => boolean
	contextEditorMode?: 'none' | 'create' | 'edit'
	editingContext?: MapContext | null
	contextCreationSeed?: GroupCreationSeed | null
	onSaveContext?: (context: MapContext) => void
	onCloseContextEditor?: () => void
	/** Story editor mode (Phase 10, D-02/D-03). */
	storyEditorMode?: 'none' | 'create' | 'edit'
	editingStory?: import('@/lib/nostr/article').Article | null
	onCreateStory?: () => void
	onInspectStory?: (story: import('@/lib/nostr/article').Article) => void
	onEditStory?: (story: import('@/lib/nostr/article').Article) => void
	onSaveStory?: (story: import('@/lib/nostr/article').Article) => void
	onCloseStoryEditor?: () => void
	onDeleteStory?: (story: import('@/lib/nostr/article').Article) => void
	onStoryUpdated?: (story: import('@/lib/nostr/article').Article) => void
	captureMapPresentation?: (
		acceptedSources?: readonly MapPresentationSource[] | MapPresentationAuthorization,
	) => MapPresentationV1 | null | undefined
	captureStoryView?: () => StoryViewCapture | null | undefined
	onStoryViewPreviewReset?: (draftKey: string) => void
	onStoryEditorActiveChange?: (draftKey: string, active: boolean) => void
	onStoryViewActivate?: (
		snapshot: StoryViewSnapshotV1,
		index: number,
		draft?: StoryViewDraftContext,
	) => void
	renderStoryViewFigure?: (
		snapshot: StoryViewSnapshotV1,
		index: number,
		draft?: StoryViewDraftContext,
	) => ReactNode
	activeStoryViewId?: string | null
	/** Sighting editor mode (Phase 11, D-01/D-07). */
	sightingEditorMode?: 'none' | 'create' | 'edit'
	editingSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	viewSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	/** The d-tag/id of the last-inspected Sighting — highlights + scrolls its list row
	 * (persists after the detail closes, so a map-marker click is locatable in the list). */
	selectedSightingKey?: string | null
	/** WR-06: comment d-tag to focus beneath the viewed Sighting (survives navigateToView). */
	sightingFocusCommentId?: string
	/** D-10: comment d-tag to focus beneath the viewed Beacon (survives navigateToView). */
	beaconFocusCommentId?: string
	onCreateSighting?: () => void
	onInspectSighting?: (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
		commentId?: string,
	) => void
	onEditSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onSaveSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onCloseSightingEditor?: () => void
	onDeleteSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	/** Fly the map to a Sighting and focus it (the list "zoom to on map" affordance). */
	onZoomToSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	/** Phase 13 (SPEC §3.4): add a Sighting to the Shelf (list + view-panel affordance). */
	onAddSightingToMapStack?: (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
		source?: 'manual' | 'route' | 'browse-default',
	) => void
	/** The geometry placed by the map-first pin-drop, fed to the Sighting editor. */
	placedSightingGeometry?: PlacedSightingGeometry | null
	/** Switch the Sighting create flow to line/polygon draw (D-02). */
	onDrawSightingArea?: () => void
	/** Clear the inspected Sighting (hook-local view state) when browsing a catalog. */
	onClearSightingView?: () => void
	/** Live Beacon (kind 37521) handlers (Phase 12, D-12). All optional — the
	 * Plan-05 control flow threads them; this plan builds standalone with safe
	 * `?? (() => {})` defaults so the Beacons list renders before the controller lands. */
	onShareLocation?: () => void
	onWatchOnMapBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	/** Phase 13 (SPEC §3.4): add a Beacon to the Shelf (list + view-panel affordance). */
	onAddBeaconToMapStack?: (
		beacon: import('@/lib/nostr/live-beacon').LiveBeacon,
		source?: 'manual' | 'route' | 'browse-default' | 'own',
	) => void
	onStopBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	onAdjustBeacon?: (beacon?: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	isFollowingBeacon?: boolean
	onToggleFollowBeacon?: () => void
	/** The d-tag/id of the last-inspected/viewed beacon — highlights + scrolls its list row. */
	selectedBeaconKey?: string | null
	/** Beacon control panel mode (Phase 12, BEACON-01). 'none' ⇒ no control surface. */
	beaconControlMode?: 'none' | 'create' | 'adjust'
	/** The beacon being adjusted — pre-fills the control panel. */
	adjustingBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
	/** The beacon currently inspected in the view panel. */
	viewBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
	/** True while the publisher is starting (Start → "Starting…"). */
	beaconIsStarting?: boolean
	/** Start the publisher session from the control panel. */
	onStartBeacon?: (
		options: import('@/components/info-panel/BeaconControlPanel').BeaconStartOptions,
	) => void
	/** Close the beacon control panel without starting. */
	onCloseBeaconControl?: () => void
	/** Open a beacon in the read/detail view panel. */
	onInspectBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	/** Clear the inspected beacon (hook-local view state) when browsing away. */
	onClearBeaconView?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: { sha256: string; url: string; size: number }) => void
	/** Publish-new action for the contributor Group attach field (GROUP-02/04). */
	onPublishNew?: () => void | Promise<void>
	/** Whether publish-new is currently possible (NEVER gated by validation — GROUP-04). */
	canPublishNew?: boolean
	userPubkey?: string
	focusCommentId?: string
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
	onToggleProposalOverlay?: (proposal: GeoProposal, visible: boolean) => void
	onProposalAccepted?: (dataset: GeoDataset) => void
	visibleProposalIds?: Set<string>
	/** Reports the account-scoped unread count so global chrome can show its badge. */
	onInboxUnreadCountChange?: (count: number) => void
}

export function AppSidebar({
	isMobile = false,
	shelfPanel,
	onOpenDiscover,
	geoEvents,
	mapContextEvents,
	mapGroups,
	mapStories,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	isPublishing,
	deletingKey,
	onLoadDataset,
	onStartNewDataset,
	privateDatasetActions,
	fieldDatasetActions,
	fieldSessionEvents,
	onPublishFieldSessionEvent,
	onRefreshFieldSessionEvents,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onAddDraftToWorkspace,
	onLoadDraft,
	onDeleteDraft,
	draftDestinationOptions,
	onResolveDraftDestination,
	onToggleVisibility,
	onToggleAllVisibility,
	onZoomToDataset,
	onAddDatasetToMap,
	onRemoveDatasetFromMap,
	onDeleteDataset,
	onDeleteContext,
	getDatasetKey,
	getDatasetName,
	onOpenGeometryEditor,
	onInspectDataset,
	onInspectContext,
	onOpenDebug,
	onCreateContext,
	onEditContext,
	isFocused,
	onExitFocus,
	multiSelectModifier = 'Shift',
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	isMentionVisible,
	contextEditorMode = 'none',
	editingContext,
	contextCreationSeed,
	onSaveContext,
	onCloseContextEditor,
	storyEditorMode = 'none',
	editingStory,
	onCreateStory,
	onInspectStory,
	onEditStory,
	onSaveStory,
	onCloseStoryEditor,
	onDeleteStory,
	onStoryUpdated,
	captureMapPresentation,
	captureStoryView,
	onStoryViewPreviewReset,
	onStoryEditorActiveChange,
	onStoryViewActivate,
	renderStoryViewFigure,
	activeStoryViewId,
	sightingEditorMode = 'none',
	editingSighting,
	viewSighting,
	selectedSightingKey,
	sightingFocusCommentId,
	beaconFocusCommentId,
	onCreateSighting,
	onInspectSighting,
	onEditSighting,
	onSaveSighting,
	onCloseSightingEditor,
	onDeleteSighting,
	onZoomToSighting,
	onAddSightingToMapStack,
	placedSightingGeometry,
	onDrawSightingArea,
	onClearSightingView,
	onShareLocation,
	onWatchOnMapBeacon,
	onAddBeaconToMapStack,
	onStopBeacon,
	onAdjustBeacon,
	isFollowingBeacon,
	onToggleFollowBeacon,
	selectedBeaconKey,
	beaconControlMode = 'none',
	adjustingBeacon,
	viewBeacon,
	beaconIsStarting,
	onStartBeacon,
	onCloseBeaconControl,
	onInspectBeacon,
	onZoomToFeature,
	onExitViewMode,
	featureCollectionForUpload,
	onBlossomUploadComplete,
	onPublishNew,
	canPublishNew,
	userPubkey,
	focusCommentId,
	onFilteredDatasetKeysChange,
	onToggleProposalOverlay,
	onProposalAccepted,
	visibleProposalIds,
	onInboxUnreadCountChange,
}: AppSidebarProps) {
	const viewMode = useEditorStore((state) => state.sidebarViewMode)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewContext = useEditorStore((state) => state.viewContext)
	const viewStory = useEditorStore((state) => state.viewStory)
	const inspectionSubject = useEditorStore((state) => state.inspectionSubject)
	const setInspectionSubject = useEditorStore((state) => state.setInspectionSubject)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContextState = useEditorStore((state) => state.setViewContext)
	const setViewStoryState = useEditorStore((state) => state.setViewStory)
	const {
		publicRoute,
		route,
		navigateToView,
		navigateToTab,
		navigateToUser,
		navigateToPrivateGroup,
		navigateToFieldSession,
		navigateToContext,
		clearContextScope,
		contextNaddr,
		privateGroupId,
		fieldSessionId,
		encodeContextNaddr,
	} = useRouting()
	const setStance = useEditorStore((state) => state.setStance)
	const chatOpen = useEditorStore((state) => state.chatOpen)
	const chatDock = useEditorStore((state) => state.chatDock)
	const setChatOpen = useEditorStore((state) => state.setChatOpen)
	// Map task lifetime is the validated workspace -> draft relationship.
	// Shelf state only controls whether that retained geometry is rendered, so
	// hiding/removing `draft:active` must not clear the retained editor or resume target.
	const datasetEditorRetained = useEditorStore(hasRetainedDatasetSurface)
	const datasetEditorResumable = useEditorStore(
		(state) => getRetainedDatasetSurfaceTarget(state) !== null,
	)
	const inbox = useInboxFeed({
		currentUserPubkey,
		geoEvents,
		mapContextEvents,
		getDatasetName,
	})

	useEffect(() => {
		onInboxUnreadCountChange?.(inbox.unreadCount)
	}, [inbox.unreadCount, onInboxUnreadCountChange])

	const handleOpenInboxItem = useCallback((item: (typeof inbox.items)[number]) => {
		const href = buildInboxTargetHref(item.target)
		if (href) navigateToRoute(href)
	}, [])

	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')
	const [authDialogOpen, setAuthDialogOpen] = useState(false)
	const [activeEntity, setActiveEntity] = useState<EntityWorkspace>('geometry')
	const [selectedEntitySurface, setSelectedEntitySurface] = useState<
		'inspector' | 'dataset' | 'story' | 'context' | null
	>(null)
	const [activeWorkMode, setActiveWorkMode] = useState<WorkViewMode>(DEFAULT_WORK_VIEW)
	const [showEntityAsFullPanel, setShowEntityAsFullPanel] = useState(viewMode === 'edit')
	const lastResolvedInspectionSubjectRef = useRef<InspectionSubject | null>(null)
	// Round E.4: the Inspect/Edit toggle's displayed side derives from actual
	// app state instead of a locally-synced mirror. The old `entityIntent`
	// state chronically desynced (starting a draft left the toggle on
	// Inspect). Geometry follows the stance — Author means the editor owns a
	// draft; the context entity follows whether the context editor is open.
	const editorStance = useEditorStore((state) => state.stance)

	const activeContextScope = useMemo(() => {
		if (!contextNaddr) return null
		return mapContextEvents.find((context) => encodeContextNaddr(context) === contextNaddr) ?? null
	}, [contextNaddr, mapContextEvents, encodeContextNaddr])

	const activeContextScopeLabel =
		activeContextScope?.context.name ||
		activeContextScope?.contextId ||
		activeContextScope?.id ||
		undefined

	const handleContextScopeSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const context = result.entity as MapContext
		const naddr = encodeContextNaddr(context)
		if (!naddr) return
		navigateToContext(naddr)
	}

	useEffect(() => {
		if (viewMode === 'combined') {
			setSplitWithEditor(true)
		}
	}, [viewMode])

	const resolveContentMode = (mode: SidebarViewMode): SidebarContentMode =>
		mode === 'combined' ? 'datasets' : mode

	const contentMode = resolveContentMode(viewMode)
	const metaModeActive = isMetaMode(contentMode)
	const browseKind = publicRoute.kind === 'browse' ? (publicRoute.browseKind ?? 'maps') : null

	useEffect(() => {
		if (isWorkMode(contentMode)) {
			setActiveWorkMode(contentMode)
		}
	}, [contentMode])

	useEffect(() => {
		// Round H.6: only force the catalog/meta view to take over when there's no
		// active inspect/edit subject. Otherwise this raced the "subject → show
		// panel" effect below: inspecting a context navigates to the `contexts`
		// route (a work mode), and on the delayed route update this used to win
		// and snap back to the list. Browsing a catalog explicitly clears the
		// subject (handleSelectWorkMode), so the guard still lets you browse.
		const hasInspectSubject = hasActiveInspectSubject({
			viewContext,
			viewDataset,
			viewStory,
			viewSighting,
			viewBeacon,
			contextEditorMode,
			storyEditorMode,
			sightingEditorMode,
			beaconControlMode,
		})
		if (
			!splitWithEditor &&
			!hasInspectSubject &&
			(isWorkMode(contentMode) || isMetaMode(contentMode))
		) {
			setShowEntityAsFullPanel(false)
		}
	}, [
		contentMode,
		splitWithEditor,
		viewContext,
		viewDataset,
		viewStory,
		contextEditorMode,
		storyEditorMode,
		sightingEditorMode,
		viewSighting,
		viewBeacon,
		beaconControlMode,
	])

	useEffect(() => {
		// Phase 13 (13-uat, finding B): resolve the active inspect entity via the pure
		// predicate — beacon is checked FIRST (mirrors currentSurface). A deep-linked or
		// inspected beacon (viewBeacon) or the Share-live-location control
		// (beaconControlMode) now opens the full inspect/control panel instead of
		// snapping back to the beacons LIST.
		const inspectionChanged = inspectionSubject !== lastResolvedInspectionSubjectRef.current
		lastResolvedInspectionSubjectRef.current = inspectionSubject
		// A newly inspected entity can have a different kind (Atlas → Map, for
		// example). Keep a deliberate surface selection only for the same subject.
		if (selectedEntitySurface && showEntityAsFullPanel && !inspectionChanged) return
		// Hiding the Inspector (for a catalog/editor/Chat) retains its subject and
		// legacy per-kind view objects. Those retained values must not reopen it;
		// only a newly inspected subject may claim an otherwise unselected surface.
		if (!showEntityAsFullPanel && !inspectionChanged) return
		const viewingEntity = Boolean(
			viewContext || viewDataset || viewStory || viewSighting || viewBeacon,
		)
		// `inspectionSubject` is deliberately retained while the user browses other
		// surfaces. It disambiguates the Inspector when explicitly recalled, but it
		// must never reopen itself after the user selects a catalog or editor.
		if (!viewingEntity) return
		const activeEntity = resolveActiveInspectEntity({
			// Retained editor modes are intentionally omitted. A background AI write
			// may populate one, but only explicit navigation may reveal it.
			inspectionSubject,
			viewContext,
			viewDataset,
			viewStory,
			viewSighting,
			viewBeacon,
		})
		if (activeEntity) {
			setActiveEntity(activeEntity)
			setSelectedEntitySurface('inspector')
			if (!splitWithEditor) {
				setShowEntityAsFullPanel(true)
			}
		}
	}, [
		splitWithEditor,
		inspectionSubject,
		viewContext,
		viewStory,
		viewSighting,
		viewBeacon,
		viewDataset,
		selectedEntitySurface,
		showEntityAsFullPanel,
	])

	useEffect(() => {
		// `/edit` is reached by the Map Stack row's explicit "Open editor" action.
		// Draft creation by a background Chat run does not navigate here, so it only
		// retains the Dataset edit state and never steals the visible surface.
		if (contentMode !== 'edit' || editorStance !== 'author') return
		setActiveEntity('geometry')
		setSelectedEntitySurface('dataset')
		setShowEntityAsFullPanel(true)
	}, [contentMode, editorStance])

	const editingStoryCoordinate = editingStory
		? `${editingStory.kind}:${editingStory.pubkey}:${editingStory.dTag}`
		: null
	useEffect(() => {
		// Reader pencil links and direct /story/:naddr/edit loads bypass the local
		// button wrappers. Reveal exactly that editor, never an unrelated retained
		// draft populated by Chat in the background.
		if (
			isMobile ||
			publicRoute.kind !== 'story' ||
			!publicRoute.edit ||
			!publicRoute.id ||
			storyEditorMode !== 'edit' ||
			!editingStoryCoordinate ||
			naddrToCoordinate(publicRoute.id) !== editingStoryCoordinate
		)
			return
		setActiveEntity('story')
		setSelectedEntitySurface('story')
		setShowEntityAsFullPanel(true)
		setChatOpen(false)
	}, [
		isMobile,
		publicRoute.kind,
		publicRoute.edit,
		publicRoute.id,
		storyEditorMode,
		editingStoryCoordinate,
		setChatOpen,
	])

	const leaveMetaOverrideIfNeeded = () => {
		if (metaModeActive) {
			navigateToView(activeWorkMode)
		}
	}

	const handleSelectWorkMode = (mode: WorkViewMode) => {
		revealLeftSidebarSurface()
		setActiveWorkMode(mode)
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const handleLoadDataset = (event: GeoDataset, options?: DatasetEditOptions) => {
		onLoadDataset(event, options)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setSelectedEntitySurface('dataset')
		setShowEntityAsFullPanel(true)
	}

	const handleStartNewDataset = onStartNewDataset
		? () => {
				revealLeftSidebarSurface()
				onStartNewDataset()
				leaveMetaOverrideIfNeeded()
				setActiveEntity('geometry')
				setSelectedEntitySurface('dataset')
				setShowEntityAsFullPanel(true)
			}
		: undefined

	const handleInspectDataset = (event: GeoDataset) => {
		revealLeftSidebarSurface()
		onInspectDataset(event)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
	}

	const handleInspectContext = (context: MapContext) => {
		revealLeftSidebarSurface()
		onInspectContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
	}

	const handleCreateContext = () => {
		revealLeftSidebarSurface()
		onCreateContext()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setSelectedEntitySurface('context')
		setShowEntityAsFullPanel(true)
	}

	const handleEditContext = (context: MapContext) => {
		revealLeftSidebarSurface()
		onEditContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setSelectedEntitySurface('context')
		setShowEntityAsFullPanel(true)
	}

	const handleSaveContext = (context: MapContext) => {
		onSaveContext?.(context)
		setShowEntityAsFullPanel(false)
		setSelectedEntitySurface(null)
		setActiveWorkMode('contexts')
		navigateToView('contexts')
	}

	const handleCloseContextEditor = () => {
		onCloseContextEditor?.()
		setShowEntityAsFullPanel(false)
		setSelectedEntitySurface(null)
		setActiveWorkMode('contexts')
		navigateToView('contexts')
	}

	// Story handlers (D-01/D-02/D-03) — mirror the context handlers: each opens the
	// Story surface as the full info panel and marks the active entity as 'story'.
	const handleInspectStory = (story: import('@/lib/nostr/article').Article) => {
		revealLeftSidebarSurface()
		onInspectStory?.(story)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('story')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
	}

	const handleCreateStory = () => {
		revealLeftSidebarSurface()
		onCreateStory?.()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('story')
		setSelectedEntitySurface('story')
		setShowEntityAsFullPanel(true)
	}

	const handleEditStory = (story: import('@/lib/nostr/article').Article) => {
		revealLeftSidebarSurface()
		onEditStory?.(story)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('story')
		setSelectedEntitySurface('story')
		setShowEntityAsFullPanel(true)
	}

	const handleSaveStory = (story: import('@/lib/nostr/article').Article) => {
		onSaveStory?.(story)
		setActiveEntity('story')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
		setActiveWorkMode('stories')
	}

	const handleCloseStoryEditor = () => {
		onCloseStoryEditor?.()
		setShowEntityAsFullPanel(false)
		setSelectedEntitySurface(null)
		setActiveWorkMode('stories')
		navigateToView('stories')
	}

	// Sighting handlers (D-01/D-07) — mirror the Story handlers: each opens the
	// Sighting surface as the full info panel and marks the active entity 'sighting'.
	const handleInspectSighting = (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
	) => {
		setInspectionSubject({ kind: 'sighting', entity: sighting })
		onInspectSighting?.(sighting)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('sighting')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
	}

	const handleCreateSighting = () => {
		onCreateSighting?.()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('sighting')
		setShowEntityAsFullPanel(true)
	}

	const handleEditSighting = (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
	) => {
		onEditSighting?.(sighting)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('sighting')
		setShowEntityAsFullPanel(true)
	}

	const handleSaveSighting = (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
	) => {
		onSaveSighting?.(sighting)
		setActiveEntity('sighting')
		setShowEntityAsFullPanel(true)
		setActiveWorkMode('sightings')
	}

	const handleCloseSightingEditor = () => {
		onCloseSightingEditor?.()
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('sightings')
		navigateToView('sightings')
	}

	// Beacon handlers (Phase 12, BEACON-01..04, D-12) — mirror the Sighting handlers:
	// each opens the beacon surface as the full info panel and marks the active entity
	// 'beacon'. There is NO pin-drop (position comes from GPS).
	const handleShareLocationBeacon = () => {
		onShareLocation?.()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('beacon')
		setShowEntityAsFullPanel(true)
	}

	const handleInspectBeacon = (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => {
		setInspectionSubject({ kind: 'beacon', entity: beacon })
		onInspectBeacon?.(beacon)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('beacon')
		setSelectedEntitySurface('inspector')
		setShowEntityAsFullPanel(true)
	}

	const handleAdjustBeacon = (beacon?: import('@/lib/nostr/live-beacon').LiveBeacon) => {
		onAdjustBeacon?.(beacon)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('beacon')
		setShowEntityAsFullPanel(true)
	}

	const handleCloseBeaconControl = () => {
		onCloseBeaconControl?.()
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('beacons')
		navigateToView('beacons')
	}

	const activeEntityIsEditing =
		(activeEntity === 'geometry' && datasetEditorRetained) ||
		(activeEntity === 'context' && contextEditorMode !== 'none') ||
		(activeEntity === 'story' && storyEditorMode !== 'none') ||
		(activeEntity === 'sighting' && sightingEditorMode !== 'none') ||
		(activeEntity === 'beacon' && beaconControlMode !== 'none')
	const currentEntityIntent: 'inspect' | 'edit' =
		selectedEntitySurface === 'inspector'
			? 'inspect'
			: selectedEntitySurface === 'dataset' ||
					selectedEntitySurface === 'story' ||
					selectedEntitySurface === 'context' ||
					activeEntityIsEditing
				? 'edit'
				: 'inspect'

	const revealLeftSidebarSurface = () => {
		// Chat remains mounted (and any run keeps going); this only reveals the
		// retained sidebar surface the user explicitly selected.
		if (chatOpen && chatDock === 'left') setChatOpen(false)
	}

	const returnToInspector = () => {
		if (!inspectionSubject) return
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		setInspectionSubject(inspectionSubject)
		replayInspectionSubject(inspectionSubject, {
			dataset: onInspectDataset,
			context: onInspectContext,
			story: onInspectStory,
			sighting: onInspectSighting,
			beacon: onInspectBeacon,
		})
		setViewModeState('view')
		setStance('focus')
		setShowEntityAsFullPanel(true)
		setSelectedEntitySurface('inspector')
		setActiveEntity(resolveActiveInspectEntity({ inspectionSubject }) ?? 'geometry')
	}

	const returnToDatasetEditor = () => {
		if (!datasetEditorResumable) return
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		onOpenGeometryEditor?.()
		setActiveEntity('geometry')
		setSelectedEntitySurface('dataset')
		setShowEntityAsFullPanel(true)
	}

	const returnToStoryEditor = () => {
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('story')
		setSelectedEntitySurface('story')
		setShowEntityAsFullPanel(true)
	}

	const returnToContextEditor = () => {
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setSelectedEntitySurface('context')
		setShowEntityAsFullPanel(true)
	}
	const chatOnLeft = chatOpen && chatDock === 'left'
	const inspectorSelected = showEntityAsFullPanel && selectedEntitySurface === 'inspector'
	const datasetEditorSelected = showEntityAsFullPanel && selectedEntitySurface === 'dataset'
	const storyEditorSelected = showEntityAsFullPanel && selectedEntitySurface === 'story'
	const contextEditorSelected = showEntityAsFullPanel && selectedEntitySurface === 'context'
	const hasRetainedSurface =
		Boolean(inspectionSubject) ||
		datasetEditorResumable ||
		storyEditorMode !== 'none' ||
		contextEditorMode !== 'none'

	const datasetsPanelProps = {
		geoEvents,
		mapContextEvents,
		activeDataset,
		currentUserPubkey,
		datasetVisibility,
		isPublishing,
		deletingKey,
		onLoadDataset: handleLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
		onAddDatasetToMap,
		onRemoveDatasetFromMap,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onInspectDataset: handleInspectDataset,
		onInspectContext: handleInspectContext,
		onOpenDebug,
		onStartNewDataset: handleStartNewDataset,
		onCreateContext: handleCreateContext,
		showCreateAction: !browseKind,
		onEditContext: handleEditContext,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
	}

	const storiesPanelProps = {
		currentUserPubkey,
		onOpenStory: handleInspectStory,
		onCreateStory: handleCreateStory,
		showCreateAction: !browseKind,
		onEditStory: handleEditStory,
		onDeleteStory: onDeleteStory ?? (() => {}),
		deletingKey,
	}

	const sightingsPanelProps = {
		currentUserPubkey,
		onOpenSighting: handleInspectSighting,
		onCreateSighting: handleCreateSighting,
		showCreateAction: !browseKind,
		onEditSighting: handleEditSighting,
		onDeleteSighting: onDeleteSighting ?? (() => {}),
		onZoomToSighting,
		onAddToMapStack: onAddSightingToMapStack,
		deletingKey,
		// Highlight + scroll the row of the LAST-inspected Sighting. This persists
		// after the detail panel closes (unlike viewSighting), because viewing a
		// Sighting hides the list behind the full-panel detail — the highlight is
		// only ever visible once you return to the list, when viewSighting is null.
		selectedKey: selectedSightingKey ?? null,
	}

	// Beacons panel props (Phase 12, D-12). The beacon control handlers are the
	// real controller handlers threaded from GeoEditorView via useBeaconController,
	// wrapped so its Share/Open/Adjust actions open the full info panel.
	const beaconsPanelProps = {
		currentUserPubkey,
		onShareLocation: handleShareLocationBeacon,
		onOpenBeacon: handleInspectBeacon,
		onWatchOnMap: onWatchOnMapBeacon,
		onAddToMapStack: onAddBeaconToMapStack,
		onStopBeacon,
		onAdjustBeacon: handleAdjustBeacon,
		selectedKey: selectedBeaconKey ?? null,
	}

	const userProfilePanelProps = {
		geoEvents,
		mapContextEvents,
		currentUserPubkey,
		datasetVisibility,
		isPublishing,
		deletingKey,
		onLoadDataset: handleLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
		onAddDatasetToMap,
		onRemoveDatasetFromMap,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onInspectDataset: handleInspectDataset,
		onSwitchWorkspace,
		onDeleteWorkspace,
		onInspectContext: handleInspectContext,
		onEditContext: handleEditContext,
		onOpenDebug,
	}

	const editorPanelProps = {
		onEditContext: handleEditContext,
		onBackToBrowse: () => handleBackToWorkSurface(),
		currentUserPubkey,
		onLoadDataset: handleLoadDataset,
		onInspectDataset: handleInspectDataset,
		onStartNewDataset: handleStartNewDataset,
		onOpenGeometryEditor,
		onSwitchWorkspace,
		onDeleteWorkspace,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onDeleteContext,
		deletingKey,
		onExitViewMode,
		onClose: () => {},
		getDatasetKey,
		getDatasetName,
		onCommentGeometryVisibility,
		onZoomToBounds,
		onZoomToSighting,
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		isMentionVisible,
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
		contextEditorMode,
		editingContext,
		contextCreationSeed,
		objectTab: route.tab,
		onObjectTabChange: navigateToTab,
		onCreateContext: handleCreateContext,
		onSaveContext: handleSaveContext,
		onCloseContextEditor: handleCloseContextEditor,
		storyEditorMode,
		editingStory,
		onCreateStory: handleCreateStory,
		onSaveStory: handleSaveStory,
		onCloseStoryEditor: handleCloseStoryEditor,
		onEditStory: handleEditStory,
		onDeleteStory,
		onStoryUpdated,
		captureMapPresentation,
		captureStoryView,
		onStoryViewPreviewReset,
		onStoryEditorActiveChange: chatOnLeft ? undefined : onStoryEditorActiveChange,
		onStoryViewActivate,
		renderStoryViewFigure,
		activeStoryViewId,
		sightingEditorMode,
		editingSighting,
		viewSighting,
		sightingFocusCommentId,
		placedSightingGeometry,
		onSaveSighting: handleSaveSighting,
		onCloseSightingEditor: handleCloseSightingEditor,
		onEditSighting: handleEditSighting,
		onDeleteSighting,
		onDrawSightingArea,
		onAddSightingToMapStack,
		beaconFocusCommentId,
		// Beacon control + view (Phase 12, BEACON-01..04, D-12).
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
		beaconIsStarting,
		onStartBeacon,
		onCloseBeaconControl: handleCloseBeaconControl,
		onStopBeacon,
		onAdjustBeacon: handleAdjustBeacon,
		isFollowingBeacon,
		onToggleFollowBeacon,
		onZoomToBeacon: onWatchOnMapBeacon,
		onAddBeaconToMapStack,
		mapContextEvents,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		onPublishNew,
		canPublishNew,
		isPublishing,
		focusCommentId,
		entityWorkspace: activeEntity,
		mapGroups,
		mapStories,
		entityIntent: currentEntityIntent,
	}

	const renderWorkContent = (mode: WorkViewMode) => {
		switch (mode) {
			case 'drafts':
				return (
					<LocalDraftsPanel
						onStartNewDataset={handleStartNewDataset}
						onSwitchWorkspace={onSwitchWorkspace}
						onDeleteWorkspace={onDeleteWorkspace}
						onAddDraftToWorkspace={onAddDraftToWorkspace}
						onLoadDraft={onLoadDraft}
						onDeleteDraft={onDeleteDraft}
						destinationOptions={draftDestinationOptions}
						onResolveDraftDestination={onResolveDraftDestination}
					/>
				)
			case 'map-stack':
				return (
					shelfPanel ?? (
						<div className="flex h-full min-h-48 items-center justify-center px-5 text-center text-sm text-muted-foreground">
							Nothing is on the map yet.
						</div>
					)
				)
			case 'datasets':
				return <GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />
			case 'contexts':
				return <GeoDatasetsPanelContent mode="contexts" {...datasetsPanelProps} />
			case 'field-sessions':
				return (
					<FieldSessionsPanel
						onStartNewDataset={handleStartNewDataset}
						datasetActions={fieldDatasetActions}
						fieldSessionEvents={fieldSessionEvents}
						onPublishFieldSessionEvent={onPublishFieldSessionEvent}
						onRefreshFieldSessionEvents={onRefreshFieldSessionEvents}
						onCommentGeometryVisibility={onCommentGeometryVisibility}
						onZoomToBounds={onZoomToBounds}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
					/>
				)
			case 'private-groups':
				return (
					<PrivateGroupsPanel
						onStartNewDataset={handleStartNewDataset}
						datasetActions={privateDatasetActions}
						onCommentGeometryVisibility={onCommentGeometryVisibility}
						onZoomToBounds={onZoomToBounds}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
					/>
				)
			case 'stories':
				return <StoriesPanelContent {...storiesPanelProps} />
			case 'sightings':
				return <SightingsPanelContent {...sightingsPanelProps} />
			case 'beacons':
				return <BeaconsPanelContent {...beaconsPanelProps} />
			case 'user': {
				if (browseKind === 'people') {
					return (
						<section
							id="browse-people-panel"
							role="tabpanel"
							aria-label="People"
							className="flex min-h-52 flex-col gap-4 p-3"
						>
							<div>
								<h2 className="text-sm font-semibold">Find people</h2>
								<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Search public Nostr profiles by name or key. Opening one keeps the map in place.
								</p>
							</div>
							<EntitySearchPopover
								entityTypes={['person']}
								searchMode="both"
								placeholder="Search people"
								onSelect={(result) => {
									if (result.type === 'person' && result.pubkey) navigateToUser(result.pubkey)
								}}
							/>
						</section>
					)
				}
				const profilePubkey = userPubkey ?? currentUserPubkey
				if (!profilePubkey) {
					return (
						<div className="space-y-3">
							<SignedOutCta
								title="Profile"
								description="Sign in to see your published Maps, Atlases, and Stories in one place."
								onCreateOrSignIn={() => setAuthDialogOpen(true)}
							/>
							<section
								className="border border-border bg-card/55"
								aria-labelledby="signed-out-links-title"
							>
								<h3
									id="signed-out-links-title"
									className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
								>
									Explore Earthly
								</h3>
								<div className="grid grid-cols-3 gap-px bg-border">
									{onOpenDiscover ? (
										<button
											type="button"
											onClick={onOpenDiscover}
											className="flex min-h-14 flex-col items-center justify-center gap-1 bg-card px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<Compass className="h-4 w-4" aria-hidden="true" />
											Discover
										</button>
									) : null}
									{[
										{ label: 'Posts', href: '/posts', icon: MessageSquare },
										{ label: 'Inbox', href: '/inbox', icon: Bell },
										{ label: 'Sync & delivery', href: '/delivery', icon: CloudUpload },
										{ label: 'Wallet', href: '/wallet', icon: WalletCards },
										{ label: 'Circles', href: '/me/circles', icon: Users },
										{ label: 'Nearby', href: '/me/nearby', icon: MapPin },
										{ label: 'Settings', href: '/settings', icon: Settings },
									].map((item) => {
										const Icon = item.icon
										return (
											<button
												key={item.href}
												type="button"
												onClick={() => navigateToRoute(item.href)}
												className="flex min-h-14 flex-col items-center justify-center gap-1 bg-card px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											>
												<Icon className="h-4 w-4" aria-hidden="true" />
												{item.label}
											</button>
										)
									})}
								</div>
							</section>
						</div>
					)
				}
				return (
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-2 border-b border-border px-1 pb-3">
							{onOpenDiscover ? (
								<Button type="button" variant="outline" size="sm" onClick={onOpenDiscover}>
									<Compass className="h-4 w-4" aria-hidden="true" />
									Discover
								</Button>
							) : (
								<span />
							)}
							<LoginSessionButtons />
						</div>
						<UserProfilePanel pubkey={profilePubkey} {...userProfilePanelProps} />
					</div>
				)
			}
		}
	}

	const renderMetaContent = (mode: MetaViewMode) => {
		switch (mode) {
			case 'posts':
				return <ShoutboxPanel />
			case 'delivery':
				return publicRoute.kind === 'inbox' ? (
					<InboxPanel
						currentUserPubkey={currentUserPubkey}
						items={inbox.items}
						unreadCount={inbox.unreadCount}
						isLoading={inbox.isLoading}
						onMarkRead={inbox.markRead}
						onMarkAllRead={inbox.markAllRead}
						onOpenItem={handleOpenInboxItem}
					/>
				) : (
					<PublishOutboxPanel />
				)
			case 'wallet':
				return (
					<div className="p-4">
						<Nip60Wallet />
					</div>
				)
			case 'settings':
				return (
					<div className="p-4">
						<MapSettingsPanel />
					</div>
				)
			case 'help':
				return <HelpPanel multiSelectModifier={multiSelectModifier} />
		}
	}

	// Round H.1: when a catalog drill-in takes over the whole Margin, give the
	// user an explicit way back to the list they came from. Previously the only
	// route back was returning through global navigation.
	const activeWorkModeLabel = WORK_VIEW_LABELS[activeWorkMode]
	const handleBackToWorkSurface = () => {
		if (activeWorkMode === 'private-groups' && privateGroupId) {
			setViewContextState(null)
			setViewDatasetState(null)
			setViewStoryState(null)
			onClearSightingView?.()
			setStance(hasRetainedDatasetSurface(useEditorStore.getState()) ? 'author' : 'browse')
			setShowEntityAsFullPanel(false)
			navigateToPrivateGroup(privateGroupId)
			return
		}
		if (activeWorkMode === 'field-sessions' && fieldSessionId) {
			setViewContextState(null)
			setViewDatasetState(null)
			setViewStoryState(null)
			onClearSightingView?.()
			setShowEntityAsFullPanel(false)
			navigateToFieldSession(fieldSessionId)
			return
		}
		handleSelectWorkMode(activeWorkMode)
	}
	const renderBackToCatalogBar = () => (
		<button
			type="button"
			onClick={handleBackToWorkSurface}
			className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
		>
			<ArrowLeft className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">
				Back to{' '}
				{activeWorkMode === 'private-groups' && privateGroupId
					? 'Circle'
					: activeWorkMode === 'field-sessions' && fieldSessionId
						? 'Nearby'
						: activeWorkModeLabel}
			</span>
		</button>
	)

	// CSS hides this sidebar on phones without unmounting it. Avoid a second
	// hidden editor autosaving the same draft as the visible mobile sheet.
	const renderEntityContent = () =>
		isMobile ? null : <GeoEditorInfoPanelContent {...editorPanelProps} />
	const handleBrowseCreate = (kind: 'maps' | 'stories' | 'atlases' | 'sightings') => {
		switch (kind) {
			case 'maps':
				handleStartNewDataset?.()
				break
			case 'stories':
				handleCreateStory()
				break
			case 'atlases':
				handleCreateContext()
				break
			case 'sightings':
				handleCreateSighting()
				break
		}
	}

	const renderContent = () => {
		if (splitWithEditor && !metaModeActive) {
			return (
				<ResizablePanelGroup orientation="vertical" className="h-full">
					<ResizablePanel id={`${activeEntity}-editor`} defaultSize={52} minSize={20}>
						<div className="h-full min-w-0 overflow-x-hidden overflow-y-auto pr-2 [scrollbar-gutter:stable]">
							{renderEntityContent()}
						</div>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel id={`${activeWorkMode}-panel`} defaultSize={48} minSize={20}>
						<div className="h-full min-w-0 overflow-x-hidden overflow-y-auto pr-2 [scrollbar-gutter:stable]">
							{renderWorkContent(activeWorkMode)}
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			)
		}

		if (metaModeActive && isMetaMode(contentMode)) {
			return (
				<div className="h-full min-h-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
					{renderMetaContent(contentMode)}
				</div>
			)
		}

		if (showEntityAsFullPanel || contentMode === 'edit' || contentMode === 'context-editor') {
			// Show the back bar only when the panel drilled in over a catalog
			// (showEntityAsFullPanel). The dedicated edit/context-editor routes
			// have their own save/cancel exits, so no back bar there.
			return (
				<div className="flex h-full min-h-0 flex-col">
					{showEntityAsFullPanel &&
					!(['geometry', 'story', 'context'].includes(activeEntity) && currentEntityIntent === 'inspect')
						? renderBackToCatalogBar()
						: null}
					<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-2 [scrollbar-gutter:stable]">
						{renderEntityContent()}
					</div>
				</div>
			)
		}

		if (isWorkMode(contentMode)) {
			return renderWorkContent(contentMode)
		}

		return renderWorkContent(activeWorkMode)
	}

	return (
		<aside
			className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--surface-panel)] text-foreground"
			data-layout="margin"
			data-tour="margin"
			aria-label="Margin"
			aria-hidden={chatOnLeft}
			inert={chatOnLeft ? true : undefined}
		>
			{/* Objects own their headers; catalog context does not sit above inspection. */}
			{!showEntityAsFullPanel &&
			contentMode !== 'edit' &&
			contentMode !== 'context-editor' &&
			(!browseKind || contextNaddr) ? (
				<div className="shrink-0 border-b border-border bg-[var(--surface-chrome)] px-3 py-2">
					<div className="flex min-w-0 items-center gap-2">
						<div className="min-w-0 flex-1">
							{contentMode === 'drafts' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Saved on this device
								</div>
							) : contentMode === 'private-groups' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Circle records
								</div>
							) : contentMode === 'field-sessions' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Nearby records
								</div>
							) : contentMode === 'delivery' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									{publicRoute.kind === 'inbox'
										? 'Replies, proposals, and activity'
										: 'Queued and delivered changes'}
								</div>
							) : (
								<EntitySearchPopover
									sources={{ contexts: mapContextEvents }}
									entityTypes={['context']}
									onSelect={handleContextScopeSelect}
									placeholder={
										activeContextScopeLabel ? activeContextScopeLabel : 'Browse all atlases'
									}
									searchMode="local"
									compact
								/>
							)}
						</div>
						{contextNaddr && contentMode !== 'drafts' ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={clearContextScope}
								title="Clear atlas browse scope"
								aria-label="Clear atlas browse scope"
								className="h-7 w-7 rounded-none"
							>
								<X className="h-3.5 w-3.5" />
							</Button>
						) : null}
					</div>
					{hasRetainedSurface && !browseKind ? (
						<nav
							className="mt-2 flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border pt-2"
							aria-label="Return to retained work"
						>
							<span className="mr-1 shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
								Return to
							</span>
							{inspectionSubject ? (
								<Button
									type="button"
									variant={inspectorSelected ? 'secondary' : 'ghost'}
									size="sm"
									onClick={returnToInspector}
									className="h-7 shrink-0 rounded-none border border-border px-2 text-[10px]"
									aria-current={inspectorSelected ? 'page' : undefined}
								>
									<Search className="h-3 w-3" aria-hidden="true" />
									Last viewed
								</Button>
							) : null}
							{datasetEditorResumable ? (
								<Button
									type="button"
									variant={datasetEditorSelected ? 'secondary' : 'ghost'}
									size="sm"
									onClick={returnToDatasetEditor}
									className="h-7 shrink-0 rounded-none border border-border px-2 text-[10px]"
									aria-current={datasetEditorSelected ? 'page' : undefined}
								>
									<Database className="h-3 w-3" aria-hidden="true" />
									Map edit
								</Button>
							) : null}
							{storyEditorMode !== 'none' ? (
								<Button
									type="button"
									variant={storyEditorSelected ? 'secondary' : 'ghost'}
									size="sm"
									onClick={returnToStoryEditor}
									className="h-7 shrink-0 rounded-none border border-border px-2 text-[10px]"
									aria-current={storyEditorSelected ? 'page' : undefined}
								>
									<BookOpen className="h-3 w-3" aria-hidden="true" />
									Story edit
								</Button>
							) : null}
							{contextEditorMode !== 'none' ? (
								<Button
									type="button"
									variant={contextEditorSelected ? 'secondary' : 'ghost'}
									size="sm"
									onClick={returnToContextEditor}
									className="h-7 shrink-0 rounded-none border border-border px-2 text-[10px]"
									aria-current={contextEditorSelected ? 'page' : undefined}
								>
									<Globe className="h-3 w-3" aria-hidden="true" />
									Atlas edit
								</Button>
							) : null}
						</nav>
					) : null}
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 pr-3 [scrollbar-gutter:stable]">
				{browseKind ? (
					<BrowseEntityTabs
						activeKind={browseKind}
						onKindChange={(kind) => navigateToRoute(`/browse/${kind}`)}
						counts={{ maps: geoEvents.length, atlases: mapContextEvents.length }}
						lensItemNoun={contextNaddr ? 'Map' : undefined}
						onCreate={handleBrowseCreate}
						className="mb-2"
					/>
				) : null}
				<div className="min-h-0 flex-1 overflow-hidden">
					<EmbeddedListPanelContext.Provider value={Boolean(browseKind)}>
						{renderContent()}
					</EmbeddedListPanelContext.Provider>
				</div>
			</div>
			<SignupDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
		</aside>
	)
}
import type { DatasetEditOptions } from './info-panel/mapProposalPresentation'
