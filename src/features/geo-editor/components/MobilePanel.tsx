import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { FeatureCollection } from 'geojson'
import { toast } from 'sonner'
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
import { EmbeddedListPanelContext } from '@/components/entity-list'
import { GeoDatasetsPanelContent } from '@/components/GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from '@/components/GeoEditorInfoPanel'
import { HelpPanel } from '@/components/HelpPanel'
import { MapStackPanel } from '@/components/MapStackPanel'
import { SightingsPanelContent, type SightingsPanelProps } from '@/components/SightingsPanel'
import { BeaconsPanelContent, type BeaconsPanelProps } from '@/components/BeaconsPanel'
import { StoriesPanelContent, type StoriesPanelProps } from '@/components/StoriesPanel'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { ShoutboxPanel } from '@/features/social/shoutbox'
import { PrivateGroupsPanel } from '@/features/private-maps/PrivateMapsDialog'
import {
	FieldSessionsPanel,
	type FieldDatasetActions,
} from '@/features/field-sessions/FieldSessionsPanel'
import type { PrivateDatasetActions } from '@/features/private-maps/PrivateGeometryReferences'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
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
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { LoginSessionButtons } from '@/features/auth/LoginSessionButtons'
import {
	countVisibleLocalDraftWorkspaces,
	LocalDraftsPanel,
	type LocalDraftDestinationOption,
	type WorkspaceDraftNavigatorProps,
} from '@/components/WorkspaceDraftNavigator'
import { MapSettingsPanel } from './MapSettingsPanel'
import { ChatPanel } from '@/features/chat/ChatPanel'
import { useChatStore } from '@/features/chat/store'
import { Nip60Wallet } from '@/features/wallet/components/Nip60Wallet'
import { useRouting } from '../hooks/useRouting'
import { DEFAULT_WORK_VIEW } from '../defaults'
import { PublishOutboxPanel } from '@/features/delivery'
import { NEW_STORY_DRAFT_KEY, readStoryDraft } from '@/lib/nostr/story'
import { MobilePanelHeaderActionProvider } from './MobilePanelHeaderAction'
import { resolveMobileViewportLayout } from './mobileViewport'
import {
	attemptConversationEditTargetRestore,
	CHAT_EDIT_TARGET_UNAVAILABLE_MESSAGE,
	mobileWorkspacePanelUsesKeyboardViewport,
	resolveActiveConversationEditTarget,
	resolveMobileDatasetSurfaceTitle,
	resolveMobileEditPanelPresentation,
	resolveMobileStorySurfaceTitle,
	resolveMobileWorkspaceTabKey,
	type MobileWorkspacePanelTab,
} from './mobileEditPanelPresentation'
import {
	mobileSheetCloseLabel,
	mobileSheetChromeClassName,
	mobileSheetInnerSurfaceClassName,
	mobileSheetSurfaceClassName,
	mobileWorkspaceHeaderActionRowClassName,
	mobileWorkspaceTabHitAreaClassName,
	mobileWorkspaceTabVisualClassName,
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
	onOpenGeometryEditor?: (workspaceId?: string) => Promise<boolean>
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
	/** Beacon control/view props (Phase 12, D-12) — a beacon create/adjust/view renders in the edit tab. */
	beaconControlMode?: 'none' | 'create' | 'adjust'
	adjustingBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
	viewBeacon?: import('@/lib/nostr/live-beacon').LiveBeacon | null
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
	placedSightingGeometry?: import('geojson').Geometry | null
	onDrawSightingArea?: () => void
	onSaveSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onCloseSightingEditor?: () => void
	onEditSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
	onDeleteSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
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
	{ id: 'beacons', label: 'Live beacons', icon: Radio },
	{ id: 'stories', label: 'Stories', icon: BookOpen },
	{ id: 'datasets', label: 'Datasets', icon: Database },
	{ id: 'map-stack', label: 'Stack', icon: Layers },
	{ id: 'contexts', label: 'Contexts', icon: Globe },
	{ id: 'field-sessions', label: 'Field sessions', icon: RadioTower },
	{ id: 'private-groups', label: 'Private groups', icon: UsersRound },
	{ id: 'context-editor', label: 'Ctx Editor', icon: FilePenLine },
	{ id: 'edit', label: 'Editor', icon: Pencil },
	{ id: 'chat', label: 'AI chat', icon: MessageCircle },
	{ id: 'profile', label: 'My entities', icon: User },
	{ id: 'posts', label: 'Local posts', icon: MessageSquare },
	{ id: 'delivery', label: 'Sync & delivery', icon: CloudUpload },
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
 * The three detents (redesign §5a "one sheet, three detents"): peek (retracted —
 * ONLY the grab handle shows, the map owns the screen), half (properties on
 * select), full (the outliner, full height). Half/full are viewport fractions;
 * peek is a FIXED handle height so the switcher/filter/list are clipped away when
 * retracted. All heights are resolved to px so the drag math is uniform.
 */
export const MOBILE_DOCK_PX = 52
export const MOBILE_SHEET_PEEK_PX = 48
const MOBILE_WORKSPACE_TABPANEL_ID = 'mobile-workspace-tabpanel'

function configuredMobileDockHeightPx(): number {
	if (typeof window === 'undefined') return MOBILE_DOCK_PX
	const configured = Number.parseFloat(
		window.getComputedStyle(document.documentElement).getPropertyValue('--mobile-dock-height'),
	)
	return Number.isFinite(configured) && configured >= 0 ? configured : MOBILE_DOCK_PX
}
const SNAP_ORDER: MobilePanelSnap[] = ['peek', 'half', 'full']
/** Peek = the 48px sheet-chrome row: handle plus sheet-wide controls. */
const viewportHeightPx = () => (typeof window !== 'undefined' ? window.innerHeight : 812)
export const mobilePanelHeightPx = (
	snap: MobilePanelSnap,
	viewportHeight = viewportHeightPx(),
): number => {
	if (snap === 'peek') return MOBILE_SHEET_PEEK_PX
	if (snap === 'half') return Math.min(viewportHeight * 0.55, viewportHeight - MOBILE_DOCK_PX - 80)
	// Keep an honest map/attribution band visible even at the largest detent.
	return Math.max(
		MOBILE_SHEET_PEEK_PX,
		Math.min(viewportHeight * 0.75, viewportHeight - MOBILE_DOCK_PX - 56),
	)
}

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
		onSaveContext,
		onCloseContextEditor,
		storyEditorMode,
		editingStory,
		onSaveStory,
		onCloseStoryEditor,
		onEditStory,
		onStoryUpdated,
		onDeleteStory,
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
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
		onDrawSightingArea,
		onSaveSighting,
		onCloseSightingEditor,
		onEditSighting,
		onDeleteSighting,
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
	const { contextNaddr, encodeContextNaddr, navigateToContext, clearContextScope, navigateToView } =
		useRouting()

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
	const activateMobileEntitySurface = useEditorStore((state) => state.activateMobileEntitySurface)
	const datasetEditorRetained = useEditorStore(hasRetainedDatasetSurface)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const retainedDatasetSurfaceTitle = useEditorStore((state) =>
		resolveMobileDatasetSurfaceTitle(getRetainedDatasetSurfaceTarget(state)),
	)
	const activeChatId = useChatStore((state) => state.activeChatId)
	const chatSessions = useChatStore((state) => state.chatSessions)
	const runningChatId = useChatStore((state) => state.runningChatId)
	const activeChatRun = useChatStore((state) => state.activeRun)
	const localDraftCount = useEditorStore((state) =>
		countVisibleLocalDraftWorkspaces(
			state.workspaces,
			state.geoEditDrafts,
			state.activeWorkspaceId,
		),
	)
	const [headerActionTarget, setHeaderActionTarget] = useState<HTMLDivElement | null>(null)
	const [panelTranslucent, setPanelTranslucent] = useState(false)
	const [retainedStoryDraftTitle, setRetainedStoryDraftTitle] = useState<string | null>(null)
	const viewportBaselineRef = useRef(viewportHeightPx())
	const workspaceTabRefs = useRef<
		Partial<Record<MobileWorkspacePanelTab, HTMLButtonElement | null>>
	>({})
	const [keyboardViewport, setKeyboardViewport] = useState(() => ({
		keyboardOpen: false,
		fixedBottomInsetPx: 0,
		dockClearancePx: 0,
		usableHeightPx: viewportHeightPx(),
		layoutHeightPx: viewportHeightPx(),
	}))

	const handleClose = () => setMobilePanelOpen(false)
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

	useEffect(() => {
		if (!mobileSidebarOpen && !mobilePanelOpen) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
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

	useEffect(() => {
		if (storyEditorMode === 'none' || editingStory) {
			setRetainedStoryDraftTitle(null)
			return
		}
		const title = readStoryDraft(NEW_STORY_DRAFT_KEY, currentUserPubkey)?.title ?? null
		setRetainedStoryDraftTitle(title?.trim() || null)
	}, [currentUserPubkey, editingStory, storyEditorMode])

	// The sheet height is driven from the store detent, but the grab handle can be
	// DRAGGED to resize live and snaps to the nearest detent on release (a plain
	// pointer handler — vaul's snap-point drag proved unreliable for an always-open
	// non-modal sheet). `dragPx` overrides the resting height while dragging.
	const [dragPx, setDragPx] = useState<number | null>(null)
	const dragRef = useRef<{ startY: number; startPx: number } | null>(null)

	const clampPx = (px: number) =>
		Math.min(mobilePanelHeightPx('full'), Math.max(MOBILE_SHEET_PEEK_PX, px))
	const nearestSnap = (px: number): MobilePanelSnap =>
		SNAP_ORDER.reduce((best, snap) =>
			Math.abs(mobilePanelHeightPx(snap) - px) < Math.abs(mobilePanelHeightPx(best) - px)
				? snap
				: best,
		)
	const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const currentIndex = SNAP_ORDER.indexOf(mobilePanelSnap)
		let nextSnap: MobilePanelSnap | null = null
		if (event.key === 'ArrowUp')
			nextSnap = SNAP_ORDER[Math.min(currentIndex + 1, SNAP_ORDER.length - 1)]
		if (event.key === 'ArrowDown') nextSnap = SNAP_ORDER[Math.max(currentIndex - 1, 0)]
		if (event.key === 'Home') nextSnap = 'peek'
		if (event.key === 'End') nextSnap = 'full'
		if (!nextSnap) return
		event.preventDefault()
		setDragPx(null)
		setMobilePanelSnap(nextSnap)
	}

	const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (typeof window === 'undefined') return
		event.preventDefault()
		// NOTE: no setPointerCapture — the handle already has `touch-action: none`
		// so the whole gesture is owned (content can't scroll-steal it), and capture
		// left stale state that broke the SECOND drag of a sequence (up then down).
		dragRef.current = { startY: event.clientY, startPx: mobilePanelHeightPx(mobilePanelSnap) }
		setDragPx(mobilePanelHeightPx(mobilePanelSnap))

		const move = (moveEvent: PointerEvent) => {
			if (!dragRef.current) return
			const deltaPx = dragRef.current.startY - moveEvent.clientY
			setDragPx(clampPx(dragRef.current.startPx + deltaPx))
		}
		const up = (upEvent: PointerEvent) => {
			const start = dragRef.current
			if (start) {
				const deltaPx = start.startY - upEvent.clientY
				setMobilePanelSnap(nearestSnap(clampPx(start.startPx + deltaPx)))
			}
			dragRef.current = null
			setDragPx(null)
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			window.removeEventListener('pointercancel', up)
		}
		window.addEventListener('pointermove', move, { passive: true })
		window.addEventListener('pointerup', up)
		window.addEventListener('pointercancel', up)
	}

	const panelCount = (id: MobilePanelTab): number | undefined =>
		id === 'drafts'
			? localDraftCount
			: id === 'datasets'
				? geoEvents.length
				: id === 'contexts'
					? mapContextEvents.length
					: undefined
	const activeConversationEditTarget = resolveActiveConversationEditTarget(
		activeChatId,
		activeChatRun,
		chatSessions,
	)
	const selectPanel = async (id: MobilePanelTab) => {
		if (id === 'map-stack' || id === 'edit' || id === 'chat') {
			// The workspace triad is presentation-only: it must not write a route or
			// derive viewMode/stance from one. Chat → Edit has one explicit exception:
			// the user's tap may restore that conversation's exact retained Dataset.
			if (id === 'edit' && mobilePanelTab === 'chat') {
				const restored = await attemptConversationEditTargetRestore(
					activeConversationEditTarget,
					onOpenGeometryEditor,
					() => toast.error(CHAT_EDIT_TARGET_UNAVAILABLE_MESSAGE),
				)
				if (!restored) {
					// A stale or unsupported target must leave the user in Chat. Revealing a
					// different retained surface here would make the conversation ambiguous.
					return
				}
			}
			openMobilePanel(id)
		} else if (id === 'context-editor') {
			openMobilePanel(id)
		} else {
			// Switcher selection is a real navigation: write the URL through the
			// canonical router so history/reload/share agree with the sheet
			// (audit P1 #6). The tab is also set directly — in-app pushState
			// deliberately skips route→tab derivation.
			navigateToView(mobileTabToView(id))
			selectMobileSidebarDestination(id, {
				preserveSuspendedPanel: editorStance === 'author',
			})
		}
		setMobilePanelTab(id)
	}
	const handleWorkspaceTabKeyDown = (
		event: ReactKeyboardEvent<HTMLButtonElement>,
		current: MobileWorkspacePanelTab,
	) => {
		const next = resolveMobileWorkspaceTabKey(current, event.key)
		if (!next) return
		event.preventDefault()
		void selectPanel(next)
		workspaceTabRefs.current[next]?.focus()
	}
	const activeMeta = tabMeta(mobilePanelTab)
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
	const resolvedEntitySurface = resolveMobileEntitySurface(
		mobileEntitySurface,
		entitySurfaceAvailability,
	)
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
	const activeLabel = mobilePanelTab === 'edit' ? editPresentation.label : activeMeta.label
	const ActiveIcon =
		mobilePanelTab === 'edit' && editPresentation.intent === 'inspect' ? Eye : activeMeta.icon
	const activeCount = panelCount(mobilePanelTab)
	const mapWorkTabsVisible =
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
			return `Dataset · ${retainedDatasetSurfaceTitle}${workingEntitySurface === surface ? ' · AI working' : ''}`
		}
		if (surface === 'story') {
			return `Story · ${resolveMobileStorySurfaceTitle(
				editingStory?.article.title,
				retainedStoryDraftTitle,
			)}`
		}
		if (surface === 'context') {
			return `Context · ${editingContext?.context.name?.trim() || 'Untitled context'}`
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
			return `Inspect · ${inspectionSubject.entity.context.name || 'Context'}`
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
	const retainedEntitySurface = resolvedEntitySurface != null
	const selectedEntityWorkspace =
		resolvedEntitySurface === 'dataset'
			? 'geometry'
			: resolvedEntitySurface === 'inspector'
				? inspectionSubject?.kind === 'dataset'
					? 'geometry'
					: inspectionSubject?.kind
				: resolvedEntitySurface
	const workspacePanelTabs: Array<{
		id: MobileWorkspacePanelTab
		label: string
		icon: typeof Layers
		working: boolean
		retained: boolean
	}> = [
		{ id: 'map-stack', label: 'Stack', icon: Layers, working: false, retained: false },
		{
			id: 'edit',
			label: editPresentation.intent === 'author' ? 'Edit' : 'Inspect',
			icon: editPresentation.intent === 'author' ? Pencil : Eye,
			working: selectedEntitySurfaceWorking,
			retained: retainedEntitySurface,
		},
		{ id: 'chat', label: 'Chat', icon: MessageCircle, working: chatWorking, retained: false },
	]
	const resolvedSheetHeight = keyboardViewport.keyboardOpen
		? Math.max(MOBILE_SHEET_PEEK_PX, keyboardViewport.usableHeightPx)
		: (dragPx ?? mobilePanelHeightPx(mobilePanelSnap, keyboardViewport.layoutHeightPx))
	const keyboardDockIsVisible =
		keyboardViewport.keyboardOpen && keyboardViewport.dockClearancePx > 0
	const keyboardSheetHeight = keyboardDockIsVisible
		? `max(0px, calc(${resolvedSheetHeight}px - env(safe-area-inset-bottom)))`
		: `${resolvedSheetHeight}px`
	const keyboardSheetBottom = keyboardDockIsVisible
		? `calc(${keyboardViewport.fixedBottomInsetPx + keyboardViewport.dockClearancePx}px + env(safe-area-inset-bottom))`
		: `${keyboardViewport.fixedBottomInsetPx}px`
	const sheetCloseLabel = mobileSheetCloseLabel(mapWorkTabsVisible, activeLabel)

	// The "+ new" action in the sheet header, per active browse tab.
	const newAction: { label: string; onClick: () => void } | null =
		mobilePanelTab === 'drafts' && onStartNewDataset
			? { label: 'New draft', onClick: onStartNewDataset }
			: mobilePanelTab === 'datasets' && onStartNewDataset
				? { label: 'New dataset', onClick: onStartNewDataset }
				: mobilePanelTab === 'contexts' && onCreateContext
					? { label: 'New context', onClick: onCreateContext }
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
				entityWorkspace={selectedEntityWorkspace ?? undefined}
				entityIntent={editPresentation.intent === 'author' ? 'edit' : 'inspect'}
				inspectionSubjectOverride={
					resolvedEntitySurface === 'inspector' ? inspectionSubject : undefined
				}
				currentUserPubkey={currentUserPubkey}
				onLoadDataset={onLoadDataset}
				onStartNewDataset={onStartNewDataset}
				onSwitchWorkspace={onSwitchWorkspace}
				onOpenGeometryEditor={onOpenGeometryEditor ? () => void onOpenGeometryEditor() : undefined}
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
				contextEditorMode={contextEditorMode}
				editingContext={editingContext}
				onSaveContext={onSaveContext}
				onCloseContextEditor={onCloseContextEditor}
				storyEditorMode={storyEditorMode}
				editingStory={editingStory}
				onSaveStory={onSaveStory}
				onCloseStoryEditor={onCloseStoryEditor}
				onEditStory={onEditStory}
				onStoryUpdated={onStoryUpdated}
				onDeleteStory={onDeleteStory}
				beaconControlMode={beaconControlMode}
				adjustingBeacon={adjustingBeacon}
				viewBeacon={viewBeacon}
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
				onDrawSightingArea={onDrawSightingArea}
				onSaveSighting={onSaveSighting}
				onCloseSightingEditor={onCloseSightingEditor}
				onEditSighting={onEditSighting}
				onDeleteSighting={onDeleteSighting}
				mapContextEvents={mapContextEvents}
				onZoomToFeature={onZoomToFeature}
				featureCollectionForUpload={featureCollectionForUpload}
				onBlossomUploadComplete={onBlossomUploadComplete}
				focusCommentId={focusCommentId}
			/>
		</MobilePanelHeaderActionProvider>
	)

	// Mobile has two deliberately different surfaces: horizontal navigation and
	// vertical map-bound inspection. They share the tab body below, but never open
	// at the same time.
	return (
		<>
			{mobileSidebarOpen || mobilePanelOpen
				? createPortal(
						<>
							{mobileSidebarOpen ? (
								<button
									type="button"
									aria-label="Close navigation"
									className="fixed inset-0 z-40 bg-black/35 md:hidden"
									onClick={closeNavigationSurface}
								/>
							) : null}
							<div
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
												...(keyboardViewport.keyboardOpen ? { bottom: keyboardSheetBottom } : {}),
											}
										: undefined
								}
							>
								{/* Sheet-level chrome: the handle owns resizing; eye and close own the
								    entire sheet and therefore stay out of the active tab's header. */}
								{mobilePanelOpen ? (
									<div
										data-testid="mobile-sheet-controls"
										className={cn(
											'grid h-12 w-full shrink-0 grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center border-b border-border',
											mobileSheetChromeClassName(panelTranslucent),
										)}
									>
										<span aria-hidden="true" />
										{keyboardViewport.keyboardOpen ? (
											<div aria-hidden="true" className="flex h-12 items-center justify-center">
												<span className="h-1.5 w-12 rounded-full bg-accent" />
											</div>
										) : (
											<div
												role="slider"
												aria-label="Resize panel"
												aria-orientation="vertical"
												aria-valuemin={MOBILE_SHEET_PEEK_PX}
												aria-valuemax={Math.round(mobilePanelHeightPx('full'))}
												aria-valuenow={Math.round(dragPx ?? mobilePanelHeightPx(mobilePanelSnap))}
												tabIndex={0}
												onPointerDown={handleDragStart}
												onKeyDown={handleResizeKeyDown}
												style={{ touchAction: 'none' }}
												className="flex h-12 min-w-11 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
											>
												<span className="h-1.5 w-12 rounded-full bg-accent" />
											</div>
										)}
										<div className="flex h-12 items-center justify-end">
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
										</div>
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
										<div
											className={cn(
												'flex shrink-0 items-center border-b border-border',
												mobileSheetInnerSurfaceClassName(panelTranslucent),
												mapWorkTabsVisible
													? 'relative h-11 justify-center px-1 py-0'
													: mobilePanelTab === 'chat'
														? 'gap-1 px-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))]'
														: 'gap-1 px-3 py-2 pt-[max(0.25rem,env(safe-area-inset-top))]',
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
											{mapWorkTabsVisible ? (
												<div
													role="tablist"
													aria-label="Map workspace panels"
													className={cn(
														'flex w-fit max-w-full items-center justify-center rounded-md border border-border p-0',
														panelTranslucent ? 'bg-card/10' : 'bg-muted/45',
													)}
												>
													{workspacePanelTabs.map(
														({ id, label, icon: Icon, working, retained }) => {
															const active = mobilePanelTab === id
															return (
																<button
																	key={id}
																	type="button"
																	role="tab"
																	aria-selected={active}
																	aria-controls={MOBILE_WORKSPACE_TABPANEL_ID}
																	aria-label={`${label}${working ? ', working' : ''}${retained ? ', retained' : ''}`}
																	id={`mobile-workspace-tab-${id}`}
																	data-testid={`mobile-workspace-tab-${id}`}
																	tabIndex={active ? 0 : -1}
																	ref={(node) => {
																		workspaceTabRefs.current[id] = node
																	}}
																	onClick={() => void selectPanel(id)}
																	onKeyDown={(event) => handleWorkspaceTabKeyDown(event, id)}
																	className={mobileWorkspaceTabHitAreaClassName()}
																>
																	<span
																		className={mobileWorkspaceTabVisualClassName(
																			active,
																			panelTranslucent,
																		)}
																	>
																		<Icon className="h-3.5 w-3.5 shrink-0" />
																		<span className="truncate">{label}</span>
																		{working ? (
																			<LoaderCircle
																				aria-hidden="true"
																				className="h-3 w-3 shrink-0 animate-spin text-primary"
																			/>
																		) : retained ? (
																			<span
																				aria-hidden="true"
																				className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-edit)]"
																			/>
																		) : null}
																	</span>
																</button>
															)
														},
													)}
												</div>
											) : (
												<>
													<ActiveIcon className="h-4 w-4 text-primary" />
													<h2 className="text-sm font-semibold text-foreground">{activeLabel}</h2>
												</>
											)}
											{activeCount != null ? (
												<span className="font-mono text-[9px] text-muted-foreground">
													{activeCount}
												</span>
											) : null}
											{!mapWorkTabsVisible ? (
												<div className="ml-auto flex items-center gap-1">
													<div ref={setHeaderActionTarget} className="flex min-w-0 items-center" />
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
											) : null}
										</div>
										{mapWorkTabsVisible ? (
											<div
												ref={setHeaderActionTarget}
												data-testid="mobile-workspace-header-actions"
												className={mobileWorkspaceHeaderActionRowClassName(panelTranslucent)}
											/>
										) : null}
										{mobilePanelOpen && mobilePanelTab === 'edit' ? (
											<div
												data-testid="mobile-entity-surface-picker"
												className={cn(
													'flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-2 py-1',
													mobileSheetInnerSurfaceClassName(panelTranslucent),
												)}
											>
												<ActiveIcon
													aria-hidden="true"
													className="h-4 w-4 shrink-0 text-[var(--accent-edit)]"
												/>
												{entitySurfaceOptions.length > 1 && resolvedEntitySurface ? (
													<NativeSelect
														value={resolvedEntitySurface}
														onChange={(event) => {
															activateMobileEntitySurface(
																event.target.value as MobileEntitySurface,
																entitySurfaceAvailability,
															)
														}}
														aria-label="Edit or inspect target"
														className="min-w-0 flex-1 [&>select]:h-11 [&>select]:min-h-11"
													>
														{entitySurfaceOptions.map((option) => (
															<NativeSelectOption key={option.surface} value={option.surface}>
																{option.label}
															</NativeSelectOption>
														))}
													</NativeSelect>
												) : (
													<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
														{entitySurfaceOptions[0]?.label ?? 'No editing or inspection target'}
													</span>
												)}
												{selectedEntitySurfaceWorking ? (
													<span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
														<LoaderCircle
															aria-hidden="true"
															className="h-3 w-3 animate-spin text-primary"
														/>
														AI
													</span>
												) : null}
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
															placeholder={activeContextScopeLabel ?? 'Browse all contexts'}
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
															aria-label="Clear context browse scope"
														>
															<X className="h-3.5 w-3.5" />
														</Button>
													) : null}
												</div>
											</div>
										) : null}
										<EmbeddedListPanelContext.Provider value={true}>
											{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role and label are paired by the same map-workspace condition. */}
											<div
												id={mapWorkTabsVisible ? MOBILE_WORKSPACE_TABPANEL_ID : undefined}
												role={mapWorkTabsVisible ? 'tabpanel' : undefined}
												aria-labelledby={
													mapWorkTabsVisible ? `mobile-workspace-tab-${mobilePanelTab}` : undefined
												}
												data-testid={mobilePanelOpen ? 'mobile-sheet-body' : undefined}
												className={cn(
													'flex-1',
													panelTranslucent && mobilePanelOpen && 'bg-transparent',
													mobilePanelTab === 'chat'
														? 'min-h-0 overflow-hidden'
														: 'overflow-y-auto px-3 pb-4 pt-2',
												)}
											>
												{mobilePanelTab === 'drafts' ? (
													<div className="-mx-3 -mb-4 -mt-2 h-full min-h-[18rem]">
														<LocalDraftsPanel
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
														onSaveContext={onSaveContext}
														onCloseContextEditor={onCloseContextEditor}
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
												{mobilePanelTab === 'edit' ? editorPanel : null}

												{mobilePanelTab === 'chat' ? (
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
															onOpenAuthoringTarget={onOpenDraftEditor}
															onOpenSettings={() => void selectPanel('settings')}
														/>
													</div>
												) : null}

												{mobilePanelTab === 'profile' ? (
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

												{mobilePanelTab === 'delivery' ? <PublishOutboxPanel /> : null}

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
		</>
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
	onLoadDataset: (event: GeoDataset) => void
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
