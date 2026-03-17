import {
	AlertTriangle,
	Database,
	Globe,
	HelpCircle,
	Layers,
	MessageCircle,
	Newspaper,
	PanelLeftClose,
	PanelLeftOpen,
	PanelTop,
	Pencil,
	Settings2,
	Wallet,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { NDKGeoEditProposalEvent } from '../lib/ndk/NDKGeoEditProposalEvent'
import type { NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
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
import { ChatPanel } from '../features/chat'
import { useEditorStore } from '../features/geo-editor/store'
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'
import { EntitySearchPopover, type EntitySearchResult } from './entity-search'
import { WorkspaceDraftNavigator } from './WorkspaceDraftNavigator'
import { Button } from './ui/button'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>
type EntityWorkspace = 'geometry' | 'context'
type WorkViewMode = 'datasets' | 'contexts' | 'chat' | 'user'
type MetaViewMode = 'posts' | 'wallet' | 'settings' | 'help'

const WORK_VIEW_MODES: WorkViewMode[] = ['datasets', 'contexts', 'chat', 'user']
const META_VIEW_MODES: MetaViewMode[] = ['posts', 'wallet', 'settings', 'help']

const entityNavItems: {
	entity: EntityWorkspace
	title: string
	icon: typeof Database
}[] = [
	{ entity: 'geometry', title: 'Geometry', icon: Pencil },
	{ entity: 'context', title: 'Context', icon: Globe },
]

const workNavItems: {
	mode: WorkViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'contexts', title: 'Contexts', icon: Globe },
	{ mode: 'chat', title: 'AI Chat', icon: MessageCircle },
	{ mode: 'user', title: 'My Entities', icon: Layers },
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
	geoEvents: NDKGeoEvent[]
	mapContextEvents: NDKMapContextEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: NDKGeoEvent) => void
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onDeleteContext?: (context: NDKMapContextEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onOpenGeometryEditor?: () => void
	onClearEntityEditors?: () => void
	onInspectDataset: (event: NDKGeoEvent) => void
	onInspectContext: (context: NDKMapContextEvent) => void
	onOpenDebug: (event: NDKGeoEvent | NDKMapContextEvent) => void
	onCreateContext: () => void
	onEditContext: (context: NDKMapContextEvent) => void
	isFocused: boolean
	onExitFocus: () => void
	multiSelectModifier?: string
	onCommentGeometryVisibility?: (
		comment: import('../lib/ndk/NDKGeoCommentEvent').NDKGeoCommentEvent,
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
	editingContext?: NDKMapContextEvent | null
	onSaveContext?: (context: NDKMapContextEvent) => void
	onCloseContextEditor?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: { sha256: string; url: string; size: number }) => void
	ndk?: import('@nostr-dev-kit/ndk').default | null
	userPubkey?: string
	focusCommentId?: string
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
	onToggleProposalOverlay?: (proposal: NDKGeoEditProposalEvent, visible: boolean) => void
	onProposalAccepted?: (dataset: NDKGeoEvent) => void
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
	onDeleteDataset,
	onDeleteContext,
	getDatasetKey,
	getDatasetName,
	onOpenGeometryEditor,
	onClearEntityEditors,
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
	ndk,
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
	const setEditorViewMode = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContextState = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasetsState = useEditorStore((state) => state.setViewContextDatasets)
	const { navigateToView, navigateToContext, clearContextScope, contextNaddr, encodeContextNaddr } =
		useRouting()

	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')
	const [activeEntity, setActiveEntity] = useState<EntityWorkspace>('geometry')
	const [activeWorkMode, setActiveWorkMode] = useState<WorkViewMode>('datasets')
	const [showEntityAsFullPanel, setShowEntityAsFullPanel] = useState(viewMode === 'edit')
	const [entityIntent, setEntityIntent] = useState<Record<EntityWorkspace, 'inspect' | 'edit'>>({
		geometry: 'inspect',
		context: 'inspect',
	})

	useEffect(() => {
		if (!currentUserPubkey) {
			setEntityIntent({ geometry: 'inspect', context: 'inspect' })
		}
	}, [currentUserPubkey])

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
		const context = result.entity as NDKMapContextEvent
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
		if (!splitWithEditor && (isWorkMode(contentMode) || isMetaMode(contentMode))) {
			setShowEntityAsFullPanel(false)
		}
	}, [contentMode, splitWithEditor])

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

	useEffect(() => {
		if (contextEditorMode !== 'none') {
			setEntityIntent((prev) => ({ ...prev, context: 'edit' }))
		}
		if (viewDataset) {
			setEntityIntent((prev) => ({ ...prev, geometry: 'inspect' }))
		}
		if (viewContext) {
			setEntityIntent((prev) => ({ ...prev, context: 'inspect' }))
		}
	}, [contextEditorMode, viewContext, viewDataset])

	const leaveMetaOverrideIfNeeded = () => {
		if (metaModeActive) {
			navigateToView(activeWorkMode)
		}
	}

	const openGeometryWorkspace = () => {
		leaveMetaOverrideIfNeeded()
		onClearEntityEditors?.()
		setActiveEntity('geometry')
		setEntityIntent((prev) => ({ ...prev, geometry: 'edit' }))
		setShowEntityAsFullPanel(true)
		onOpenGeometryEditor?.()
	}

	const openContextWorkspace = () => {
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setEntityIntent((prev) => ({ ...prev, context: 'edit' }))
		setShowEntityAsFullPanel(true)
		if (editingContext) {
			onEditContext(editingContext)
			return
		}
		if (viewContext) {
			onEditContext(viewContext)
			return
		}
		onCreateContext()
	}

	const handleSelectWorkMode = (mode: WorkViewMode) => {
		setActiveWorkMode(mode)
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const handleSelectMetaMode = (mode: MetaViewMode) => {
		setShowEntityAsFullPanel(false)
		navigateToView(mode)
	}

	const openEmptyInspectWorkspace = (entity: EntityWorkspace) => {
		leaveMetaOverrideIfNeeded()
		if (entity === 'geometry') {
			onClearEntityEditors?.()
		}
		setActiveEntity(entity)
		setEntityIntent((prev) => ({ ...prev, [entity]: 'inspect' }))
		setShowEntityAsFullPanel(true)
		setEditorViewMode('view')
		setViewDatasetState(null)
		setViewContextState(null)
		setViewContextDatasetsState([])
	}

	const handleLoadDataset = (event: NDKGeoEvent) => {
		onLoadDataset(event)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setEntityIntent((prev) => ({ ...prev, geometry: 'edit' }))
		setShowEntityAsFullPanel(true)
	}

	const handleInspectDataset = (event: NDKGeoEvent) => {
		onInspectDataset(event)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setEntityIntent((prev) => ({ ...prev, geometry: 'inspect' }))
		setShowEntityAsFullPanel(true)
	}

	const handleInspectContext = (context: NDKMapContextEvent) => {
		onInspectContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setEntityIntent((prev) => ({ ...prev, context: 'inspect' }))
		setShowEntityAsFullPanel(true)
	}

	const handleCreateContext = () => {
		onCreateContext()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setShowEntityAsFullPanel(true)
	}

	const handleEditContext = (context: NDKMapContextEvent) => {
		onEditContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setEntityIntent((prev) => ({ ...prev, context: 'edit' }))
		setShowEntityAsFullPanel(true)
	}

	const handleSaveContext = (context: NDKMapContextEvent) => {
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

	const currentEntityIntent = entityIntent[activeEntity]
	const entityToggleEnabled = !metaModeActive && (splitWithEditor || showEntityAsFullPanel)
	const geometryEditLabel =
		activeEntity === 'geometry' &&
		viewDataset &&
		currentUserPubkey &&
		viewDataset.pubkey !== currentUserPubkey
			? 'Load copy'
			: 'Edit'

	const handleEntityIntentChange = (intent: 'inspect' | 'edit') => {
		if (!entityToggleEnabled || intent === currentEntityIntent) return
		setEntityIntent((prev) => ({ ...prev, [activeEntity]: intent }))

		if (activeEntity === 'geometry') {
			if (intent === 'edit') {
				if (viewDataset) {
					handleLoadDataset(viewDataset)
				} else {
					openGeometryWorkspace()
				}
			} else if (activeDataset) {
				handleInspectDataset(activeDataset)
			} else {
				openEmptyInspectWorkspace('geometry')
			}
			return
		}

		if (intent === 'edit') {
			const target = editingContext ?? viewContext
			if (target) {
				handleEditContext(target)
			} else {
				openContextWorkspace()
			}
		} else {
			const target = viewContext ?? editingContext
			if (target) {
				handleInspectContext(target)
			} else {
				openEmptyInspectWorkspace('context')
			}
		}
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
		ndk,
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
			case 'chat':
				return (
					<ChatPanel
						geoEvents={geoEvents}
						mapContextEvents={mapContextEvents}
						availableFeatures={availableFeatures}
						getDatasetName={getDatasetName}
						onStartNewDataset={onStartNewDataset}
						onSwitchWorkspace={onSwitchWorkspace}
						onOpenSettings={() => navigateToView('settings')}
					/>
				)
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
			return renderEntityContent()
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
					<SidebarGroup>
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								{entityNavItems.map((item) => (
									<SidebarMenuItem key={item.entity}>
										<SidebarMenuButton
											tooltip={{ children: item.title, hidden: false }}
											onClick={() => {
												if (item.entity === 'geometry') {
													openEmptyInspectWorkspace('geometry')
												} else {
													openContextWorkspace()
												}
												setOpen(true)
											}}
											isActive={
												activeEntity === item.entity && (splitWithEditor || showEntityAsFullPanel)
											}
											className="border border-sidebar-border/70 bg-sidebar-accent/30 px-2.5 text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground md:px-2"
										>
											<item.icon />
											<span>{item.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}

								<SidebarMenuItem key="editor-split-toggle">
									<SidebarMenuButton
										tooltip={{ children: 'Toggle entity/work split layout.', hidden: false }}
										onClick={() => setSplitWithEditor((prev) => !prev)}
										isActive={splitWithEditor}
										className="border border-dashed border-sidebar-border px-2.5 text-sidebar-foreground/80 hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary/10 data-[active=true]:text-sidebar-primary md:px-2"
									>
										<PanelTop />
										<span>{splitWithEditor ? 'Split On' : 'Split Off'}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								{workNavItems.map((item) => (
									<SidebarMenuItem
										key={item.mode}
										data-tour={
											item.mode === 'datasets'
												? 'sidebar-datasets'
												: item.mode === 'contexts'
													? 'sidebar-contexts'
													: item.mode === 'chat'
														? 'sidebar-chat'
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
					<div className="flex w-full items-center gap-2">
						<div className="shrink-0">
							<div
								className={`inline-flex items-center rounded-lg border border-border bg-muted p-0.5 ${
									entityToggleEnabled ? '' : 'pointer-events-none opacity-40'
								}`}
							>
								<Button
									type="button"
									variant="ghost"
									disabled={!entityToggleEnabled}
									className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
										currentEntityIntent === 'inspect'
											? 'bg-background text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'
									}`}
									onClick={() => handleEntityIntentChange('inspect')}
								>
									Inspect
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={!entityToggleEnabled}
									className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
										currentEntityIntent === 'edit'
											? 'bg-background text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'
									}`}
									onClick={() => handleEntityIntentChange('edit')}
								>
									{geometryEditLabel}
								</Button>
							</div>
						</div>

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
