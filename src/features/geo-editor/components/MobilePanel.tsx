import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { FeatureCollection } from 'geojson'
import {
	BookOpen,
	ArrowLeft,
	CloudUpload,
	Compass,
	Database,
	Eye,
	FilePenLine,
	Globe,
	HelpCircle,
	Layers,
	LoaderCircle,
	MessageCircle,
	MessageSquare,
	Pencil,
	Plus,
	Radio,
	RadioTower,
	Settings2,
	User,
	UsersRound,
	Wallet,
	X,
} from 'lucide-react'
import { EmbeddedListPanelContext, EntityListTranslucencyContext } from '@/components/entity-list'
import { GeoDatasetsPanelContent } from '@/components/GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from '../../../components/optionalSurfaces.tsx'
import { MobileObjectNavigationContext } from '@/components/info-panel/MobileObjectNavigation'
import type { DatasetEditOptions } from '@/components/info-panel/mapProposalPresentation'
import { parseEarthlyRoute, type EarthlyObjectTab } from '@/router/routeContract'
import { HelpPanel } from '@/components/HelpPanel'
import { MapStackPanel } from '@/components/MapStackPanel'
import { SightingsPanelContent, type SightingsPanelProps } from '@/components/SightingsPanel'
import { BeaconsPanelContent, type BeaconsPanelProps } from '@/components/BeaconsPanel'
import { StoriesPanelContent, type StoriesPanelProps } from '@/components/StoriesPanel'
import { UserProfilePanel } from '../../../components/optionalSurfaces.tsx'
import { ShoutboxPanel } from '../../../components/optionalSurfaces.tsx'
import { PrivateGroupsPanel } from '../../../components/optionalSurfaces.tsx'
import type { GroupCreationSeed } from '@/features/groups/creationSeed'
import { FieldSessionsPanel } from '../../../components/optionalSurfaces.tsx'
import type { FieldDatasetActions } from '@/features/field-sessions/FieldSessionsPanel'
import type { PrivateDatasetActions } from '@/features/private-maps/PrivateGeometryReferences'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { Article } from '@/lib/nostr/article'
import type { Group } from '@/lib/nostr/group'
import type { MapContext } from '@/lib/nostr/map-context'
import type { GeoFeatureItem, StoryViewCapture } from '@/components/editor'
import type { StoryViewDraftContext } from '@/components/editor/StoryViewDraftContext'
import type {
	MapPresentationAuthorization,
	MapPresentationSource,
	MapPresentationV1,
	StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
import { BrowseEntityTabs } from '@/components/entity-search/BrowseEntityTabs'
import type { EditorFeature } from '../core'
import type { BlossomUploadResult } from '@/lib/blossom/blossomUpload'
import {
	getRetainedDatasetSurfaceTarget,
	hasRetainedDatasetSurface,
	resolveMobileEntitySurface,
	useEditorStore,
	type MapStackEntry,
	type MobileEntitySurface,
	type MobilePanelSnap,
} from '../store'
import { mobileTabToView } from '../store/mobileTabRoute'
import {
	mobileObjectNavigationState,
	mobileResumeDestination,
	mobileResumeRouteKey,
	mobileResumeNavigationStatus,
} from './mobileResumeNavigation'
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { LoginSessionButtons } from '@/features/auth/LoginSessionButtons'
import {
	countVisibleLocalDraftWorkspaces,
	LocalDraftsPanel,
	type LocalDraftDestinationOption,
	type WorkspaceDraftNavigatorProps,
} from '@/components/WorkspaceDraftNavigator'
import { MapSettingsPanel } from '../../../components/optionalSurfaces.tsx'
import { ChatPanel } from '@/features/chat/DeferredChatPanel.tsx'
import { useChatActivity } from '@/features/chat/activity.ts'
import { Nip60Wallet } from '../../../components/optionalSurfaces.tsx'
import { navigateToRoute, routeStateFromEarthlyRoute, useRouting } from '../hooks/useRouting'
import type { PlacedSightingGeometry } from '../hooks/useSightingEditor'
import { DEFAULT_WORK_VIEW } from '../defaults'
import { PublishOutboxPanel } from '@/features/delivery'
import { buildInboxTargetHref, InboxPanel, useInboxFeed } from '@/features/inbox'
import { NEW_STORY_DRAFT_KEY, readStoryDraft } from '@/lib/nostr/story'
import { subscribeStoryEditorOpenRequests } from '../storyEditorBridge'
import { MobilePanelHeaderActionProvider } from './MobilePanelHeaderAction'
import { resolveMobileViewportLayout } from './mobileViewport'
import {
	mobileWorkspacePanelUsesKeyboardViewport,
	resolveMobileDatasetSurfaceTitle,
	resolveMobileEditPanelPresentation,
	resolveMobileStorySurfaceTitle,
	type MobileWorkspaceOpenOptions,
} from './mobileEditPanelPresentation'
import {
	mobileSheetCloseLabel,
	mobileSheetChromeClassName,
	mobileSheetInnerSurfaceClassName,
	mobileSheetSurfaceClassName,
	mobileWorkspaceHeaderActionRowClassName,
	mobileSheetDetentHeight,
} from './mobileSheetPresentation'

export type MobilePanelTab =
	| 'drafts'
	| 'datasets'
	| 'map-stack'
	| 'contexts'
	| 'field-sessions'
	| 'private-groups'
	| 'context-editor'
	| 'edit'
	| 'sightings'
	| 'beacons'
	| 'stories'
	| 'chat'
	| 'profile'
	| 'posts'
	| 'delivery'
	| 'wallet'
	| 'settings'
	| 'help'

export interface MobilePanelProps {
	/** Existing publish/audience control, composed into the map-edit peek. */
	mapEditPublishAction?: ReactNode
	onPublishNew?: () => void | Promise<void>
	canPublishNew?: boolean
	mapStories?: Article[]
	mapGroups?: Group[]
	onOpenDiscover: () => void
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	activeDataset: GeoDataset | null
	currentUserPubkey?: string
	userPubkey?: string | null
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	isFocused: boolean
	multiSelectModifier?: string
	onLoadDataset: (
		event: GeoDataset,
		options?: DatasetEditOptions,
	) => boolean | undefined | Promise<boolean | undefined>
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
	onAddDatasetToMap?: (event: GeoDataset) => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onSetMapStackEntryVisible: (entry: MapStackEntry, visible: boolean) => void
	onSetMapStackEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
	onRemoveMapStackEntry: (entry: MapStackEntry) => void
	onOpenDraftEditor?: (workspaceId?: string) => Promise<boolean>
	onZoomToDraft?: () => void
	onClearMapStack: () => void
	onDeleteDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onOpenGeometryEditor?: (
		workspaceId?: string,
		options?: MobileWorkspaceOpenOptions,
	) => Promise<boolean>
	onInspectDataset?: (event: GeoDataset) => void
	onExitFocus?: () => void
	onInspectContext?: (context: MapContext) => void
	onCreateContext?: () => void
	onEditContext?: (context: MapContext) => void
	onOpenDebug?: (event: GeoDataset | MapContext) => void
	onExitViewMode?: () => void
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
	/** Story view/edit props (Phase 10, D-03) — a Story create/edit/view renders in the edit tab. */
	storyEditorMode?: 'none' | 'create' | 'edit'
	editingStory?: import('@/lib/nostr/article').Article | null
	onSaveStory?: (story: import('@/lib/nostr/article').Article) => void
	onCloseStoryEditor?: () => void
	onEditStory?: (story: import('@/lib/nostr/article').Article) => void
	onStoryUpdated?: (story: import('@/lib/nostr/article').Article) => void
	onDeleteStory?: (story: import('@/lib/nostr/article').Article) => void
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
	/** Beacon control/view props (Phase 12, D-12) — a beacon create/adjust/view renders in the edit tab. */
	beaconControlMode?: 'none' | 'create' | 'adjust'
	adjustingBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
	viewBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
	isFollowingBeacon?: boolean
	onToggleFollowBeacon?: () => void
	beaconIsStarting?: boolean
	beaconFocusCommentId?: string
	onStartBeacon?: (
		options: import('@/components/info-panel/BeaconControlPanel').BeaconStartOptions,
	) => void
	onCloseBeaconControl?: () => void
	onStopBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	onAdjustBeacon?: (beacon?: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	onWatchOnMapBeacon?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	onAddBeaconToMapStack?: (beacon: import('@/lib/nostr/live-beacon').LiveBeacon) => void
	/** Sighting view/edit props (Phase 11, D-01/D-07). */
	sightingEditorMode?: 'none' | 'create' | 'edit'
	editingSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	viewSighting?: import('@/lib/nostr/temporal-sighting').TemporalSighting | null
	placedSightingGeometry?: PlacedSightingGeometry | null
	onZoomToSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onDrawSightingArea?: () => void
	onSaveSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onCloseSightingEditor?: () => void
	onEditSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onDeleteSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onAddSightingToMapStack?: (
		sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting,
	) => void
	onZoomToFeature?: (feature: EditorFeature) => void
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
	onToggleProposalOverlay?: (
		proposal: import('@/lib/nostr/geo-proposal').GeoProposal,
		visible: boolean,
	) => void
	onProposalAccepted?: (dataset: GeoDataset) => void
	visibleProposalIds?: Set<string>
	focusCommentId?: string
	/** WR-06: comment d-tag to focus beneath the viewed Sighting (survives navigateToView). */
	sightingFocusCommentId?: string
	/** Browse-rail prop bundles — the self-subscribing entity lists (§14a dock
	 *  targets: Map→sightings, Activity→beacons; Stories reachable via the switcher). */
	sightingsPanelProps?: SightingsPanelProps
	beaconsPanelProps?: BeaconsPanelProps
	storiesPanelProps?: StoriesPanelProps
}

const TAB_CONFIG: { id: MobilePanelTab; label: string; icon: typeof Database }[] = [
	{ id: 'drafts', label: 'Local drafts', icon: FilePenLine },
	{ id: 'sightings', label: 'Sightings', icon: Eye },
	{ id: 'beacons', label: 'Live positions', icon: Radio },
	{ id: 'stories', label: 'Stories', icon: BookOpen },
	{ id: 'datasets', label: 'Maps', icon: Database },
	{ id: 'map-stack', label: 'On the map', icon: Layers },
	{ id: 'contexts', label: 'Atlases', icon: Globe },
	{ id: 'field-sessions', label: 'Nearby', icon: RadioTower },
	{ id: 'private-groups', label: 'Circles', icon: UsersRound },
	{ id: 'context-editor', label: 'Atlas editor', icon: FilePenLine },
	{ id: 'edit', label: 'Edit', icon: Pencil },
	{ id: 'chat', label: 'Thread', icon: MessageCircle },
	{ id: 'profile', label: 'Me', icon: User },
	{ id: 'posts', label: 'Posts', icon: MessageSquare },
	{ id: 'delivery', label: 'Inbox & delivery', icon: CloudUpload },
	{ id: 'wallet', label: 'Wallet', icon: Wallet },
	{ id: 'settings', label: 'Settings', icon: Settings2 },
	{ id: 'help', label: 'Help', icon: HelpCircle },
]

// biome-ignore lint/style/noNonNullAssertion: TAB_CONFIG is non-empty, so [0] is a safe fallback.
const tabMeta = (id: MobilePanelTab) => TAB_CONFIG.find((tab) => tab.id === id) ?? TAB_CONFIG[0]!

/**
 * §14a "One sheet, every panel": the sheet header is a grouped panel switcher
 * (same grouping as the desktop rail). Tapping the header pill opens this list;
 * picking a panel swaps the sheet's body. Transient editors (context-editor)
 * are reached via a "+ new" action, not the switcher.
 */
const SIDEBAR_GROUPS: { label: string; tabs: MobilePanelTab[] }[] = [
	{ label: 'Your work', tabs: ['drafts'] },
	{
		label: 'Explore',
		tabs: [
			'datasets',
			'map-stack',
			'contexts',
			'field-sessions',
			'private-groups',
			'stories',
			'sightings',
			'beacons',
		],
	},
	{ label: 'Communication', tabs: ['chat', 'posts'] },
	{ label: 'Device', tabs: ['delivery'] },
	{ label: 'Account', tabs: ['profile', 'wallet', 'settings', 'help'] },
]

/**
 * Three detents: a 96px browse/inspect peek (62px for the Map edit summary),
 * half for properties, and full for browsing. Pixel heights keep drag math and
 * the map's exposed viewport in agreement.
 */
export const MOBILE_DOCK_PX = 52
export const MOBILE_SHEET_PEEK_PX = 96

function configuredMobileDockHeightPx(): number {
	if (typeof window === 'undefined') return MOBILE_DOCK_PX
	const configured = Number.parseFloat(
		window.getComputedStyle(document.documentElement).getPropertyValue('--mobile-dock-height'),
	)
	return Number.isFinite(configured) && configured >= 0 ? configured : MOBILE_DOCK_PX
}
const SNAP_ORDER: MobilePanelSnap[] = ['peek', 'half', 'full']
/** Viewport fractions resolve to pixels in mobileSheetDetentHeight. */
const viewportHeightPx = () => (typeof window !== 'undefined' ? window.innerHeight : 812)
export const mobilePanelHeightPx = (
	snap: MobilePanelSnap,
	viewportHeight = viewportHeightPx(),
	editingMap = false,
): number =>
	mobileSheetDetentHeight(snap, viewportHeight, editingMap, configuredMobileDockHeightPx())

export function MobilePanel(props: MobilePanelProps) {
	const {
		onOpenDiscover,
		geoEvents,
		mapContextEvents,
		activeDataset,
		currentUserPubkey,
		userPubkey,
		datasetVisibility,
		isPublishing,
		deletingKey,
		isFocused,
		multiSelectModifier = 'Shift',
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
		onSetMapStackEntryVisible,
		onSetMapStackEntryIsolated,
		onRemoveMapStackEntry,
		onOpenDraftEditor,
		onZoomToDraft,
		onClearMapStack,
		onDeleteDataset,
		onDeleteContext,
		getDatasetKey,
		getDatasetName,
		onOpenGeometryEditor,
		onInspectDataset,
		onExitFocus,
		onInspectContext,
		onCreateContext,
		onEditContext,
		onOpenDebug,
		onExitViewMode,
		onCommentGeometryVisibility,
		onZoomToBounds,
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		isMentionVisible,
		contextEditorMode,
		editingContext,
		contextCreationSeed,
		onSaveContext,
		onCloseContextEditor,
		storyEditorMode,
		editingStory,
		onSaveStory,
		onCloseStoryEditor,
		onEditStory,
		onStoryUpdated,
		onDeleteStory,
		captureMapPresentation,
		captureStoryView,
		onStoryViewActivate,
		onStoryViewPreviewReset,
		onStoryEditorActiveChange,
		renderStoryViewFigure,
		activeStoryViewId,
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
		isFollowingBeacon,
		onToggleFollowBeacon,
		beaconIsStarting,
		beaconFocusCommentId,
		onStartBeacon,
		onCloseBeaconControl,
		onStopBeacon,
		onAdjustBeacon,
		onWatchOnMapBeacon,
		onAddBeaconToMapStack,
		sightingEditorMode,
		editingSighting,
		viewSighting,
		placedSightingGeometry,
		onZoomToSighting,
		onDrawSightingArea,
		onSaveSighting,
		onCloseSightingEditor,
		onEditSighting,
		onDeleteSighting,
		onAddSightingToMapStack,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		onFilteredDatasetKeysChange,
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
		focusCommentId,
		sightingFocusCommentId,
		sightingsPanelProps,
		beaconsPanelProps,
		storiesPanelProps,
	} = props
	const {
		publicRoute,
		navigateHome,
		navigateToUser,
		route,
		contextNaddr,
		encodeContextNaddr,
		encodeGeoEventNaddr,
		navigateToContext,
		clearContextScope,
		navigateToView,
		navigateToTab,
	} = useRouting()
	const inbox = useInboxFeed({
		currentUserPubkey,
		geoEvents,
		mapContextEvents,
		getDatasetName,
	})
	const handleOpenInboxItem = useCallback((item: (typeof inbox.items)[number]) => {
		const href = buildInboxTargetHref(item.target)
		if (href) navigateToRoute(href)
	}, [])
	const routedAskOpen = route.sidebarView === 'chat'
	const routedObjectThreadOpen = route.tab === 'thread' && route.focusType !== 'none'

	const activeContextScope = mapContextEvents.find((context) => {
		if (!contextNaddr) return false
		return encodeContextNaddr(context) === contextNaddr
	})
	const activeContextScopeLabel =
		activeContextScope?.context.name || activeContextScope?.contextId || activeContextScope?.id

	const handleContextScopeSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const context = result.entity as MapContext
		const naddr = encodeContextNaddr(context)
		if (!naddr) return
		navigateToContext(naddr)
	}

	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const mobileSidebarOpen = useEditorStore((state) => state.mobileSidebarOpen)
	const mobileSidebarMode = useEditorStore((state) => state.mobileSidebarMode)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelTab = useEditorStore((state) => state.setMobilePanelTab)
	const setMobilePanelSnap = useEditorStore((state) => state.setMobilePanelSnap)
	const openMobilePanel = useEditorStore((state) => state.openMobilePanel)
	const showMobileSidebarMenu = useEditorStore((state) => state.showMobileSidebarMenu)
	const selectMobileSidebarDestination = useEditorStore(
		(state) => state.selectMobileSidebarDestination,
	)
	const closeMobileSidebar = useEditorStore((state) => state.closeMobileSidebar)
	const editorStance = useEditorStore((state) => state.stance)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewContext = useEditorStore((state) => state.viewContext)
	const viewStory = useEditorStore((state) => state.viewStory)
	const inspectionSubject = useEditorStore((state) => state.inspectionSubject)
	const mobileEntitySurface = useEditorStore((state) => state.mobileEntitySurface)
	const featureCount = useEditorStore((state) => state.features.length)
	const selectionCount = useEditorStore((state) => state.selectedFeatureIds.length)
	const activateMobileEntitySurface = useEditorStore((state) => state.activateMobileEntitySurface)
	const datasetEditorRetained = useEditorStore(hasRetainedDatasetSurface)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const retainedDatasetSurfaceTitle = useEditorStore((state) =>
		resolveMobileDatasetSurfaceTitle(getRetainedDatasetSurfaceTarget(state)),
	)
	const routedDraftThreadOpen =
		route.tab === 'thread' &&
		route.focusType === 'none' &&
		route.sidebarView === 'edit' &&
		datasetEditorRetained
	const routedThreadOpen = routedObjectThreadOpen || routedDraftThreadOpen
	const { runningChatId, activeRun: activeChatRun } = useChatActivity()
	const localDraftCount = useEditorStore((state) =>
		countVisibleLocalDraftWorkspaces(
			state.workspaces,
			state.geoEditDrafts,
			state.activeWorkspaceId,
		),
	)
	const [headerActionTarget, setHeaderActionTarget] = useState<HTMLDivElement | null>(null)
	const [pendingResume, setPendingResume] = useState<{
		surface: Exclude<MobileEntitySurface, 'inspector'>
		href: string
		snap: MobilePanelSnap
		fromRouteKey: string
	} | null>(null)
	const [panelTranslucent, setPanelTranslucent] = useState(true)
	const [retainedStoryDraftTitle, setRetainedStoryDraftTitle] = useState<string | null>(null)
	const viewportBaselineRef = useRef(viewportHeightPx())
	const [keyboardViewport, setKeyboardViewport] = useState(() => ({
		keyboardOpen: false,
		fixedBottomInsetPx: 0,
		dockClearancePx: 0,
		usableHeightPx: viewportHeightPx(),
		layoutHeightPx: viewportHeightPx(),
	}))

	const handleClose = () => {
		setMobilePanelOpen(false)
		navigateHome()
	}
	const browseKind =
		publicRoute.kind === 'browse' && editorStance === 'browse'
			? (publicRoute.browseKind ?? 'maps')
			: null
	const sidebarIsMenu = mobileSidebarMode === 'menu'
	const closeNavigationSurface = useCallback(() => {
		if (!sidebarIsMenu) navigateToView(editorStance === 'author' ? 'edit' : DEFAULT_WORK_VIEW)
		closeMobileSidebar()
	}, [closeMobileSidebar, editorStance, navigateToView, sidebarIsMenu])
	const leaveSidebar = () => {
		if (mobileSidebarOpen) closeMobileSidebar()
	}
	const handleMobileInspectDataset = (event: GeoDataset) => {
		leaveSidebar()
		onInspectDataset?.(event)
	}
	const handleMobileInspectContext = (context: MapContext) => {
		leaveSidebar()
		onInspectContext?.(context)
	}
	const handleMobileZoomToDataset = (event: GeoDataset) => {
		leaveSidebar()
		onZoomToDataset(event)
	}
	const handleMobileZoomToBounds = (bounds: [number, number, number, number]) => {
		leaveSidebar()
		onZoomToBounds?.(bounds)
	}
	const ensureRouteThreadMapTarget = useCallback(async (): Promise<string | null> => {
		if (routedDraftThreadOpen) {
			const state = useEditorStore.getState()
			const workspaceId = state.activeWorkspaceId
			if (!workspaceId || !getRetainedDatasetSurfaceTarget(state, workspaceId)) return null
			return workspaceId
		}
		if (!routedObjectThreadOpen || route.focusType !== 'geoevent' || !viewDataset) return null
		const loaded = await onLoadDataset(viewDataset)
		if (loaded === false) return null
		const state = useEditorStore.getState()
		const workspaceId = state.activeWorkspaceId
		if (!workspaceId) return null
		const workspace = state.workspaces[workspaceId]
		if (!workspace?.activeDraftId || !state.geoEditDrafts[workspace.activeDraftId]) return null
		return workspaceId
	}, [onLoadDataset, route.focusType, routedDraftThreadOpen, routedObjectThreadOpen, viewDataset])

	useEffect(() => {
		if (!mobileSidebarOpen && !mobilePanelOpen) return
		const handleKeyDown = (event: KeyboardEvent) => {
			// The topmost popover/dialog owns Escape before its parent sheet.
			if (event.key !== 'Escape' || event.defaultPrevented) return
			if (mobileSidebarOpen) {
				if (!sidebarIsMenu) showMobileSidebarMenu()
				else closeNavigationSurface()
				return
			}
			setMobilePanelOpen(false)
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [
		closeNavigationSurface,
		mobilePanelOpen,
		mobileSidebarOpen,
		setMobilePanelOpen,
		showMobileSidebarMenu,
		sidebarIsMenu,
	])

	useEffect(() => {
		if (
			!mobilePanelOpen ||
			!mobileWorkspacePanelUsesKeyboardViewport(mobilePanelTab) ||
			typeof window === 'undefined'
		) {
			setKeyboardViewport((current) =>
				current.keyboardOpen || current.fixedBottomInsetPx !== 0
					? {
							keyboardOpen: false,
							fixedBottomInsetPx: 0,
							dockClearancePx: 0,
							usableHeightPx: viewportHeightPx(),
							layoutHeightPx: viewportHeightPx(),
						}
					: current,
			)
			return
		}

		const visualViewport = window.visualViewport
		const syncViewport = () => {
			const layoutHeight = window.innerHeight
			const visualHeight = visualViewport?.height ?? layoutHeight
			const visualOffsetTop = visualViewport?.offsetTop ?? 0
			const activeElement = document.activeElement
			const editableFocused =
				activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				(activeElement instanceof HTMLElement && activeElement.isContentEditable)
			const layout = resolveMobileViewportLayout({
				layoutHeight,
				visualHeight,
				visualOffsetTop,
				baselineHeight: viewportBaselineRef.current,
				editableFocused,
				persistentDockHeightPx: configuredMobileDockHeightPx(),
			})

			// When no keyboard-capable element owns focus, a height change is an
			// orientation/browser-chrome change and becomes the new stable baseline.
			if (!editableFocused && !layout.keyboardOpen) {
				viewportBaselineRef.current = visualHeight
			}

			setKeyboardViewport((current) => {
				if (
					current.keyboardOpen === layout.keyboardOpen &&
					current.fixedBottomInsetPx === layout.fixedBottomInsetPx &&
					current.dockClearancePx === layout.dockClearancePx &&
					current.usableHeightPx === layout.usableHeightPx &&
					current.layoutHeightPx === layoutHeight
				) {
					return current
				}
				return { ...layout, layoutHeightPx: layoutHeight }
			})
		}

		syncViewport()
		visualViewport?.addEventListener('resize', syncViewport)
		visualViewport?.addEventListener('scroll', syncViewport)
		window.addEventListener('resize', syncViewport)
		document.addEventListener('focusin', syncViewport)
		document.addEventListener('focusout', syncViewport)
		return () => {
			visualViewport?.removeEventListener('resize', syncViewport)
			visualViewport?.removeEventListener('scroll', syncViewport)
			window.removeEventListener('resize', syncViewport)
			document.removeEventListener('focusin', syncViewport)
			document.removeEventListener('focusout', syncViewport)
		}
	}, [mobilePanelOpen, mobilePanelTab])

	const refreshRetainedStoryDraftTitle = useCallback(() => {
		if (storyEditorMode === 'none' || editingStory) {
			setRetainedStoryDraftTitle(null)
			return
		}
		const title = readStoryDraft(NEW_STORY_DRAFT_KEY, currentUserPubkey)?.title ?? null
		setRetainedStoryDraftTitle(title?.trim() || null)
	}, [currentUserPubkey, editingStory, storyEditorMode])
	useEffect(() => {
		refreshRetainedStoryDraftTitle()
		// AI establishes the retained create target before writing its title. Its
		// final write notification must refresh the label without reopening work.
		return subscribeStoryEditorOpenRequests(refreshRetainedStoryDraftTitle)
	}, [refreshRetainedStoryDraftTitle])

	// The sheet height is driven from the store detent, but the grab handle can be
	// DRAGGED to resize live and snaps to the nearest detent on release (a plain
	// pointer handler — vaul's snap-point drag proved unreliable for an always-open
	// non-modal sheet). `dragPx` overrides the resting height while dragging.
	const [dragPx, setDragPx] = useState<number | null>(null)
	const sheetRef = useRef<HTMLDivElement>(null)
	const [sheetBottomInsetPx, setSheetBottomInsetPx] = useState(configuredMobileDockHeightPx)
	const dragRef = useRef<{ startY: number; startPx: number } | null>(null)
	const dragCleanupRef = useRef<(() => void) | null>(null)
	useEffect(() => () => dragCleanupRef.current?.(), [])

	const sheetDetentHeight = (snap: MobilePanelSnap, viewportHeight = viewportHeightPx()) =>
		mobileSheetDetentHeight(snap, viewportHeight, mapEditing, sheetBottomInsetPx)
	const clampPx = (px: number) => Math.min(sheetDetentHeight('full'), Math.max(0, px))
	const nearestSnap = (px: number): MobilePanelSnap =>
		SNAP_ORDER.reduce((best, snap) =>
			Math.abs(sheetDetentHeight(snap) - px) < Math.abs(sheetDetentHeight(best) - px) ? snap : best,
		)
	const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const currentIndex = SNAP_ORDER.indexOf(mobilePanelSnap)
		let nextSnap: MobilePanelSnap | null = null
		if (event.key === 'ArrowUp')
			nextSnap = SNAP_ORDER[Math.min(currentIndex + 1, SNAP_ORDER.length - 1)] ?? null
		if (event.key === 'ArrowDown') nextSnap = SNAP_ORDER[Math.max(currentIndex - 1, 0)] ?? null
		if (event.key === 'Home') nextSnap = 'peek'
		if (event.key === 'End') nextSnap = 'full'
		if (!nextSnap) return
		event.preventDefault()
		dragCleanupRef.current?.()
		setDragPx(null)
		setMobilePanelSnap(nextSnap)
	}

	const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (typeof window === 'undefined' || !event.isPrimary || event.button !== 0) return
		event.preventDefault()
		dragCleanupRef.current?.()
		const pointerId = event.pointerId
		// NOTE: no setPointerCapture — the handle already has `touch-action: none`
		// so the whole gesture is owned (content can't scroll-steal it), and capture
		// left stale state that broke the SECOND drag of a sequence (up then down).
		dragRef.current = {
			startY: event.clientY,
			startPx:
				sheetRef.current?.getBoundingClientRect().height ?? sheetDetentHeight(mobilePanelSnap),
		}
		setDragPx(dragRef.current.startPx)

		const move = (moveEvent: PointerEvent) => {
			if (!dragRef.current || moveEvent.pointerId !== pointerId) return
			const deltaPx = dragRef.current.startY - moveEvent.clientY
			setDragPx(clampPx(dragRef.current.startPx + deltaPx))
		}
		const up = (upEvent: PointerEvent) => {
			if (upEvent.pointerId !== pointerId) return
			const start = dragRef.current
			if (start) {
				const deltaPx = start.startY - upEvent.clientY
				const nextHeight = start.startPx + deltaPx
				if (nextHeight < sheetDetentHeight('peek') / 2) handleClose()
				else if (Math.abs(deltaPx) < 4)
					setMobilePanelSnap(
						SNAP_ORDER[(SNAP_ORDER.indexOf(mobilePanelSnap) + 1) % SNAP_ORDER.length] ?? 'half',
					)
				else setMobilePanelSnap(nearestSnap(clampPx(nextHeight)))
			}
			cleanup()
			setDragPx(null)
		}
		const cancel = (cancelEvent: PointerEvent) => {
			if (cancelEvent.pointerId !== pointerId) return
			cleanup()
			setDragPx(null)
		}
		const cleanup = () => {
			dragRef.current = null
			dragCleanupRef.current = null
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			window.removeEventListener('pointercancel', cancel)
		}
		dragCleanupRef.current = cleanup
		window.addEventListener('pointermove', move, { passive: true })
		window.addEventListener('pointerup', up)
		window.addEventListener('pointercancel', cancel)
	}

	const panelCount = (id: MobilePanelTab): number | undefined =>
		id === 'drafts'
			? localDraftCount
			: id === 'datasets'
				? geoEvents.length
				: id === 'contexts'
					? mapContextEvents.length
					: undefined
	const selectPanel = async (id: MobilePanelTab): Promise<boolean> => {
		if (id === 'map-stack' || id === 'edit' || id === 'chat') {
			// Shelf and Thread are route-owned even though their controls live in
			// the map-bound sheet. Reload, Back, and desktop/phone composition must
			// therefore observe the same state.
			if (id === 'map-stack') navigateToView('map-stack')
			if (id === 'chat') {
				if (route.focusType !== 'none') navigateToTab('thread')
				else if (datasetEditorRetained && activeWorkspaceId) navigateToRoute('/edit?tab=thread')
				else navigateToView('chat')
			}
			// The route owns both the object and its Thread. Switching back to
			// Details/Edit must also work before the first send has bound a target.
			if (id === 'edit') {
				if (route.focusType !== 'none') navigateToTab('details')
				else if (datasetEditorRetained) navigateToRoute('/edit')
			}
			// Switching adjacent workspace tabs must not move the rail under the
			// user's finger or keyboard focus. Only a first launch chooses the
			// destination's default detent (Chat full; Stack/Edit half).
			if (!mobilePanelOpen) openMobilePanel(id)
		} else if (id === 'context-editor') {
			openMobilePanel(id)
		} else {
			// Switcher selection is a real navigation: write the URL through the
			// canonical router so history/reload/share agree with the sheet
			// (audit P1 #6). The tab is also set directly — in-app pushState
			// deliberately skips route→tab derivation.
			if (id === 'delivery') navigateToRoute('/delivery')
			else navigateToView(mobileTabToView(id))
			selectMobileSidebarDestination(id, {
				preserveSuspendedPanel: editorStance === 'author',
			})
		}
		setMobilePanelTab(id)
		return true
	}
	const activeMeta =
		mobilePanelTab === 'delivery'
			? {
					...tabMeta(mobilePanelTab),
					label: publicRoute.kind === 'inbox' ? 'Inbox' : 'Sync & delivery',
				}
			: tabMeta(mobilePanelTab)
	const entitySurfaceAvailability: Record<MobileEntitySurface, boolean> = {
		inspector: inspectionSubject != null,
		dataset: datasetEditorRetained,
		story: storyEditorMode != null && storyEditorMode !== 'none',
		context: contextEditorMode != null && contextEditorMode !== 'none',
		// Transient authoring/control remains reachable while its real lifecycle is
		// active, even after another surface is selected. Read-only entities live in
		// the retained Inspector instead.
		sighting: sightingEditorMode != null && sightingEditorMode !== 'none',
		beacon: beaconControlMode != null && beaconControlMode !== 'none',
	}
	// A routed object Thread always belongs to its read-only Inspector, even
	// when an unrelated retained editor was selected before the route opened.
	const resolvedEntitySurface =
		mobilePanelTab === 'chat' && routedObjectThreadOpen && inspectionSubject
			? 'inspector'
			: resolveMobileEntitySurface(mobileEntitySurface, entitySurfaceAvailability)
	const editPresentation = resolveMobileEditPanelPresentation({
		surface: resolvedEntitySurface,
		inspectionKind: inspectionSubject?.kind,
		hasRetainedDataset: datasetEditorRetained,
		contextEditorMode,
		storyEditorMode,
		sightingEditorMode,
		beaconControlMode,
		hasViewedDataset: viewDataset != null,
		hasViewedContext: viewContext != null,
		hasViewedStory: viewStory != null,
		hasViewedSighting: viewSighting != null,
		hasViewedBeacon: viewBeacon != null,
	})
	const activeLabel = browseKind
		? 'Browse'
		: mobilePanelTab === 'edit'
			? editPresentation.label
			: activeMeta.label
	const mapEditing =
		editorStance === 'author' && mobilePanelTab === 'edit' && resolvedEntitySurface === 'dataset'
	const selectionInsetPx = mapEditing && selectionCount > 0 ? 44 : 0
	// Resolve the CSS bottom inset so drag, snap, and ARIA calculations include
	// both the selection-action row and the device's safe area, just like layout.
	useLayoutEffect(() => {
		if (!mobilePanelOpen || mobileSidebarOpen || keyboardViewport.keyboardOpen) return
		const syncBottomInset = () => {
			if (!sheetRef.current) return
			const inset = Number.parseFloat(window.getComputedStyle(sheetRef.current).bottom)
			setSheetBottomInsetPx(
				Number.isFinite(inset) ? inset : configuredMobileDockHeightPx() + selectionInsetPx,
			)
		}
		syncBottomInset()
		window.addEventListener('resize', syncBottomInset)
		return () => window.removeEventListener('resize', syncBottomInset)
	}, [mobilePanelOpen, mobileSidebarOpen, keyboardViewport.keyboardOpen, selectionInsetPx])
	const mapEditPeek = mapEditing && mobilePanelSnap === 'peek' && !keyboardViewport.keyboardOpen
	const ActiveIcon =
		mobilePanelTab === 'edit' && editPresentation.intent === 'inspect' ? Eye : activeMeta.icon
	const activeCount = panelCount(mobilePanelTab)
	const mapWorkSurfaceVisible =
		mobilePanelOpen &&
		(mobilePanelTab === 'map-stack' || mobilePanelTab === 'edit' || mobilePanelTab === 'chat')
	const chatWorking = runningChatId !== null
	const workingEntitySurface: MobileEntitySurface | null =
		activeChatRun?.target.entityType === 'dataset' &&
		activeChatRun.target.workspaceId === activeWorkspaceId
			? 'dataset'
			: null
	const selectedEntitySurfaceWorking = workingEntitySurface === resolvedEntitySurface
	const surfaceLabel = (surface: MobileEntitySurface): string => {
		if (surface === 'dataset') {
			return `Map · ${retainedDatasetSurfaceTitle}${workingEntitySurface === surface ? ' · AI working' : ''}`
		}
		if (surface === 'story') {
			return `Story · ${resolveMobileStorySurfaceTitle(
				editingStory?.article.title,
				retainedStoryDraftTitle,
			)}`
		}
		if (surface === 'context') {
			return `Atlas · ${editingContext?.context.name?.trim() || 'Untitled atlas'}`
		}
		if (surface === 'sighting') {
			return `Sighting · ${editingSighting?.sighting.title?.trim() || viewSighting?.sighting.title?.trim() || 'Untitled sighting'}`
		}
		if (surface === 'beacon') {
			return `Live · ${adjustingBeacon?.beacon.label?.trim() || viewBeacon?.beacon.label?.trim() || 'Location'}`
		}
		if (!inspectionSubject) return 'Inspect'
		if (inspectionSubject.kind === 'dataset') {
			return `Inspect · ${getDatasetName(inspectionSubject.entity)}`
		}
		if (inspectionSubject.kind === 'context') {
			return `Inspect · ${inspectionSubject.entity.context.name || 'Atlas'}`
		}
		if (inspectionSubject.kind === 'story') {
			return `Inspect · ${inspectionSubject.entity.article.title || 'Story'}`
		}
		if (inspectionSubject.kind === 'sighting') {
			return `Inspect · ${inspectionSubject.entity.sighting.title || 'Sighting'}`
		}
		return `Inspect · ${inspectionSubject.entity.beacon.label || 'Live location'}`
	}
	const surfaceOptionOrder: MobileEntitySurface[] = [
		...(resolvedEntitySurface ? [resolvedEntitySurface] : []),
		'sighting',
		'beacon',
		'dataset',
		'story',
		'context',
		'inspector',
	]
	const entitySurfaceOptions = surfaceOptionOrder
		.filter(
			(surface, index) =>
				entitySurfaceAvailability[surface] && surfaceOptionOrder.indexOf(surface) === index,
		)
		.map((surface) => ({ surface, label: surfaceLabel(surface) }))
	const selectedEntityWorkspace =
		resolvedEntitySurface === 'dataset'
			? 'geometry'
			: resolvedEntitySurface === 'inspector'
				? inspectionSubject?.kind === 'dataset'
					? 'geometry'
					: inspectionSubject?.kind
				: resolvedEntitySurface
	const objectThreadKind =
		route.focusType === 'geoevent'
			? 'map'
			: route.focusType === 'mapcontext'
				? 'atlas'
				: route.focusType === 'beacon'
					? 'live'
					: route.focusType
	const routeThreadKey = routedAskOpen
		? 'ask'
		: routedDraftThreadOpen && activeWorkspaceId
			? `map-draft:${activeWorkspaceId}`
			: routedThreadOpen && route.naddr
				? `${objectThreadKind}:${route.naddr}`
				: undefined
	const routeThreadTitle = routedAskOpen
		? 'Ask Earthly'
		: routedDraftThreadOpen
			? retainedDatasetSurfaceTitle
			: route.focusType === 'geoevent'
				? viewDataset
					? getDatasetName(viewDataset)
					: 'Map'
				: route.focusType === 'story'
					? viewStory?.article.title || 'Story'
					: route.focusType === 'mapcontext'
						? viewContext?.context.name || 'Atlas'
						: route.focusType === 'sighting'
							? viewSighting?.sighting.title || 'Sighting'
							: route.focusType === 'beacon'
								? viewBeacon?.beacon.label || 'Live location'
								: 'Thread'
	const askInitialPrompt =
		routedAskOpen && typeof window !== 'undefined'
			? (new URLSearchParams(window.location.search).get('q') ?? undefined)
			: undefined
	const resolvedSheetHeight = keyboardViewport.keyboardOpen
		? Math.max(MOBILE_SHEET_PEEK_PX, keyboardViewport.usableHeightPx)
		: (dragPx ?? sheetDetentHeight(mobilePanelSnap, keyboardViewport.layoutHeightPx))
	const keyboardDockIsVisible =
		keyboardViewport.keyboardOpen && keyboardViewport.dockClearancePx > 0
	const keyboardSheetHeight = keyboardDockIsVisible
		? `max(0px, calc(${resolvedSheetHeight}px - env(safe-area-inset-bottom)))`
		: `${resolvedSheetHeight}px`
	const keyboardSheetBottom = keyboardDockIsVisible
		? `calc(${keyboardViewport.fixedBottomInsetPx + keyboardViewport.dockClearancePx}px + env(safe-area-inset-bottom))`
		: `${keyboardViewport.fixedBottomInsetPx}px`
	const sheetCloseLabel = mobileSheetCloseLabel(mapWorkSurfaceVisible, activeLabel)
	const objectInspectorVisible =
		(mobilePanelTab === 'edit' && editPresentation.intent === 'inspect') ||
		(mobilePanelTab === 'chat' && routedObjectThreadOpen)
	const integratedObjectHeader =
		objectInspectorVisible && ['dataset', 'story', 'context'].includes(inspectionSubject?.kind ?? '')
	const objectNavigation = mobileObjectNavigationState(
		objectInspectorVisible,
		mobilePanelTab,
		route.tab,
	)
	const handleObjectTabChange = (tab: EarthlyObjectTab) => {
		if (route.focusType === 'none') {
			if (tab === 'thread') void selectPanel('chat')
			return
		}
		navigateToTab(tab)
		activateMobileEntitySurface('inspector', entitySurfaceAvailability)
		setMobilePanelTab(tab === 'thread' ? 'chat' : 'edit')
		if (mobilePanelSnap === 'peek') setMobilePanelSnap('half')
	}

	// The "+ new" action in the sheet header, per active browse tab.
	const newAction: { label: string; onClick: () => void } | null =
		mobilePanelTab === 'drafts' && onStartNewDataset
			? { label: 'New draft', onClick: onStartNewDataset }
			: mobilePanelTab === 'datasets' && onStartNewDataset
				? { label: 'New map', onClick: onStartNewDataset }
				: mobilePanelTab === 'contexts' && onCreateContext
					? { label: 'New atlas', onClick: onCreateContext }
					: mobilePanelTab === 'sightings' && sightingsPanelProps
						? { label: 'New sighting', onClick: sightingsPanelProps.onCreateSighting }
						: mobilePanelTab === 'beacons' && beaconsPanelProps
							? { label: 'Share live location', onClick: beaconsPanelProps.onShareLocation }
							: mobilePanelTab === 'stories' && storiesPanelProps
								? { label: 'New story', onClick: storiesPanelProps.onCreateStory }
								: null

	// Every entity editor/Inspector lives in the Edit sheet. The selected surface
	// chooses both its title and its body so retained tasks never compete through
	// independent priority lists.
	const editorPanel = (
		<MobilePanelHeaderActionProvider target={headerActionTarget}>
			<GeoEditorInfoPanelContent
				objectTab={route.focusType !== 'none' ? route.tab : undefined}
				onObjectTabChange={handleObjectTabChange}
				onOpenMapThread={() => void selectPanel('chat')}
				mapStories={props.mapStories}
				mapGroups={props.mapGroups}
				entityWorkspace={selectedEntityWorkspace ?? undefined}
				entityIntent={editPresentation.intent === 'author' ? 'edit' : 'inspect'}
				inspectionSubjectOverride={
					resolvedEntitySurface === 'inspector' ? inspectionSubject : undefined
				}
				currentUserPubkey={currentUserPubkey}
				onLoadDataset={onLoadDataset}
				onStartNewDataset={onStartNewDataset}
				onSwitchWorkspace={onSwitchWorkspace}
				onDeleteWorkspace={onDeleteWorkspace}
				onPublishNew={props.onPublishNew}
				canPublishNew={props.canPublishNew}
				isPublishing={isPublishing}
				onOpenGeometryEditor={onOpenGeometryEditor ? () => void onOpenGeometryEditor() : undefined}
				onToggleVisibility={onToggleVisibility}
				onZoomToDataset={handleMobileZoomToDataset}
				onDeleteDataset={onDeleteDataset}
				onDeleteContext={onDeleteContext}
				deletingKey={deletingKey}
				onExitViewMode={onExitViewMode}
				onEditContext={onEditContext}
				onClose={handleClose}
				getDatasetKey={getDatasetKey}
				getDatasetName={getDatasetName}
				onCommentGeometryVisibility={onCommentGeometryVisibility}
				onZoomToBounds={handleMobileZoomToBounds}
				availableFeatures={availableFeatures}
				onMentionVisibilityToggle={onMentionVisibilityToggle}
				onMentionZoomTo={onMentionZoomTo}
				isMentionVisible={isMentionVisible}
				onToggleProposalOverlay={onToggleProposalOverlay}
				onProposalAccepted={onProposalAccepted}
				visibleProposalIds={visibleProposalIds}
				contextEditorMode={contextEditorMode}
				editingContext={editingContext}
				contextCreationSeed={contextCreationSeed}
				onSaveContext={onSaveContext}
				onCloseContextEditor={onCloseContextEditor}
				storyEditorMode={storyEditorMode}
				editingStory={editingStory}
				onSaveStory={onSaveStory}
				onCloseStoryEditor={onCloseStoryEditor}
				onEditStory={onEditStory}
				onStoryUpdated={onStoryUpdated}
				onDeleteStory={onDeleteStory}
				captureMapPresentation={captureMapPresentation}
				captureStoryView={captureStoryView}
				onStoryViewPreviewReset={onStoryViewPreviewReset}
				onStoryEditorActiveChange={
					mobilePanelOpen && mobilePanelTab === 'edit' ? onStoryEditorActiveChange : undefined
				}
				onStoryViewActivate={onStoryViewActivate}
				renderStoryViewFigure={renderStoryViewFigure}
				activeStoryViewId={activeStoryViewId}
				beaconControlMode={beaconControlMode}
				adjustingBeacon={adjustingBeacon}
				viewBeacon={viewBeacon}
				isFollowingBeacon={isFollowingBeacon}
				onToggleFollowBeacon={onToggleFollowBeacon}
				beaconIsStarting={beaconIsStarting}
				beaconFocusCommentId={beaconFocusCommentId}
				onStartBeacon={onStartBeacon}
				onCloseBeaconControl={onCloseBeaconControl}
				onStopBeacon={onStopBeacon}
				onAdjustBeacon={onAdjustBeacon}
				onZoomToBeacon={onWatchOnMapBeacon}
				onAddBeaconToMapStack={onAddBeaconToMapStack}
				sightingEditorMode={sightingEditorMode}
				editingSighting={editingSighting}
				viewSighting={viewSighting}
				sightingFocusCommentId={sightingFocusCommentId}
				placedSightingGeometry={placedSightingGeometry}
				onZoomToSighting={onZoomToSighting}
				onDrawSightingArea={onDrawSightingArea}
				onSaveSighting={onSaveSighting}
				onCloseSightingEditor={onCloseSightingEditor}
				onEditSighting={onEditSighting}
				onDeleteSighting={onDeleteSighting}
				onAddSightingToMapStack={onAddSightingToMapStack}
				mapContextEvents={mapContextEvents}
				onZoomToFeature={onZoomToFeature}
				featureCollectionForUpload={featureCollectionForUpload}
				onBlossomUploadComplete={onBlossomUploadComplete}
				focusCommentId={focusCommentId}
			/>
		</MobilePanelHeaderActionProvider>
	)
	const resumeOptions = entitySurfaceOptions.filter(
		({ surface }) => surface !== resolvedEntitySurface,
	)
	const resumeRouteKey = mobileResumeRouteKey(route)
	const resumeSurface = async (surface: MobileEntitySurface) => {
		if (!entitySurfaceAvailability[surface]) return
		if (surface === 'dataset' && onOpenDraftEditor) {
			const workspaceId = useEditorStore.getState().activeWorkspaceId
			if (!workspaceId || !(await onOpenDraftEditor(workspaceId))) return
			if (useEditorStore.getState().activeWorkspaceId !== workspaceId) return
		}
		if (surface === 'inspector' && inspectionSubject) {
			if (inspectionSubject.kind === 'dataset') handleMobileInspectDataset(inspectionSubject.entity)
			else if (inspectionSubject.kind === 'context')
				handleMobileInspectContext(inspectionSubject.entity)
			else if (inspectionSubject.kind === 'story')
				storiesPanelProps?.onOpenStory(inspectionSubject.entity)
			else if (inspectionSubject.kind === 'sighting')
				sightingsPanelProps?.onOpenSighting(inspectionSubject.entity)
			else beaconsPanelProps?.onOpenBeacon(inspectionSubject.entity)
			activateMobileEntitySurface(surface, entitySurfaceAvailability)
			setMobilePanelTab('edit')
			return
		}
		if (surface === 'inspector') return
		const retainedMap = getRetainedDatasetSurfaceTarget(useEditorStore.getState())
		const href = mobileResumeDestination(surface, {
			storyAddress: editingStory ? encodeGeoEventNaddr(editingStory) : null,
			atlasAddress: editingContext ? encodeContextNaddr(editingContext) : null,
			publishChannel: retainedMap?.draft.publishChannel,
		})
		setPendingResume({
			surface,
			href,
			snap: mobilePanelSnap === 'peek' ? 'half' : mobilePanelSnap,
			fromRouteKey: resumeRouteKey,
		})
		navigateToRoute(href)
		activateMobileEntitySurface(surface, entitySurfaceAvailability)
		setMobilePanelTab('edit')
	}
	useEffect(() => {
		if (!pendingResume || typeof window === 'undefined') return
		const destinationKey = mobileResumeRouteKey(
			routeStateFromEarthlyRoute(parseEarthlyRoute(pendingResume.href, {})),
		)
		const status = mobileResumeNavigationStatus(
			resumeRouteKey,
			pendingResume.fromRouteKey,
			destinationKey,
		)
		if (status !== 'arrived') {
			if (status === 'cancelled') setPendingResume(null)
			return
		}
		let cancelled = false
		// The route reducer first restores its destination. Reveal the retained
		// non-Map editor after that reconciliation without restarting its lifecycle.
		queueMicrotask(() => {
			if (cancelled || window.location.pathname !== pendingResume.href) return
			const state = useEditorStore.getState()
			if (
				state.activateMobileEntitySurface(pendingResume.surface, {
					inspector: state.inspectionSubject != null,
					dataset: hasRetainedDatasetSurface(state),
					story: storyEditorMode != null && storyEditorMode !== 'none',
					context: contextEditorMode != null && contextEditorMode !== 'none',
					sighting: sightingEditorMode != null && sightingEditorMode !== 'none',
					beacon: beaconControlMode != null && beaconControlMode !== 'none',
				})
			) {
				state.openMobilePanel('edit')
				state.setMobilePanelSnap(pendingResume.snap)
			}
			setPendingResume(null)
		})
		return () => {
			cancelled = true
		}
	}, [
		pendingResume,
		resumeRouteKey,
		storyEditorMode,
		contextEditorMode,
		sightingEditorMode,
		beaconControlMode,
	])
	const resumeMenu =
		resumeOptions.length > 0 ? (
			<DropdownMenu
				onOpenChange={(open) => {
					// Manual edits persist independently of the AI bridge; reread the
					// current account's draft when its saved-work menu becomes visible.
					if (open) refreshRetainedStoryDraftTitle()
				}}
			>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-11 shrink-0 rounded-none"
						aria-label="Resume saved work"
						title="Resume saved work"
					>
						<FilePenLine className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-24px)]">
					<DropdownMenuLabel>Resume saved work</DropdownMenuLabel>
					{resumeOptions.map(({ surface, label }) => (
						<DropdownMenuItem
							key={surface}
							onSelect={() => void resumeSurface(surface)}
							className="min-h-11"
						>
							{workingEntitySurface === surface ? (
								<LoaderCircle className="size-4 animate-spin" />
							) : null}
							<span className="truncate">{label}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		) : null
	const sheetTransparencyControl = (
		<Button
			type="button"
			size="icon"
			className="h-11 w-11 shrink-0 rounded-none"
			variant={panelTranslucent ? 'default' : 'ghost'}
			onClick={() => setPanelTranslucent((value) => !value)}
			aria-pressed={panelTranslucent}
			aria-label={panelTranslucent ? 'Use opaque panel' : 'See map through panel'}
			title={panelTranslucent ? 'Use opaque panel' : 'See map through panel'}
		>
			<Eye className="h-4 w-4" />
		</Button>
	)
	const sheetCloseControl = (
		<Button
			type="button"
			size="icon"
			variant="ghost"
			className="h-11 w-11 shrink-0 rounded-none"
			onClick={handleClose}
			aria-label={sheetCloseLabel}
		>
			<X className="h-4 w-4" />
		</Button>
	)
	const threadPanel = (
		<div
			className={cn(
				'h-full min-h-0',
				panelTranslucent && '[&>section>div:first-child]:!bg-background/25',
			)}
		>
			<ChatPanel
				geoEvents={geoEvents}
				mapContextEvents={mapContextEvents}
				availableFeatures={availableFeatures}
				getDatasetName={getDatasetName}
				onOpenSettings={() => void selectPanel('settings')}
				threadKey={routeThreadKey}
				threadTitle={routeThreadTitle}
				embeddedInObject={objectNavigation.showThread}
				readOnly={routedAskOpen || (routedObjectThreadOpen && route.focusType !== 'geoevent')}
				initialPrompt={askInitialPrompt}
				onEnsureAuthoringTarget={
					routedDraftThreadOpen ||
					(routedObjectThreadOpen && route.focusType === 'geoevent' && viewDataset)
						? ensureRouteThreadMapTarget
						: undefined
				}
				authoringActionLabel={
					routedDraftThreadOpen
						? 'Send'
						: currentUserPubkey && viewDataset?.pubkey === currentUserPubkey
							? 'Edit & send'
							: 'Propose & send'
				}
				onClose={() => {
					if (routedDraftThreadOpen) navigateToRoute('/edit')
					else if (routedObjectThreadOpen) handleObjectTabChange('details')
					else if (routedAskOpen) navigateToView('datasets')
				}}
			/>
		</div>
	)

	// Browse and map-bound inspection share the vertical sheet. Legacy utility
	// destinations remain in the horizontal drawer until explicitly selected.
	return (
		<EntityListTranslucencyContext.Provider value={panelTranslucent && mobilePanelOpen}>
			<MobileObjectNavigationContext.Provider
				value={{
					headerActions: (
						<>
							{resumeMenu}
							{sheetTransparencyControl}
						</>
					),
					onClose: handleClose,
					activeTab: objectNavigation.activeTab,
					threadWorking: chatWorking,
					onExpandComposer: () => setMobilePanelSnap('full'),
					threadContent: objectNavigation.showThread ? threadPanel : undefined,
				}}
			>
				{mobileSidebarOpen || mobilePanelOpen
					? createPortal(
							<>
								{mobileSidebarOpen ? (
									<button
										type="button"
										aria-label="Close navigation"
										className="fixed inset-x-0 top-0 bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] z-40 bg-black/35 md:hidden"
										onClick={closeNavigationSurface}
									/>
								) : null}
								<div
									ref={sheetRef}
									data-testid={mobileSidebarOpen ? 'mobile-sidebar' : 'mobile-sheet'}
									data-translucent={panelTranslucent && mobilePanelOpen ? 'true' : 'false'}
									role="dialog"
									aria-label={mobileSidebarOpen ? 'Earthly navigation' : `${activeLabel} panel`}
									className={cn(
										'fixed z-40 flex flex-col overflow-hidden border-border md:hidden',
										mobileSheetSurfaceClassName(panelTranslucent && mobilePanelOpen),
										mobileSidebarOpen
											? cn(
													'left-0 top-0 bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] z-50 rounded-r-lg border-r shadow-xl transition-[width] duration-200 ease-out',
													sidebarIsMenu
														? 'w-[clamp(17.5rem,72dvw,21.25rem)]'
														: 'w-[min(92dvw,30rem)]',
												)
											: cn(
													'inset-x-0 bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] rounded-t-lg border-t',
													dragPx === null && 'transition-[height] duration-200 ease-out',
												),
									)}
									style={
										mobilePanelOpen
											? {
													height: keyboardViewport.keyboardOpen
														? keyboardSheetHeight
														: `${resolvedSheetHeight}px`,
													maxHeight: keyboardViewport.keyboardOpen
														? undefined
														: `calc(100dvh - var(--mobile-dock-height) - env(safe-area-inset-bottom) - 12px${mapEditing && selectionCount > 0 ? ' - 44px' : ''})`,
													...(keyboardViewport.keyboardOpen ? { bottom: keyboardSheetBottom } : {}),
													...(mapEditing && selectionCount > 0 && !keyboardViewport.keyboardOpen
														? {
																bottom:
																	'calc(var(--mobile-dock-height) + env(safe-area-inset-bottom) + 44px)',
															}
														: {}),
												}
											: undefined
									}
								>
									{/* The sheet only owns resizing. Published Map navigation lives
								    in its object header, not in a second set of mode tabs. */}
									{mapEditPeek ? (
										<section
											className="flex h-[62px] shrink-0 flex-col border-b border-border bg-[var(--surface-chrome)]"
											aria-label="Map draft summary"
										>
											<div
												role="slider"
												aria-label="Resize panel"
												aria-orientation="vertical"
												aria-valuemin={sheetDetentHeight('peek')}
												aria-valuemax={Math.round(sheetDetentHeight('full'))}
												aria-valuenow={Math.round(dragPx ?? sheetDetentHeight('peek'))}
												tabIndex={0}
												onPointerDown={handleDragStart}
												onKeyDown={handleResizeKeyDown}
												style={{ touchAction: 'none' }}
												className="flex h-[18px] w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
											>
												<span className="h-1 w-8 rounded-full bg-muted-foreground/40" />
											</div>
											<div className="flex min-h-11 items-center gap-2 px-3">
												<Pencil className="size-4 shrink-0 text-primary" aria-hidden="true" />
												<button
													type="button"
													className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
													aria-label="Map details"
													onClick={() => setMobilePanelSnap('half')}
												>
													<strong className="truncate text-sm">
														{retainedDatasetSurfaceTitle}
													</strong>
													<span className="shrink-0 text-xs text-muted-foreground">
														{featureCount} features
													</span>
												</button>
												{props.mapEditPublishAction}
											</div>
										</section>
									) : null}
									{mobilePanelOpen && !mapEditPeek ? (
										<div
											data-testid="mobile-sheet-controls"
											className={cn(
												'flex w-full shrink-0 items-center',
												integratedObjectHeader ? 'h-[18px]' : 'h-[45px] border-b border-border',
												mobileSheetChromeClassName(panelTranslucent),
											)}
										>
											{!integratedObjectHeader && browseKind ? (
												<span className="px-3 font-mono text-[10px] uppercase tracking-widest">
													Browse
												</span>
											) : !integratedObjectHeader && mapWorkSurfaceVisible ? (
												<Button
													variant="ghost"
													size="sm"
													className="min-h-11 shrink-0 gap-1 px-2"
													onClick={() => {
														if (routedDraftThreadOpen) navigateToRoute('/edit')
														else if (routedObjectThreadOpen) handleObjectTabChange('details')
														else handleClose()
													}}
													aria-label={routedDraftThreadOpen ? 'Back to Map' : undefined}
												>
													<ArrowLeft className="size-3.5" />
													<span className="text-xs">
														{routedDraftThreadOpen ? 'Map' : activeLabel}
													</span>
												</Button>
											) : null}
											{keyboardViewport.keyboardOpen ? (
												<div
													aria-hidden="true"
													className="flex h-full flex-1 items-center justify-center"
												>
													<span className="h-1.5 w-7 rounded-full bg-accent" />
												</div>
											) : (
												<div
													role="slider"
													aria-label="Resize panel"
													aria-orientation="vertical"
													aria-valuemin={sheetDetentHeight('peek')}
													aria-valuemax={Math.round(sheetDetentHeight('full'))}
													aria-valuenow={Math.round(dragPx ?? sheetDetentHeight(mobilePanelSnap))}
													tabIndex={0}
													onPointerDown={handleDragStart}
													onKeyDown={handleResizeKeyDown}
													style={{ touchAction: 'none' }}
													className="flex h-full min-w-11 flex-1 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
												>
													<span className="h-1.5 w-7 rounded-full bg-accent" />
												</div>
											)}
											{!integratedObjectHeader ? (
												<div className="flex h-11 shrink-0 items-center justify-end">
													{mapWorkSurfaceVisible ? resumeMenu : null}
													{sheetTransparencyControl}
													{sheetCloseControl}
												</div>
											) : null}
										</div>
									) : null}

									{sidebarIsMenu && mobileSidebarOpen ? (
										<div className="flex min-h-0 flex-1 flex-col">
											<div className="shrink-0 border-b border-border px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
												<div className="mb-3 flex items-center justify-between gap-2">
													<div>
														<p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
															Earthly
														</p>
														<h2 className="text-lg font-semibold text-foreground">
															Map & saved work
														</h2>
													</div>
													<Button
														variant="ghost"
														size="icon-sm"
														onClick={closeNavigationSurface}
														aria-label="Close navigation"
													>
														<X className="h-4 w-4" />
													</Button>
												</div>
												<LoginSessionButtons />
											</div>
											<nav
												aria-label="Earthly sections"
												className="flex-1 overflow-y-auto px-1.5 py-2"
											>
												<div className="mb-2 border-b border-border pb-2">
													<button
														type="button"
														onClick={() => {
															closeMobileSidebar()
															onOpenDiscover()
														}}
														className="flex w-full items-center gap-3 rounded-[2px] border border-primary/30 bg-primary/10 px-2.5 py-2.5 text-left transition-colors hover:bg-primary/15"
													>
														<Compass className="h-4 w-4 shrink-0 text-primary" />
														<span className="flex-1 text-[13.5px] font-medium text-foreground">
															Discover
														</span>
														<span className="font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">
															Latest
														</span>
													</button>
												</div>
												{SIDEBAR_GROUPS.map((group) => (
													<div key={group.label} className="mb-1">
														<div className="px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-wide text-muted-foreground">
															{group.label}
														</div>
														{group.tabs.map((id) => {
															const meta = tabMeta(id)
															const Icon = meta.icon
															const isActive = mobilePanelTab === id
															const count = panelCount(id)
															return (
																<button
																	key={id}
																	type="button"
																	onClick={() => void selectPanel(id)}
																	className={cn(
																		'flex w-full items-center gap-3 rounded-[2px] px-2.5 py-2.5 text-left transition-colors',
																		isActive ? 'bg-primary/15' : 'hover:bg-muted',
																	)}
																>
																	<Icon
																		className={cn(
																			'h-4 w-4 shrink-0',
																			isActive ? 'text-primary' : 'text-muted-foreground',
																		)}
																	/>
																	<span className="flex-1 text-[13.5px] text-foreground">
																		{meta.label}
																	</span>
																	{count != null ? (
																		<span className="font-mono text-[9px] text-muted-foreground">
																			{count}
																		</span>
																	) : null}
																</button>
															)
														})}
													</div>
												))}
											</nav>
										</div>
									) : (
										<>
											{browseKind ? (
												<BrowseEntityTabs
													activeKind={browseKind}
													counts={{ maps: geoEvents.length, atlases: mapContextEvents.length }}
													onKindChange={(kind) => navigateToRoute(`/browse/${kind}`)}
													onCreate={(kind) => {
														if (kind === 'maps') onStartNewDataset?.()
														if (kind === 'atlases') onCreateContext?.()
														if (kind === 'stories') storiesPanelProps?.onCreateStory()
														if (kind === 'sightings') sightingsPanelProps?.onCreateSighting()
													}}
													className="shrink-0 [&_[role=tab]]:h-11"
												/>
											) : null}
											{!mapWorkSurfaceVisible && !browseKind ? (
												<div
													className={cn(
														'flex shrink-0 items-center gap-1 border-b border-border',
														mobileSheetInnerSurfaceClassName(panelTranslucent),
														mobilePanelTab === 'chat'
															? 'px-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))]'
															: 'px-3 py-2 pt-[max(0.25rem,env(safe-area-inset-top))]',
													)}
												>
													{mobileSidebarOpen ? (
														<Button
															type="button"
															size="icon-sm"
															variant="ghost"
															onClick={showMobileSidebarMenu}
															aria-label="Back to menu"
														>
															<ArrowLeft className="h-4 w-4" />
														</Button>
													) : null}
													<ActiveIcon className="h-4 w-4 text-primary" />
													<h2 className="text-sm font-semibold text-foreground">{activeLabel}</h2>
													{activeCount != null ? (
														<span className="font-mono text-[9px] text-muted-foreground">
															{activeCount}
														</span>
													) : null}
													<div className="ml-auto flex items-center gap-1">
														<div
															ref={setHeaderActionTarget}
															className="flex min-w-0 items-center"
														/>
														{newAction && mobileSidebarOpen ? (
															<Button
																type="button"
																size="icon"
																className="h-11 w-11 shrink-0"
																variant="outline"
																onClick={() => {
																	leaveSidebar()
																	newAction.onClick()
																}}
																aria-label={newAction.label}
															>
																<Plus className="h-3.5 w-3.5" />
															</Button>
														) : null}
														{mobileSidebarOpen ? (
															<Button
																type="button"
																size="icon"
																variant="ghost"
																className="h-11 w-11 shrink-0"
																onClick={closeNavigationSurface}
																aria-label={`Close ${activeLabel}`}
															>
																<X className="h-4 w-4" />
															</Button>
														) : null}
													</div>
												</div>
											) : null}
											{mapWorkSurfaceVisible && !mapEditPeek ? (
												<div
													ref={setHeaderActionTarget}
													data-testid="mobile-workspace-header-actions"
													className={mobileWorkspaceHeaderActionRowClassName(panelTranslucent)}
												/>
											) : null}
											{mapEditing && !mapEditPeek ? (
												<div className="flex min-h-11 shrink-0 items-center justify-end gap-2 border-b border-border px-3 py-1">
													{selectedEntitySurfaceWorking ? (
														<LoaderCircle
															className="size-3 animate-spin text-primary"
															aria-label="AI working"
														/>
													) : null}
													{props.mapEditPublishAction}
												</div>
											) : null}
											{mobileSidebarOpen &&
											mobilePanelTab !== 'private-groups' &&
											mobilePanelTab !== 'field-sessions' &&
											mobilePanelTab !== 'drafts' &&
											mobilePanelTab !== 'delivery' ? (
												<div className="shrink-0 border-b border-border bg-card px-3 py-1.5">
													<div className="flex items-center gap-1.5">
														<div className="w-full">
															<EntitySearchPopover
																sources={{ contexts: mapContextEvents }}
																entityTypes={['context']}
																onSelect={handleContextScopeSelect}
																placeholder={activeContextScopeLabel ?? 'Browse all atlases'}
																searchMode="local"
																compact
															/>
														</div>
														{contextNaddr ? (
															<Button
																type="button"
																variant="outline"
																size="icon-sm"
																onClick={clearContextScope}
																aria-label="Clear atlas browse scope"
															>
																<X className="h-3.5 w-3.5" />
															</Button>
														) : null}
													</div>
												</div>
											) : null}
											<EmbeddedListPanelContext.Provider value={true}>
												<div
													data-testid={mobilePanelOpen ? 'mobile-sheet-body' : undefined}
													className={cn(
														'min-h-0 flex-1',
														panelTranslucent && mobilePanelOpen && 'bg-transparent',
														integratedObjectHeader
															? 'overflow-hidden px-3 pb-2'
															: mobilePanelTab === 'chat'
																? 'overflow-hidden'
																: 'overflow-y-auto px-3 pb-4 pt-2',
													)}
												>
													{mobilePanelTab === 'drafts' ? (
														<div className="-mx-3 -mb-4 -mt-2 h-full min-h-[18rem]">
															<LocalDraftsPanel
																geoEvents={geoEvents}
																onStartNewDataset={onStartNewDataset}
																onSwitchWorkspace={onSwitchWorkspace}
																onDeleteWorkspace={onDeleteWorkspace}
																onAddDraftToWorkspace={onAddDraftToWorkspace}
																onLoadDraft={onLoadDraft}
																onDeleteDraft={onDeleteDraft}
																destinationOptions={draftDestinationOptions}
																onResolveDraftDestination={onResolveDraftDestination}
																showPanelHeader={false}
															/>
														</div>
													) : null}
													{mobilePanelTab === 'datasets' ? (
														<GeoDatasetsPanelContent
															mode="datasets"
															geoEvents={geoEvents}
															mapContextEvents={mapContextEvents}
															activeDataset={activeDataset}
															currentUserPubkey={currentUserPubkey}
															datasetVisibility={datasetVisibility}
															isPublishing={isPublishing}
															deletingKey={deletingKey}
															onLoadDataset={onLoadDataset}
															onToggleVisibility={onToggleVisibility}
															onToggleAllVisibility={onToggleAllVisibility}
															onZoomToDataset={handleMobileZoomToDataset}
															onAddDatasetToMap={onAddDatasetToMap}
															onRemoveDatasetFromMap={onRemoveDatasetFromMap}
															onDeleteDataset={onDeleteDataset}
															onDeleteContext={onDeleteContext}
															getDatasetKey={getDatasetKey}
															getDatasetName={getDatasetName}
															onInspectDataset={handleMobileInspectDataset}
															onInspectContext={handleMobileInspectContext}
															onOpenDebug={onOpenDebug}
															onStartNewDataset={onStartNewDataset}
															onCreateContext={onCreateContext}
															onEditContext={onEditContext}
															isFocused={isFocused}
															onExitFocus={onExitFocus}
															onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
														/>
													) : null}

													{mobilePanelTab === 'map-stack' ? (
														<div
															className={cn(
																'-mx-1 -mb-2 h-full min-h-[18rem]',
																panelTranslucent && '[&>section]:!bg-background/25',
															)}
														>
															<MapStackPanel
																geoEvents={geoEvents}
																mapContextEvents={mapContextEvents}
																getDatasetKey={getDatasetKey}
																getDatasetName={getDatasetName}
																onAddDatasetToMap={onAddDatasetToMap}
																onInspectDataset={handleMobileInspectDataset}
																onZoomToDataset={handleMobileZoomToDataset}
																onLoadDataset={onLoadDataset}
																onInspectContext={handleMobileInspectContext}
																onSetEntryVisible={onSetMapStackEntryVisible}
																onSetEntryIsolated={onSetMapStackEntryIsolated}
																onRemoveEntry={onRemoveMapStackEntry}
																onOpenDraftEditor={
																	onOpenDraftEditor ? () => void onOpenDraftEditor() : undefined
																}
																onZoomToDraft={onZoomToDraft}
																onClear={onClearMapStack}
																translucent={panelTranslucent}
															/>
														</div>
													) : null}

													{mobilePanelTab === 'contexts' ? (
														<GeoDatasetsPanelContent
															mode="contexts"
															geoEvents={geoEvents}
															mapContextEvents={mapContextEvents}
															activeDataset={activeDataset}
															currentUserPubkey={currentUserPubkey}
															datasetVisibility={datasetVisibility}
															isPublishing={isPublishing}
															deletingKey={deletingKey}
															onLoadDataset={onLoadDataset}
															onToggleVisibility={onToggleVisibility}
															onToggleAllVisibility={onToggleAllVisibility}
															onZoomToDataset={handleMobileZoomToDataset}
															onAddDatasetToMap={onAddDatasetToMap}
															onRemoveDatasetFromMap={onRemoveDatasetFromMap}
															onDeleteDataset={onDeleteDataset}
															onDeleteContext={onDeleteContext}
															getDatasetKey={getDatasetKey}
															getDatasetName={getDatasetName}
															onInspectDataset={handleMobileInspectDataset}
															onInspectContext={handleMobileInspectContext}
															onOpenDebug={onOpenDebug}
															onStartNewDataset={onStartNewDataset}
															onCreateContext={onCreateContext}
															onEditContext={onEditContext}
															isFocused={isFocused}
															onExitFocus={onExitFocus}
															onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
														/>
													) : null}

													{mobilePanelTab === 'private-groups' ? (
														<PrivateGroupsPanel
															onStartNewDataset={onStartNewDataset}
															datasetActions={privateDatasetActions}
															onCommentGeometryVisibility={onCommentGeometryVisibility}
															onZoomToBounds={handleMobileZoomToBounds}
															availableFeatures={availableFeatures}
															onMentionVisibilityToggle={onMentionVisibilityToggle}
															onMentionZoomTo={onMentionZoomTo}
														/>
													) : null}

													{mobilePanelTab === 'field-sessions' ? (
														<FieldSessionsPanel
															onStartNewDataset={onStartNewDataset}
															datasetActions={fieldDatasetActions}
															fieldSessionEvents={fieldSessionEvents}
															onPublishFieldSessionEvent={onPublishFieldSessionEvent}
															onRefreshFieldSessionEvents={onRefreshFieldSessionEvents}
															onCommentGeometryVisibility={onCommentGeometryVisibility}
															onZoomToBounds={handleMobileZoomToBounds}
															availableFeatures={availableFeatures}
															onMentionVisibilityToggle={onMentionVisibilityToggle}
															onMentionZoomTo={onMentionZoomTo}
														/>
													) : null}

													{mobilePanelTab === 'context-editor' ? (
														<GeoEditorInfoPanelContent
															currentUserPubkey={currentUserPubkey}
															onLoadDataset={onLoadDataset}
															onStartNewDataset={onStartNewDataset}
															onSwitchWorkspace={onSwitchWorkspace}
															onToggleVisibility={onToggleVisibility}
															onZoomToDataset={handleMobileZoomToDataset}
															onDeleteDataset={onDeleteDataset}
															onDeleteContext={onDeleteContext}
															deletingKey={deletingKey}
															onExitViewMode={onExitViewMode}
															onClose={handleClose}
															getDatasetKey={getDatasetKey}
															getDatasetName={getDatasetName}
															onCommentGeometryVisibility={onCommentGeometryVisibility}
															onZoomToBounds={handleMobileZoomToBounds}
															availableFeatures={availableFeatures}
															onMentionVisibilityToggle={onMentionVisibilityToggle}
															onMentionZoomTo={onMentionZoomTo}
															isMentionVisible={isMentionVisible}
															onToggleProposalOverlay={onToggleProposalOverlay}
															onProposalAccepted={onProposalAccepted}
															visibleProposalIds={visibleProposalIds}
															contextEditorMode={
																contextEditorMode !== 'none' ? contextEditorMode : 'create'
															}
															editingContext={editingContext}
															contextCreationSeed={contextCreationSeed}
															onSaveContext={onSaveContext}
															onCloseContextEditor={onCloseContextEditor}
															captureMapPresentation={captureMapPresentation}
															mapContextEvents={mapContextEvents}
															onZoomToFeature={onZoomToFeature}
															featureCollectionForUpload={featureCollectionForUpload}
															onBlossomUploadComplete={onBlossomUploadComplete}
															focusCommentId={focusCommentId}
														/>
													) : null}

													{mobilePanelTab === 'sightings' ? (
														sightingsPanelProps ? (
															<SightingsPanelContent
																{...sightingsPanelProps}
																onOpenSighting={(sighting) => {
																	leaveSidebar()
																	sightingsPanelProps.onOpenSighting(sighting)
																}}
																onZoomToSighting={(sighting) => {
																	leaveSidebar()
																	sightingsPanelProps.onZoomToSighting?.(sighting)
																}}
															/>
														) : null
													) : null}

													{mobilePanelTab === 'beacons' ? (
														beaconsPanelProps ? (
															<BeaconsPanelContent
																{...beaconsPanelProps}
																onOpenBeacon={(beacon) => {
																	leaveSidebar()
																	beaconsPanelProps.onOpenBeacon(beacon)
																}}
																onWatchOnMap={(beacon) => {
																	leaveSidebar()
																	beaconsPanelProps.onWatchOnMap?.(beacon)
																}}
															/>
														) : null
													) : null}

													{mobilePanelTab === 'stories' ? (
														storiesPanelProps ? (
															<StoriesPanelContent
																{...storiesPanelProps}
																onOpenStory={(story) => {
																	leaveSidebar()
																	storiesPanelProps.onOpenStory(story)
																}}
															/>
														) : null
													) : null}

													{/* Every entity editor, including a geometry draft, lives in the
												    dedicated Edit sheet. The Map Stack only represents visibility. */}
													{mobilePanelTab === 'edit' ||
													(mobilePanelTab === 'chat' && routedObjectThreadOpen)
														? editorPanel
														: null}

													{mobilePanelTab === 'chat' && !routedObjectThreadOpen
														? threadPanel
														: null}

													{browseKind === 'people' ? (
														<section
															id="browse-people-panel"
															role="tabpanel"
															aria-label="People"
															className="flex min-h-52 flex-col gap-4 py-3"
														>
															<div>
																<h2 className="text-sm font-semibold">Find people</h2>
																<p className="mt-1 text-xs text-muted-foreground">
																	Search public profiles by name or key.
																</p>
															</div>
															<EntitySearchPopover
																entityTypes={['person']}
																searchMode="both"
																placeholder="Search people"
																onSelect={(result) => {
																	if (result.type === 'person' && result.pubkey)
																		navigateToUser(result.pubkey)
																}}
															/>
														</section>
													) : mobilePanelTab === 'profile' ? (
														<MobileProfileContent
															pubkey={userPubkey ?? currentUserPubkey}
															geoEvents={geoEvents}
															mapContextEvents={mapContextEvents}
															currentUserPubkey={currentUserPubkey}
															datasetVisibility={datasetVisibility}
															isPublishing={isPublishing}
															deletingKey={deletingKey}
															onLoadDataset={onLoadDataset}
															onSwitchWorkspace={onSwitchWorkspace}
															onDeleteWorkspace={onDeleteWorkspace}
															onToggleVisibility={onToggleVisibility}
															onToggleAllVisibility={onToggleAllVisibility}
															onZoomToDataset={handleMobileZoomToDataset}
															onDeleteDataset={onDeleteDataset}
															onDeleteContext={onDeleteContext}
															getDatasetKey={getDatasetKey}
															getDatasetName={getDatasetName}
															onInspectDataset={handleMobileInspectDataset}
															onInspectContext={handleMobileInspectContext}
															onEditContext={onEditContext}
															onOpenDebug={onOpenDebug}
														/>
													) : null}

													{mobilePanelTab === 'posts' ? (
														<div className="-mx-3 -mb-4 -mt-2 h-full">
															<ShoutboxPanel />
														</div>
													) : null}

													{mobilePanelTab === 'delivery' ? (
														publicRoute.kind === 'inbox' ? (
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
													) : null}

													{mobilePanelTab === 'wallet' ? (
														<div className="-mx-3 -mb-4 -mt-2 h-full p-4">
															<Nip60Wallet />
														</div>
													) : null}

													{mobilePanelTab === 'settings' ? (
														<div className="-mx-3 -mb-4 -mt-2 h-full">
															<MapSettingsPanel />
														</div>
													) : null}

													{mobilePanelTab === 'help' ? (
														<div className="-mx-3 -mb-4 -mt-2 h-full">
															<HelpPanel multiSelectModifier={multiSelectModifier} />
														</div>
													) : null}
												</div>
											</EmbeddedListPanelContext.Provider>
										</>
									)}
								</div>
							</>,
							document.body,
						)
					: null}
			</MobileObjectNavigationContext.Provider>
		</EntityListTranslucencyContext.Provider>
	)
}

interface MobileProfileContentProps {
	pubkey?: string | null
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (
		event: GeoDataset,
		options?: DatasetEditOptions,
	) => boolean | undefined | Promise<boolean | undefined>
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset) => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onInspectDataset?: (event: GeoDataset) => void
	onInspectContext?: (context: MapContext) => void
	onEditContext?: (context: MapContext) => void
	onOpenDebug?: (event: GeoDataset | MapContext) => void
}

function MobileProfileContent(props: MobileProfileContentProps) {
	const { pubkey, ...rest } = props

	if (!pubkey) {
		return (
			<div className="flex flex-col items-center py-6">
				<User className="mb-2 h-8 w-8 text-muted-foreground" />
				<SignedOutCta
					title="Profile"
					description="Sign in to view your profile and everything you've published."
				/>
			</div>
		)
	}

	return <UserProfilePanel pubkey={pubkey} {...rest} />
}
