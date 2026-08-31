import {
	AlertTriangle,
	Database,
	Globe,
	HelpCircle,
	BookOpen,
	CloudUpload,
	Compass,
	Eye,
	FilePenLine,
	Newspaper,
	LoaderCircle,
	MessageCircle,
	PanelLeftClose,
	PanelLeftOpen,
	ArrowLeft,
	Radio,
	RadioTower,
	Search,
	Settings2,
	UserCircle,
	UsersRound,
	Wallet,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import type { MapContext } from '@/lib/nostr/map-context'
import { DEFAULT_WORK_VIEW } from '@/features/geo-editor/defaults'
import squareLogoRose from '../assets/square_logo_rose.svg'
import { ShoutboxPanel } from '../features/social/shoutbox'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { StoriesPanelContent } from './StoriesPanel'
import { SightingsPanelContent } from './SightingsPanel'
import { BeaconsPanelContent } from './BeaconsPanel'
import { UserProfilePanel } from './UserProfilePanel'
import { GeoEditorInfoPanelContent } from './GeoEditorInfoPanel'
import { HelpPanel } from './HelpPanel'
import { PrivateGroupsPanel } from '../features/private-maps/PrivateMapsDialog'
import {
	FieldSessionsPanel,
	type FieldDatasetActions,
} from '../features/field-sessions/FieldSessionsPanel'
import type { PrivateDatasetActions } from '../features/private-maps/PrivateGeometryReferences'
import { LoginSessionButtons } from '../features/auth/LoginSessionButtons'
import { SignedOutCta } from '../features/auth/SignedOutCta'
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from './ui/sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable'
import { MapSettingsPanel } from '../features/geo-editor/components/MapSettingsPanel'
import { Nip60Wallet } from '../features/wallet/components/Nip60Wallet'
import {
	getRetainedDatasetSurfaceTarget,
	hasRetainedDatasetSurface,
	useEditorStore,
	type InspectionSubject,
} from '../features/geo-editor/store'
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'
import { EntitySearchPopover, type EntitySearchResult } from './entity-search'
import {
	LocalDraftsPanel,
	type LocalDraftDestinationOption,
	type WorkspaceDraftNavigatorProps,
	WorkspaceDraftNavigator,
} from './WorkspaceDraftNavigator'
import { Button } from './ui/button'
import { PublishOutboxPanel } from '../features/delivery'
import { useChatStore } from '../features/chat/store'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>
type EntityWorkspace = 'geometry' | 'context' | 'story' | 'sighting' | 'beacon'
type WorkViewMode =
	| 'drafts'
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

// Round H.3/H.4: the rail's browse destinations (Datasets / Contexts / My
// Entities + footer meta) are the always-present list. The Round-F.4
// Inspector/Editor "surface" buttons that used to sit as their peers caused
// confusion (always present, identical styling, empty-void when nothing was
// being edited). H.4 reinstates a single CONTEXTUAL surface entry above the
// catalogs — it appears only while you're editing or inspecting (derived from
// stance), separated by its own group + divider, and is the return path to the
// editor/inspector panel after you navigate off to a catalog.

const workNavItems: {
	mode: WorkViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'drafts', title: 'Local drafts', icon: FilePenLine },
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'contexts', title: 'Contexts', icon: Globe },
	{ mode: 'field-sessions', title: 'Field sessions', icon: RadioTower },
	{ mode: 'private-groups', title: 'Private groups', icon: UsersRound },
	{ mode: 'stories', title: 'Stories', icon: BookOpen },
	{ mode: 'sightings', title: 'Sightings', icon: Eye },
	{ mode: 'beacons', title: 'Beacons', icon: Radio },
	{ mode: 'user', title: 'My Entities', icon: UserCircle },
]

const metaNavItems: {
	mode: MetaViewMode
	title: string
	icon: typeof Settings2
}[] = [
	{ mode: 'posts', title: 'Local posts', icon: Newspaper },
	{ mode: 'delivery', title: 'Sync & delivery', icon: CloudUpload },
	{ mode: 'wallet', title: 'Wallet', icon: Wallet },
	{ mode: 'settings', title: 'Settings', icon: Settings2 },
	{ mode: 'help', title: 'Help', icon: HelpCircle },
]

function SidebarDangerMarker() {
	return (
		<span className="inline-flex shrink-0 items-center justify-center text-orange-500">
			<AlertTriangle className="h-3.5 w-3.5" />
		</span>
	)
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

interface AppSidebarProps {
	onOpenDiscover: () => void
	discoverOpen?: boolean
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	activeDataset: GeoDataset | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: GeoDataset) => void
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
	onCreateContext: () => void
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
	/** Sighting editor mode (Phase 11, D-01/D-07). */
	sightingEditorMode?: 'none' | 'create' | 'edit'
	editingSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	viewSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	/** The d-tag/id of the last-inspected Sighting — highlights + scrolls its rail row
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
	/** Fly the map to a Sighting and focus it (the rail "zoom to on map" affordance). */
	onZoomToSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	/** Phase 13 (SPEC §3.4): add a Sighting to the Map Stack (rail + view-panel affordance). */
	onAddSightingToMapStack?: (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
		source?: 'manual' | 'route' | 'browse-default',
	) => void
	/** The geometry placed by the map-first pin-drop, fed to the Sighting editor. */
	placedSightingGeometry?: import('geojson').Geometry | null
	/** Switch the Sighting create flow to line/polygon draw (D-02). */
	onDrawSightingArea?: () => void
	/** Clear the inspected Sighting (hook-local view state) when browsing a catalog. */
	onClearSightingView?: () => void
	/** Live Beacon (kind 37521) handlers (Phase 12, D-12). All optional — the
	 * Plan-05 control flow threads them; this plan builds standalone with safe
	 * `?? (() => {})` defaults so the Beacons rail renders before the controller lands. */
	onShareLocation?: () => void
	onWatchOnMapBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	/** Phase 13 (SPEC §3.4): add a Beacon to the Map Stack (rail + view-panel affordance). */
	onAddBeaconToMapStack?: (
		beacon: import('@/lib/nostr/live-beacon').LiveBeacon,
		source?: 'manual' | 'route' | 'browse-default' | 'own',
	) => void
	onStopBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	onAdjustBeacon?: (beacon?: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	isFollowingBeacon?: boolean
	onToggleFollowBeacon?: () => void
	/** The d-tag/id of the last-inspected/viewed beacon — highlights + scrolls its rail row. */
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
}

export function AppSidebar({
	onOpenDiscover,
	discoverOpen = false,
	geoEvents,
	mapContextEvents,
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
}: AppSidebarProps) {
	const { setOpen, sidebarExpanded, setSidebarExpanded } = useSidebar()
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
		navigateToView,
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
	const toggleChatAtDock = useEditorStore((state) => state.toggleChatAtDock)
	// Dataset task lifetime is the validated workspace -> draft relationship.
	// Map Stack only controls whether that retained geometry is rendered, so
	// hiding/removing `draft:active` must not clear the rail indicator or resume.
	const datasetEditorRetained = useEditorStore(hasRetainedDatasetSurface)
	const datasetEditorResumable = useEditorStore(
		(state) => getRetainedDatasetSurfaceTarget(state) !== null,
	)
	const runningChatId = useChatStore((state) => state.runningChatId)
	const activeChatRun = useChatStore((state) => state.activeRun)
	const chatWorking = runningChatId !== null
	const datasetAiWorking = activeChatRun?.target.entityType === 'dataset'
	const storyAiWorking = activeChatRun?.target.entityType === 'story'
	const contextAiWorking = activeChatRun?.target.entityType === 'context'

	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')
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
		if (selectedEntitySurface && showEntityAsFullPanel) return
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
			// may populate one, but only the corresponding rail button may reveal it.
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
		// lights the Dataset rail state and never steals the visible surface.
		if (contentMode !== 'edit' || editorStance !== 'author') return
		setActiveEntity('geometry')
		setSelectedEntitySurface('dataset')
		setShowEntityAsFullPanel(true)
	}, [contentMode, editorStance])

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

	const handleSelectMetaMode = (mode: MetaViewMode) => {
		revealLeftSidebarSurface()
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const handleLoadDataset = (event: GeoDataset) => {
		onLoadDataset(event)
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
				setOpen(true)
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
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		if (inspectionSubject) {
			setInspectionSubject(inspectionSubject)
			// Re-enter through the kind's side-effect-free inspect path so the
			// visible Inspector and the share/reload URL describe the same subject.
			// None of these paths may add to the Map Stack or alter Context scope.
			replayInspectionSubject(inspectionSubject, {
				dataset: onInspectDataset,
				context: onInspectContext,
				story: onInspectStory,
				sighting: onInspectSighting,
				beacon: onInspectBeacon,
			})
			setViewModeState('view')
			setStance('focus')
		}
		setShowEntityAsFullPanel(true)
		setSelectedEntitySurface('inspector')
		setActiveEntity(
			inspectionSubject?.kind === 'story'
				? 'story'
				: inspectionSubject?.kind === 'context'
					? 'context'
					: inspectionSubject?.kind === 'dataset'
						? 'geometry'
						: inspectionSubject?.kind === 'sighting'
							? 'sighting'
							: inspectionSubject?.kind === 'beacon'
								? 'beacon'
								: viewBeacon
									? 'beacon'
									: viewSighting
										? 'sighting'
										: viewStory
											? 'story'
											: viewContext
												? 'context'
												: 'geometry',
		)
		setOpen(true)
	}

	const returnToDatasetEditor = () => {
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		// The rail is a return affordance, never a create command. It reveals the
		// validated active task without changing workspace or Map Stack visibility;
		// `/edit`, stance, and the editor interaction boundary are presentation here.
		if (datasetEditorResumable) onOpenGeometryEditor?.()
		setActiveEntity('geometry')
		setSelectedEntitySurface('dataset')
		setShowEntityAsFullPanel(true)
		setOpen(true)
	}

	const returnToStoryEditor = () => {
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('story')
		setSelectedEntitySurface('story')
		setShowEntityAsFullPanel(true)
		setOpen(true)
	}

	const returnToContextEditor = () => {
		revealLeftSidebarSurface()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setSelectedEntitySurface('context')
		setShowEntityAsFullPanel(true)
		setOpen(true)
	}

	const toggleChatOnLeft = () => {
		const openingOnLeft = !chatOpen || chatDock !== 'left'
		if (openingOnLeft) setOpen(true)
		toggleChatAtDock('left')
	}
	const chatOnLeft = chatOpen && chatDock === 'left'
	const leftChatButtonLabel = chatOnLeft
		? 'Hide AI chat'
		: chatOpen
			? 'Move AI chat to the left'
			: chatWorking
				? 'AI chat is working; show it on the left'
				: 'Show AI chat on the left'
	const inspectorRetained = Boolean(
		inspectionSubject || viewDataset || viewContext || viewStory || viewSighting || viewBeacon,
	)
	const inspectorSelected =
		!chatOnLeft && showEntityAsFullPanel && selectedEntitySurface === 'inspector'
	const datasetEditorSelected =
		!chatOnLeft && showEntityAsFullPanel && selectedEntitySurface === 'dataset'
	const storyEditorSelected =
		!chatOnLeft && showEntityAsFullPanel && selectedEntitySurface === 'story'
	const contextEditorSelected =
		!chatOnLeft && showEntityAsFullPanel && selectedEntitySurface === 'context'

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
		onEditContext: handleEditContext,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
	}

	const storiesPanelProps = {
		currentUserPubkey,
		onOpenStory: handleInspectStory,
		onCreateStory: handleCreateStory,
		onEditStory: handleEditStory,
		onDeleteStory: onDeleteStory ?? (() => {}),
		deletingKey,
	}

	const sightingsPanelProps = {
		currentUserPubkey,
		onOpenSighting: handleInspectSighting,
		onCreateSighting: handleCreateSighting,
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

	// Beacons rail panel props (Phase 12, D-12). The beacon control handlers are the
	// real controller handlers threaded from GeoEditorView via useBeaconController,
	// wrapped so the rail's Share/Open/Adjust actions open the full info panel.
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
				const profilePubkey = userPubkey ?? currentUserPubkey
				if (!profilePubkey) {
					return (
						<SignedOutCta
							title="Profile"
							description="Sign in to see your published datasets, contexts, and stories in one place."
						/>
					)
				}
				return <UserProfilePanel pubkey={profilePubkey} {...userProfilePanelProps} />
			}
		}
	}

	const renderMetaContent = (mode: MetaViewMode) => {
		switch (mode) {
			case 'posts':
				return <ShoutboxPanel />
			case 'delivery':
				return <PublishOutboxPanel />
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

	// Round H.1: when a catalog drill-in takes over the whole sidebar, give the
	// user an explicit way back to the list they came from. Previously the only
	// route back was hunting for the rail nav item.
	const activeWorkModeLabel =
		workNavItems.find((item) => item.mode === activeWorkMode)?.title ?? 'list'
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
					? 'private group'
					: activeWorkMode === 'field-sessions' && fieldSessionId
						? 'field session'
						: activeWorkModeLabel}
			</span>
		</button>
	)

	const renderEntityContent = () => <GeoEditorInfoPanelContent {...editorPanelProps} />

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
			return renderMetaContent(contentMode)
		}

		if (showEntityAsFullPanel || contentMode === 'edit' || contentMode === 'context-editor') {
			// Show the back bar only when the panel drilled in over a catalog
			// (showEntityAsFullPanel). The dedicated edit/context-editor routes
			// have their own save/cancel exits, so no back bar there.
			return (
				<div className="flex h-full min-h-0 flex-col">
					{showEntityAsFullPanel ? renderBackToCatalogBar() : null}
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
		<Sidebar collapsible="icon" className="overflow-hidden *:data-[sidebar=sidebar]:flex-row">
			<Sidebar
				collapsible="none"
				className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
				data-tour="sidebar-nav"
			>
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
								<a href="/">
									<div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-sidebar-border/70 bg-card">
										<img src={squareLogoRose} alt="" className="size-6 object-contain" />
									</div>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">Earthly</span>
										<span className="truncate text-xs">Geo Editor</span>
									</div>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>

				<SidebarContent>
					{/* Stable work surfaces. Their presence never implies that a draft
					    exists; the small dot does. Selecting one changes only the visible
					    left surface. A hidden Chat and its run remain mounted. */}
					<SidebarGroup className="border-sidebar-border border-b pb-1">
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: 'Inspector', hidden: false }}
										onClick={returnToInspector}
										isActive={inspectorSelected}
										className="relative px-2.5 md:px-2 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
									>
										<Search />
										{inspectorRetained ? (
											<span className="pointer-events-none absolute left-5 top-1 size-1.5 rounded-full bg-emerald-400 ring-2 ring-sidebar" />
										) : null}
										<span>Inspector</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: 'Dataset editor', hidden: false }}
										onClick={returnToDatasetEditor}
										isActive={datasetEditorSelected}
										className="relative px-2.5 md:px-2 data-[active=true]:bg-edit data-[active=true]:text-white"
									>
										{datasetAiWorking ? <LoaderCircle className="animate-spin" /> : <Database />}
										{datasetEditorRetained ? (
											<span className="pointer-events-none absolute left-5 top-1 size-1.5 rounded-full bg-edit ring-2 ring-sidebar" />
										) : null}
										<span>Dataset</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: 'Story editor', hidden: false }}
										onClick={returnToStoryEditor}
										isActive={storyEditorSelected}
										className="relative px-2.5 md:px-2 data-[active=true]:bg-edit data-[active=true]:text-white"
									>
										{storyAiWorking ? <LoaderCircle className="animate-spin" /> : <BookOpen />}
										{storyEditorMode !== 'none' ? (
											<span className="pointer-events-none absolute left-5 top-1 size-1.5 rounded-full bg-edit ring-2 ring-sidebar" />
										) : null}
										<span>Story</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: 'Context editor', hidden: false }}
										onClick={returnToContextEditor}
										isActive={contextEditorSelected}
										className="relative px-2.5 md:px-2 data-[active=true]:bg-edit data-[active=true]:text-white"
									>
										{contextAiWorking ? <LoaderCircle className="animate-spin" /> : <Globe />}
										{contextEditorMode !== 'none' ? (
											<span className="pointer-events-none absolute left-5 top-1 size-1.5 rounded-full bg-edit ring-2 ring-sidebar" />
										) : null}
										<span>Context</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								<SidebarMenuItem className="mt-1 border-t border-sidebar-border pt-1">
									<SidebarMenuButton
										tooltip={{
											children: leftChatButtonLabel,
											hidden: false,
										}}
										aria-label={leftChatButtonLabel}
										onClick={toggleChatOnLeft}
										isActive={chatOnLeft}
										className="relative px-2.5 md:px-2 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
										data-tour="sidebar-chat-left"
									>
										{chatWorking ? <LoaderCircle className="animate-spin" /> : <MessageCircle />}
										<span>Chat</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup className="border-sidebar-border border-b pb-1">
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								<SidebarMenuItem data-tour="sidebar-discover">
									<SidebarMenuButton
										tooltip={{ children: 'Discover', hidden: false }}
										onClick={() => {
											revealLeftSidebarSurface()
											onOpenDiscover()
										}}
										isActive={discoverOpen}
										className="border border-sidebar-border/70 bg-sidebar-accent/20 px-2.5 text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground md:px-2"
									>
										<Compass />
										<span>Discover</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup>
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								{workNavItems.map((item) => (
									<SidebarMenuItem
										key={item.mode}
										data-tour={
											item.mode === 'datasets'
												? 'sidebar-datasets'
												: item.mode === 'contexts'
													? 'sidebar-contexts'
													: item.mode === 'user'
														? 'sidebar-my-entities'
														: undefined
										}
									>
										<SidebarMenuButton
											tooltip={{ children: item.title, hidden: false }}
											onClick={() => {
												handleSelectWorkMode(item.mode)
												setOpen(true)
											}}
											isActive={
												isWorkMode(contentMode) &&
												contentMode === item.mode &&
												(!showEntityAsFullPanel || splitWithEditor)
											}
											className="px-2.5 md:px-2 data-[active=true]:border-l-2 data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium"
										>
											<item.icon />
											<span>{item.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter className="border-t border-sidebar-border">
					<SidebarMenu>
						{metaNavItems.map((item) => (
							<SidebarMenuItem
								key={item.mode}
								data-tour={item.mode === 'help' ? 'sidebar-help' : undefined}
							>
								<SidebarMenuButton
									tooltip={{
										children:
											item.mode === 'wallet' ? (
												<span className="inline-flex items-center gap-1.5">
													<span>{item.title}</span>
													<span className="text-orange-400">danger</span>
												</span>
											) : (
												item.title
											),
										hidden: false,
									}}
									onClick={() => {
										handleSelectMetaMode(item.mode)
										setOpen(true)
									}}
									isActive={isMetaMode(contentMode) && contentMode === item.mode}
									className="relative px-2.5 md:px-2"
								>
									<item.icon />
									{item.mode === 'wallet' ? (
										<span className="pointer-events-none absolute left-5 top-1">
											<SidebarDangerMarker />
										</span>
									) : null}
									<span>{item.title}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarFooter>
			</Sidebar>

			<Sidebar
				collapsible="none"
				className="hidden w-[calc(var(--sidebar-width)-var(--sidebar-width-icon)-1px)]! min-w-0 flex-1 md:flex"
				aria-hidden={chatOnLeft}
				inert={chatOnLeft ? true : undefined}
			>
				<SidebarHeader className="gap-3.5 border-b p-4">
					{/* Round F.4: the Inspect/Edit segmented toggle that lived here was
					    removed — it duplicated app state (stance / contextEditorMode)
					    and chronically desynced. The rail's Inspector/Editor surface
					    items carry that role now, with derived active state. */}
					<div className="flex w-full items-center gap-2">
						<div className="min-w-0 flex-1">
							{contentMode === 'drafts' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Saved on this device
								</div>
							) : contentMode === 'private-groups' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Private group records
								</div>
							) : contentMode === 'field-sessions' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Field session records
								</div>
							) : contentMode === 'delivery' ? (
								<div className="flex h-7 items-center font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
									Native delivery ledger
								</div>
							) : (
								<EntitySearchPopover
									sources={{ contexts: mapContextEvents }}
									entityTypes={['context']}
									onSelect={handleContextScopeSelect}
									placeholder={
										activeContextScopeLabel ? activeContextScopeLabel : 'Browse all contexts'
									}
									searchMode="local"
									compact
								/>
							)}
						</div>

						<div className="flex shrink-0 items-center gap-1">
							{contextNaddr && contentMode !== 'drafts' ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={clearContextScope}
									title="Clear context browse scope"
									aria-label="Clear context browse scope"
									className="h-7 w-7"
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							) : null}
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={() => setSidebarExpanded(!sidebarExpanded)}
								title={sidebarExpanded ? 'Shrink sidebar' : 'Expand sidebar'}
								className="h-7 w-7"
							>
								{sidebarExpanded ? (
									<PanelLeftClose className="h-4 w-4" />
								) : (
									<PanelLeftOpen className="h-4 w-4" />
								)}
							</Button>
							<span data-tour="sidebar-login">
								<LoginSessionButtons />
							</span>
						</div>
					</div>
					{contentMode !== 'drafts' && contentMode !== 'delivery' && (
						<WorkspaceDraftNavigator
							onStartNewDataset={handleStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onDeleteWorkspace={onDeleteWorkspace}
							onAddDraftToWorkspace={onAddDraftToWorkspace}
							onLoadDraft={onLoadDraft}
							onDeleteDraft={onDeleteDraft}
							destinationOptions={draftDestinationOptions}
							onResolveDraftDestination={onResolveDraftDestination}
						/>
					)}
				</SidebarHeader>

				<SidebarContent className="p-2 pr-3 [scrollbar-gutter:stable]">
					<SidebarGroup className="h-full p-0">
						<SidebarGroupContent className="h-full">{renderContent()}</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</Sidebar>
	)
}
