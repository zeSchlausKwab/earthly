import {
	Database,
	FolderOpen,
	Globe,
	HelpCircle,
	MessageCircle,
	Newspaper,
	PanelTop,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Settings2,
	User,
	Wallet,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { NDKGeoEditProposalEvent } from '../lib/ndk/NDKGeoEditProposalEvent'
import type { NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
import { MapSettingsPanel } from '../features/geo-editor/components/MapSettingsPanel'
import { Nip60Wallet } from '../features/wallet/components/Nip60Wallet'
import { ChatPanel } from '../features/chat'
import { useEditorStore } from '../features/geo-editor/store'
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'
import { EntitySearchPopover, type EntitySearchResult } from './entity-search'
import { WorkspaceDraftNavigator } from './WorkspaceDraftNavigator'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>
type EntityWorkspace = 'geometry' | 'collection' | 'context'
type WorkViewMode = 'datasets' | 'collections' | 'contexts' | 'chat' | 'user'
type MetaViewMode = 'posts' | 'wallet' | 'settings' | 'help'

const WORK_VIEW_MODES: WorkViewMode[] = ['datasets', 'collections', 'contexts', 'chat', 'user']
const META_VIEW_MODES: MetaViewMode[] = ['posts', 'wallet', 'settings', 'help']

const entityNavItems: {
	entity: EntityWorkspace
	title: string
	icon: typeof Database
}[] = [
	{ entity: 'geometry', title: 'Geometry', icon: Pencil },
	{ entity: 'collection', title: 'Collection', icon: FolderOpen },
	{ entity: 'context', title: 'Context', icon: Globe },
]

const workNavItems: {
	mode: WorkViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'collections', title: 'Collections', icon: FolderOpen },
	{ mode: 'contexts', title: 'Contexts', icon: Globe },
	{ mode: 'chat', title: 'AI Chat', icon: MessageCircle },
	{ mode: 'user', title: 'My Entities', icon: User },
]

/** Navigation items for utility/meta modes (footer icon list) */
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

function isWorkMode(mode: SidebarContentMode): mode is WorkViewMode {
	return (WORK_VIEW_MODES as SidebarContentMode[]).includes(mode)
}

function isMetaMode(mode: SidebarContentMode): mode is MetaViewMode {
	return (META_VIEW_MODES as SidebarContentMode[]).includes(mode)
}

interface AppSidebarProps {
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	mapContextEvents: NDKMapContextEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onOpenGeometryEditor?: () => void
	onZoomToCollection: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectDataset: (event: NDKGeoEvent) => void
	onInspectCollection: (collection: NDKGeoCollectionEvent, datasets: NDKGeoEvent[]) => void
	onInspectContext: (context: NDKMapContextEvent) => void
	onOpenDebug: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void
	onCreateCollection: () => void
	onCreateContext: () => void
	onEditCollection: (collection: NDKGeoCollectionEvent) => void
	onEditContext: (context: NDKMapContextEvent) => void
	isFocused: boolean
	onExitFocus: () => void
	multiSelectModifier?: string
	// Editor panel props
	onCommentGeometryVisibility?: (commentId: string, geojson: FeatureCollection | null) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	collectionEditorMode?: 'none' | 'create' | 'edit'
	editingCollection?: NDKGeoCollectionEvent | null
	onSaveCollection?: (collection: NDKGeoCollectionEvent) => void
	onCloseCollectionEditor?: () => void
	contextEditorMode?: 'none' | 'create' | 'edit'
	editingContext?: NDKMapContextEvent | null
	onSaveContext?: (context: NDKMapContextEvent) => void
	onCloseContextEditor?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
	// Blossom upload props
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: { sha256: string; url: string; size: number }) => void
	/** NDK instance for authenticated uploads */
	ndk?: import('@nostr-dev-kit/ndk').default | null
	/** User pubkey from route (for user profile pages) */
	userPubkey?: string
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (proposal: NDKGeoEditProposalEvent, visible: boolean) => void
	/** Callback when a proposal is accepted */
	onProposalAccepted?: () => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
}

export function AppSidebar({
	geoEvents,
	collectionEvents,
	mapContextEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
	isPublishing,
	deletingKey,
	onClearEditing,
	onLoadDataset,
	onStartNewDataset,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onAddDraftToWorkspace,
	onToggleVisibility,
	onToggleAllVisibility,
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onOpenGeometryEditor,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onInspectContext,
	onOpenDebug,
	onCreateCollection,
	onCreateContext,
	onEditCollection,
	onEditContext,
	isFocused,
	onExitFocus,
	multiSelectModifier = 'Shift',
	// Editor panel props
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	collectionEditorMode = 'none',
	editingCollection,
	onSaveCollection,
	onCloseCollectionEditor,
	contextEditorMode = 'none',
	editingContext,
	onSaveContext,
	onCloseContextEditor,
	onZoomToFeature,
	onExitViewMode,
	// Blossom upload props
	featureCollectionForUpload,
	onBlossomUploadComplete,
	ndk,
	// User profile props
	userPubkey,
	// Filter sync
	onFilteredDatasetKeysChange,
	onToggleProposalOverlay,
	onProposalAccepted,
	visibleProposalIds,
}: AppSidebarProps) {
	const { setOpen, sidebarExpanded, setSidebarExpanded } = useSidebar()
	const viewMode = useEditorStore((state) => state.sidebarViewMode)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewCollection = useEditorStore((state) => state.viewCollection)
	const viewContext = useEditorStore((state) => state.viewContext)
	const setEditorViewMode = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewCollectionState = useEditorStore((state) => state.setViewCollection)
	const setViewCollectionEventsState = useEditorStore((state) => state.setViewCollectionEvents)
	const setViewContextState = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasetsState = useEditorStore((state) => state.setViewContextDatasets)
	const setViewContextCollectionsState = useEditorStore((state) => state.setViewContextCollections)
	const { navigateToView, navigateToContext, clearContextScope, contextNaddr, encodeContextNaddr } =
		useRouting()
	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')
	const [activeEntity, setActiveEntity] = useState<EntityWorkspace>('geometry')
	const [activeWorkMode, setActiveWorkMode] = useState<WorkViewMode>('datasets')
	const [showEntityAsFullPanel, setShowEntityAsFullPanel] = useState(viewMode === 'edit')
	const [entityIntent, setEntityIntent] = useState<Record<EntityWorkspace, 'inspect' | 'edit'>>({
		geometry: 'edit',
		collection: 'edit',
		context: 'edit',
	})

	const activeContextScope = useMemo(() => {
		if (!contextNaddr) return null
		return (
			mapContextEvents.find((context) => {
				const contextRouteNaddr = encodeContextNaddr(context)
				return contextRouteNaddr === contextNaddr
			}) ?? null
		)
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

		if (collectionEditorMode !== 'none' || viewCollection) {
			setActiveEntity('collection')
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
	}, [
		collectionEditorMode,
		contextEditorMode,
		splitWithEditor,
		viewCollection,
		viewContext,
		viewDataset,
	])

	useEffect(() => {
		if (collectionEditorMode !== 'none') {
			setEntityIntent((prev) => ({ ...prev, collection: 'edit' }))
		}
		if (contextEditorMode !== 'none') {
			setEntityIntent((prev) => ({ ...prev, context: 'edit' }))
		}
		if (viewDataset) {
			setEntityIntent((prev) => ({ ...prev, geometry: 'inspect' }))
		}
		if (viewCollection) {
			setEntityIntent((prev) => ({ ...prev, collection: 'inspect' }))
		}
		if (viewContext) {
			setEntityIntent((prev) => ({ ...prev, context: 'inspect' }))
		}
	}, [collectionEditorMode, contextEditorMode, viewCollection, viewContext, viewDataset])

	const leaveMetaOverrideIfNeeded = () => {
		if (metaModeActive) {
			navigateToView(activeWorkMode)
		}
	}

	const openGeometryWorkspace = () => {
		leaveMetaOverrideIfNeeded()
		setActiveEntity('geometry')
		setEntityIntent((prev) => ({ ...prev, geometry: 'edit' }))
		setShowEntityAsFullPanel(true)
		onOpenGeometryEditor?.()
	}

	const openCollectionWorkspace = () => {
		leaveMetaOverrideIfNeeded()
		setActiveEntity('collection')
		setEntityIntent((prev) => ({ ...prev, collection: 'edit' }))
		setShowEntityAsFullPanel(true)
		if (editingCollection) {
			onEditCollection(editingCollection)
			return
		}
		if (viewCollection) {
			onEditCollection(viewCollection)
			return
		}
		onCreateCollection()
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
		setActiveEntity(entity)
		setEntityIntent((prev) => ({ ...prev, [entity]: 'inspect' }))
		setShowEntityAsFullPanel(true)
		setEditorViewMode('view')
		setViewDatasetState(null)
		setViewCollectionState(null)
		setViewCollectionEventsState([])
		setViewContextState(null)
		setViewContextDatasetsState([])
		setViewContextCollectionsState([])
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

	const handleInspectCollection = (collection: NDKGeoCollectionEvent, datasets: NDKGeoEvent[]) => {
		onInspectCollection(collection, datasets)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('collection')
		setEntityIntent((prev) => ({ ...prev, collection: 'inspect' }))
		setShowEntityAsFullPanel(true)
	}

	const handleInspectContext = (context: NDKMapContextEvent) => {
		onInspectContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setEntityIntent((prev) => ({ ...prev, context: 'inspect' }))
		setShowEntityAsFullPanel(true)
	}

	const handleCreateCollection = () => {
		onCreateCollection()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('collection')
		setShowEntityAsFullPanel(true)
	}

	const handleCreateContext = () => {
		onCreateContext()
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setShowEntityAsFullPanel(true)
	}

	const handleEditCollection = (collection: NDKGeoCollectionEvent) => {
		onEditCollection(collection)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('collection')
		setEntityIntent((prev) => ({ ...prev, collection: 'edit' }))
		setShowEntityAsFullPanel(true)
	}

	const handleEditContext = (context: NDKMapContextEvent) => {
		onEditContext(context)
		leaveMetaOverrideIfNeeded()
		setActiveEntity('context')
		setEntityIntent((prev) => ({ ...prev, context: 'edit' }))
		setShowEntityAsFullPanel(true)
	}

	const handleSaveCollection = (collection: NDKGeoCollectionEvent) => {
		onSaveCollection?.(collection)
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('collections')
		navigateToView('collections')
	}

	const handleCloseCollectionEditor = () => {
		onCloseCollectionEditor?.()
		setShowEntityAsFullPanel(false)
		setActiveWorkMode('collections')
		navigateToView('collections')
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
		if (!entityToggleEnabled) return
		if (intent === currentEntityIntent) return
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

		if (activeEntity === 'collection') {
			if (intent === 'edit') {
				const target = editingCollection ?? viewCollection
				if (target) {
					handleEditCollection(target)
				} else {
					openCollectionWorkspace()
				}
			} else {
				const target = viewCollection ?? editingCollection
				if (target) {
					handleInspectCollection(target, [])
				} else {
					openEmptyInspectWorkspace('collection')
				}
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

	/** Common props for GeoDatasetsPanelContent */
	const datasetsPanelProps = {
		geoEvents,
		collectionEvents,
		mapContextEvents,
		activeDataset,
		currentUserPubkey,
		datasetVisibility,
		collectionVisibility,
		isPublishing,
		deletingKey,
		onClearEditing,
		onLoadDataset: handleLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToDataset,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onZoomToCollection,
		onInspectDataset: handleInspectDataset,
		onInspectCollection: handleInspectCollection,
		onInspectContext: handleInspectContext,
		onOpenDebug,
		onCreateCollection: handleCreateCollection,
		onCreateContext: handleCreateContext,
		onEditCollection: handleEditCollection,
		onEditContext: handleEditContext,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
	}

	/** Common props for UserProfilePanel */
	const userProfilePanelProps = {
		geoEvents,
		collectionEvents,
		mapContextEvents,
		currentUserPubkey,
		datasetVisibility,
		collectionVisibility,
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
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToCollection,
		onInspectCollection: handleInspectCollection,
		onInspectContext: handleInspectContext,
		onEditCollection: handleEditCollection,
		onEditContext: handleEditContext,
		onOpenDebug,
	}

	/** Common props for GeoEditorInfoPanelContent */
	const editorPanelProps = {
		currentUserPubkey,
		onLoadDataset: handleLoadDataset,
		onStartNewDataset,
		onSwitchWorkspace,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onZoomToCollection,
		deletingKey,
		onExitViewMode,
		onClose: () => {},
		getDatasetKey,
		getDatasetName,
		onInspectCollection: handleInspectCollection,
		onCommentGeometryVisibility,
		onZoomToBounds,
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
		onEditCollection: handleEditCollection,
		collectionEditorMode,
		editingCollection,
		onSaveCollection: handleSaveCollection,
		onCloseCollectionEditor: handleCloseCollectionEditor,
		contextEditorMode,
		editingContext,
		onSaveContext: handleSaveContext,
		onCloseContextEditor: handleCloseContextEditor,
		mapContextEvents,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
	}

	const renderWorkContent = (mode: WorkViewMode) => {
		switch (mode) {
			case 'datasets':
				return <GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />
			case 'collections':
				return <GeoDatasetsPanelContent mode="collections" {...datasetsPanelProps} />
			case 'contexts':
				return <GeoDatasetsPanelContent mode="contexts" {...datasetsPanelProps} />
			case 'chat':
				return (
					<ChatPanel
						geoEvents={geoEvents}
						collectionEvents={collectionEvents}
						mapContextEvents={mapContextEvents}
						availableFeatures={availableFeatures}
						getDatasetName={getDatasetName}
						onStartNewDataset={onStartNewDataset}
						onSwitchWorkspace={onSwitchWorkspace}
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
			default:
				return null
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
			default:
				return null
		}
	}

	const renderEntityContent = () => <GeoEditorInfoPanelContent {...editorPanelProps} />

	/** Render full content area according to split + workspace rules */
	const renderContent = () => {
		if (splitWithEditor && !metaModeActive) {
			return (
				<ResizablePanelGroup direction="vertical" className="h-full">
					<ResizablePanel id={`${activeEntity}-editor`} defaultSize={52} minSize={20}>
						<div className="h-full overflow-y-auto">{renderEntityContent()}</div>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel id={`${activeWorkMode}-panel`} defaultSize={48} minSize={20}>
						<div className="h-full overflow-y-auto">{renderWorkContent(activeWorkMode)}</div>
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
			{/* Icon sidebar (first nested sidebar) */}
			<Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
								<a href="/">
									<div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
										<Globe className="size-4" />
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
													openGeometryWorkspace()
												} else if (item.entity === 'collection') {
													openCollectionWorkspace()
												} else {
													openContextWorkspace()
												}
												setOpen(true)
											}}
											isActive={
												activeEntity === item.entity && (splitWithEditor || showEntityAsFullPanel)
											}
											className="px-2.5 md:px-2 border border-sidebar-border/70 bg-sidebar-accent/30 text-sidebar-foreground hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
										>
											<item.icon />
											<span>{item.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}

								<SidebarMenuItem key="editor-split-toggle">
									<SidebarMenuButton
										tooltip={{
											children: 'Toggle entity/work split layout.',
											hidden: false,
										}}
										onClick={() => setSplitWithEditor((prev) => !prev)}
										isActive={splitWithEditor}
										className="px-2.5 md:px-2 border border-dashed border-sidebar-border text-sidebar-foreground/80 hover:bg-sidebar-accent data-[active=true]:border-sidebar-primary data-[active=true]:bg-sidebar-primary/10 data-[active=true]:text-sidebar-primary"
									>
										<PanelTop />
										<span>{splitWithEditor ? 'Split On' : 'Split Off'}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								{workNavItems.map((item) => (
									<SidebarMenuItem key={item.mode}>
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
											className="px-2.5 md:px-2"
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
							<SidebarMenuItem key={item.mode}>
								<SidebarMenuButton
									tooltip={{ children: item.title, hidden: false }}
									onClick={() => {
										handleSelectMetaMode(item.mode)
										setOpen(true)
									}}
									isActive={isMetaMode(contentMode) && contentMode === item.mode}
									className="px-2.5 md:px-2"
								>
									<item.icon />
									<span>{item.title}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarFooter>
			</Sidebar>

			{/* Content sidebar (second nested sidebar) */}
			<Sidebar collapsible="none" className="hidden flex-1 md:flex">
				<SidebarHeader className="gap-3.5 border-b p-4">
					<div className="flex w-full items-center gap-2">
						<div className="shrink-0">
							<div
								className={`inline-flex items-center rounded-md border border-border bg-background p-0.5 ${
									entityToggleEnabled ? '' : 'opacity-45'
								}`}
							>
								<button
									type="button"
									disabled={!entityToggleEnabled}
									className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wide rounded ${
										currentEntityIntent === 'inspect'
											? 'bg-muted text-foreground'
											: 'text-muted-foreground'
									}`}
									onClick={() => handleEntityIntentChange('inspect')}
								>
									Inspect
								</button>
								<button
									type="button"
									disabled={!entityToggleEnabled}
									className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wide rounded ${
										currentEntityIntent === 'edit'
											? 'bg-muted text-foreground'
											: 'text-muted-foreground'
									}`}
									onClick={() => handleEntityIntentChange('edit')}
								>
									{geometryEditLabel}
								</button>
							</div>
						</div>

						<div className="min-w-0 flex-1">
							<EntitySearchPopover
								sources={{ contexts: mapContextEvents }}
								entityTypes={['context']}
								onSelect={handleContextScopeSelect}
								placeholder={
									activeContextScopeLabel ? activeContextScopeLabel : 'No context filter'
								}
								searchMode="local"
								compact
							/>
						</div>

						<div className="flex items-center gap-1 shrink-0">
							{contextNaddr && (
								<button
									type="button"
									onClick={clearContextScope}
									title="Leave context scope"
									aria-label="Leave context scope"
									className="inline-flex items-center justify-center h-7 w-7 rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
							<button
								type="button"
								onClick={() => setSidebarExpanded(!sidebarExpanded)}
								title={sidebarExpanded ? 'Shrink sidebar' : 'Expand sidebar'}
								className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
							>
								{sidebarExpanded ? (
									<PanelLeftClose className="h-4 w-4" />
								) : (
									<PanelLeftOpen className="h-4 w-4" />
								)}
							</button>
							<LoginSessionButtons />
						</div>
					</div>
					<WorkspaceDraftNavigator
						onStartNewDataset={onStartNewDataset}
						onSwitchWorkspace={onSwitchWorkspace}
						onDeleteWorkspace={onDeleteWorkspace}
						onAddDraftToWorkspace={onAddDraftToWorkspace}
					/>
				</SidebarHeader>

				<SidebarContent className="p-2">
					<SidebarGroup className="p-0 h-full">
						<SidebarGroupContent className="h-full">{renderContent()}</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</Sidebar>
	)
}
