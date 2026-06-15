import {
	AlertTriangle,
	Database,
	Globe,
	HelpCircle,
	Newspaper,
	PanelLeftClose,
	PanelLeftOpen,
	ArrowLeft,
	Pencil,
	Search,
	Settings2,
	UserCircle,
	Wallet,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import type { MapContext } from '@/lib/nostr/map-context'
import squareLogoRose from '../assets/square_logo_rose.svg'
import { ShoutboxPanel } from '../features/social/shoutbox'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { UserProfilePanel } from './UserProfilePanel'
import { GeoEditorInfoPanelContent } from './GeoEditorInfoPanel'
import { HelpPanel } from './HelpPanel'
import { LoginSessionButtons } from '../features/auth/LoginSessionButtons'
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
import { useEditorStore } from '../features/geo-editor/store'
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'
import { EntitySearchPopover, type EntitySearchResult } from './entity-search'
import { WorkspaceDraftNavigator } from './WorkspaceDraftNavigator'
import { Button } from './ui/button'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>
type EntityWorkspace = 'geometry' | 'context'
type WorkViewMode = 'datasets' | 'contexts' | 'user'
type MetaViewMode = 'posts' | 'wallet' | 'settings' | 'help'

const WORK_VIEW_MODES: WorkViewMode[] = ['datasets', 'contexts', 'user']
const META_VIEW_MODES: MetaViewMode[] = ['posts', 'wallet', 'settings', 'help']

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
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'contexts', title: 'Contexts', icon: Globe },
	{ mode: 'user', title: 'My Entities', icon: UserCircle },
]

const metaNavItems: {
	mode: MetaViewMode
	title: string
	icon: typeof Settings2
}[] = [
	{ mode: 'posts', title: 'City Posts', icon: Newspaper },
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

interface AppSidebarProps {
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	activeDataset: GeoDataset | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: GeoDataset) => void
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset) => void
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
		comment: import('@/lib/nostr/geo-comment').GeoComment,
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
	contextEditorMode?: 'none' | 'create' | 'edit'
	editingContext?: MapContext | null
	onSaveContext?: (context: MapContext) => void
	onCloseContextEditor?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: { sha256: string; url: string; size: number }) => void
	userPubkey?: string
	focusCommentId?: string
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
	onToggleProposalOverlay?: (proposal: GeoProposal, visible: boolean) => void
	onProposalAccepted?: (dataset: GeoDataset) => void
	visibleProposalIds?: Set<string>
}

export function AppSidebar({
	geoEvents,
	mapContextEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	isPublishing,
	deletingKey,
	onLoadDataset,
	onStartNewDataset,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onAddDraftToWorkspace,
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
	contextEditorMode = 'none',
	editingContext,
	onSaveContext,
	onCloseContextEditor,
	onZoomToFeature,
	onExitViewMode,
	featureCollectionForUpload,
	onBlossomUploadComplete,
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
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContextState = useEditorStore((state) => state.setViewContext)
	const { navigateToView, navigateToContext, clearContextScope, contextNaddr, encodeContextNaddr } =
		useRouting()

	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')
	const [activeEntity, setActiveEntity] = useState<EntityWorkspace>('geometry')
	const [activeWorkMode, setActiveWorkMode] = useState<WorkViewMode>('datasets')
	const [showEntityAsFullPanel, setShowEntityAsFullPanel] = useState(viewMode === 'edit')
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
		const hasInspectSubject =
			Boolean(viewContext) || Boolean(viewDataset) || contextEditorMode !== 'none'
		if (
			!splitWithEditor &&
			!hasInspectSubject &&
			(isWorkMode(contentMode) || isMetaMode(contentMode))
		) {
			setShowEntityAsFullPanel(false)
		}
	}, [contentMode, splitWithEditor, viewContext, viewDataset, contextEditorMode])

	useEffect(() => {
		if (contextEditorMode !== 'none' || viewContext) {
			setActiveEntity('context')
			if (!splitWithEditor) {
				setShowEntityAsFullPanel(true)
			}
			return
		}
		if (viewDataset) {
			setActiveEntity('geometry')
			if (!splitWithEditor) {
				setShowEntityAsFullPanel(true)
			}
		}
	}, [contextEditorMode, splitWithEditor, viewContext, viewDataset])

	const leaveMetaOverrideIfNeeded = () => {
		if (metaModeActive) {
			navigateToView(activeWorkMode)
		}
	}

	const handleSelectWorkMode = (mode: WorkViewMode) => {
		// Round H.6: browsing a catalog is a deliberate "leave the inspect
		// subject" — clear it so the show-panel guard lets the list through.
		// (The active edit draft is separate store state and is untouched, so
		// browse-while-editing still works and the Editor return path stays.)
		setViewContextState(null)
		setViewDatasetState(null)
		setActiveWorkMode(mode)
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const handleSelectMetaMode = (mode: MetaViewMode) => {
		setViewContextState(null)
		setViewDatasetState(null)
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const handleLoadDataset = (event: GeoDataset) => {
		onLoadDataset(event)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setShowEntityAsFullPanel(true)
	}

	const handleInspectDataset = (event: GeoDataset) => {
		onInspectDataset(event)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setShowEntityAsFullPanel(true)
	}

	const handleInspectContext = (context: MapContext) => {
		onInspectContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setShowEntityAsFullPanel(true)
	}

	const handleCreateContext = () => {
		onCreateContext()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setShowEntityAsFullPanel(true)
	}

	const handleEditContext = (context: MapContext) => {
		onEditContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setShowEntityAsFullPanel(true)
	}

	const handleSaveContext = (context: MapContext) => {
		onSaveContext?.(context)
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('contexts')
		navigateToView('contexts')
	}

	const handleCloseContextEditor = () => {
		onCloseContextEditor?.()
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('contexts')
		navigateToView('contexts')
	}

	// Round E.4/F.4: derived, not stored. Geometry mirrors the stance; the
	// context entity mirrors whether the context editor is open. Used by the
	// info panel (empty-state copy) and the rail surface highlighting.
	const currentEntityIntent: 'inspect' | 'edit' =
		activeEntity === 'geometry'
			? editorStance === 'author'
				? 'edit'
				: 'inspect'
			: contextEditorMode !== 'none'
				? 'edit'
				: 'inspect'

	// Round H.4: a single CONTEXTUAL "current work" rail entry, derived from
	// stance. It only exists while you're actually editing (author) or
	// inspecting (focus) — so it never reads as an always-on peer of the
	// browse catalogs, and there's no empty-void state. It's the way back to
	// your editor/inspector panel after you've wandered off to a catalog.
	const currentSurface: 'editor' | 'inspector' | null =
		editorStance === 'author' || contextEditorMode !== 'none'
			? 'editor'
			: editorStance === 'focus' || viewDataset || viewContext
				? 'inspector'
				: null

	const returnToCurrentSurface = () => {
		leaveMetaOverrideIfNeeded()
		setShowEntityAsFullPanel(true)
		setActiveEntity(contextEditorMode !== 'none' || viewContext ? 'context' : 'geometry')
	}

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
		onCreateContext: handleCreateContext,
		onEditContext: handleEditContext,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
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
		onStartNewDataset,
		onOpenGeometryEditor,
		onSwitchWorkspace,
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
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
		contextEditorMode,
		editingContext,
		onSaveContext: handleSaveContext,
		onCloseContextEditor: handleCloseContextEditor,
		mapContextEvents,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		focusCommentId,
		entityWorkspace: activeEntity,
		entityIntent: currentEntityIntent,
	}

	const renderWorkContent = (mode: WorkViewMode) => {
		switch (mode) {
			case 'datasets':
				return <GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />
			case 'contexts':
				return <GeoDatasetsPanelContent mode="contexts" {...datasetsPanelProps} />
			case 'user': {
				const profilePubkey = userPubkey ?? currentUserPubkey
				if (!profilePubkey) {
					return (
						<div className="p-4 text-center text-gray-500">
							<p>Connect to view your entities</p>
						</div>
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
	const renderBackToCatalogBar = () => (
		<button
			type="button"
			onClick={() => handleSelectWorkMode(activeWorkMode)}
			className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
		>
			<ArrowLeft className="h-3.5 w-3.5 shrink-0" />
			<span className="truncate">Back to {activeWorkModeLabel}</span>
		</button>
	)

	const renderEntityContent = () => <GeoEditorInfoPanelContent {...editorPanelProps} />

	const renderContent = () => {
		if (splitWithEditor && !metaModeActive) {
			return (
				<ResizablePanelGroup direction="vertical" className="h-full">
					<ResizablePanel id={`${activeEntity}-editor`} defaultSize={52} minSize={20}>
						<div className="h-full min-w-0 overflow-x-hidden overflow-y-auto">
							{renderEntityContent()}
						</div>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel id={`${activeWorkMode}-panel`} defaultSize={48} minSize={20}>
						<div className="h-full min-w-0 overflow-x-hidden overflow-y-auto">
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
					<div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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
									<div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-sidebar-border/70 bg-white">
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
					{/* Round H.4: contextual "current work" surface — only present
					    while editing/inspecting, separated from the browse catalogs
					    by its own group + divider. This is the return path to the
					    editor/inspector panel after navigating to a catalog. */}
					{currentSurface ? (
						<SidebarGroup className="border-sidebar-border border-b pb-1">
							<SidebarGroupContent className="px-1.5 md:px-0">
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton
											tooltip={{
												children: currentSurface === 'editor' ? 'Editor' : 'Inspector',
												hidden: false,
											}}
											onClick={() => {
												returnToCurrentSurface()
												setOpen(true)
											}}
											isActive={!metaModeActive && (showEntityAsFullPanel || splitWithEditor)}
											className="border border-sidebar-border/70 bg-sidebar-accent/30 px-2.5 text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground md:px-2"
										>
											{currentSurface === 'editor' ? <Pencil /> : <Search />}
											<span>{currentSurface === 'editor' ? 'Editor' : 'Inspector'}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					) : null}

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
			>
				<SidebarHeader className="gap-3.5 border-b p-4">
					{/* Round F.4: the Inspect/Edit segmented toggle that lived here was
					    removed — it duplicated app state (stance / contextEditorMode)
					    and chronically desynced. The rail's Inspector/Editor surface
					    items carry that role now, with derived active state. */}
					<div className="flex w-full items-center gap-2">
						<div className="min-w-0 flex-1">
							<EntitySearchPopover
								sources={{ contexts: mapContextEvents }}
								entityTypes={['context']}
								onSelect={handleContextScopeSelect}
								placeholder={
									activeContextScopeLabel ? activeContextScopeLabel : 'Filter by context…'
								}
								searchMode="local"
								compact
							/>
						</div>

						<div className="flex shrink-0 items-center gap-1">
							{contextNaddr ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={clearContextScope}
									title="Leave context scope"
									aria-label="Leave context scope"
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
					{currentUserPubkey && (
						<WorkspaceDraftNavigator
							onStartNewDataset={onStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onDeleteWorkspace={onDeleteWorkspace}
							onAddDraftToWorkspace={onAddDraftToWorkspace}
						/>
					)}
				</SidebarHeader>

				<SidebarContent className="p-2">
					<SidebarGroup className="h-full p-0">
						<SidebarGroupContent className="h-full">{renderContent()}</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</Sidebar>
	)
}
