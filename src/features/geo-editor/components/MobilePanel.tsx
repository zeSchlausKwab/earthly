import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FeatureCollection } from 'geojson'
import {
	Database,
	FilePenLine,
	FolderOpen,
	Globe,
	HelpCircle,
	MessageCircle,
	MessageSquare,
	Pencil,
	Settings2,
	User,
	Wallet,
	X,
} from 'lucide-react'
import { GeoDatasetsPanelContent } from '@/components/GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from '@/components/GeoEditorInfoPanel'
import { HelpPanel } from '@/components/HelpPanel'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { ShoutboxPanel } from '@/features/social/shoutbox'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
import type { EditorFeature } from '../core'
import type { BlossomUploadResult } from '@/lib/blossom/blossomUpload'
import { useEditorStore } from '../store'
import { MapSettingsPanel } from './MapSettingsPanel'
import { ChatPanel } from '@/features/chat'
import { Nip60Wallet } from '@/features/wallet/components/Nip60Wallet'
import { useRouting } from '../hooks/useRouting'

export type MobilePanelTab =
	| 'datasets'
	| 'collections'
	| 'contexts'
	| 'context-editor'
	| 'edit'
	| 'chat'
	| 'profile'
	| 'posts'
	| 'wallet'
	| 'settings'
	| 'help'

export interface MobilePanelProps {
	// Data
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	mapContextEvents: NDKMapContextEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	userPubkey?: string | null
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	isFocused: boolean
	multiSelectModifier?: string

	// Dataset callbacks
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onOpenGeometryEditor?: () => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onExitFocus?: () => void

	// Collection callbacks
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onCreateCollection?: () => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onInspectContext?: (context: NDKMapContextEvent) => void
	onCreateContext?: () => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void

	// Editor/Info panel callbacks
	onExitViewMode?: () => void
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
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	ndk?: import('@nostr-dev-kit/ndk').default | null
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (
		proposal: import('@/lib/ndk/NDKGeoEditProposalEvent').NDKGeoEditProposalEvent,
		visible: boolean,
	) => void
	/** Callback when a proposal is accepted */
	onProposalAccepted?: () => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
}

const TAB_CONFIG: { id: MobilePanelTab; label: string; icon: typeof Database }[] = [
	{ id: 'datasets', label: 'Datasets', icon: Database },
	{ id: 'collections', label: 'Collections', icon: FolderOpen },
	{ id: 'contexts', label: 'Contexts', icon: Globe },
	{ id: 'context-editor', label: 'Ctx Editor', icon: FilePenLine },
	{ id: 'edit', label: 'Editor', icon: Pencil },
	{ id: 'chat', label: 'AI Chat', icon: MessageCircle },
	{ id: 'profile', label: 'Profile', icon: User },
	{ id: 'posts', label: 'Posts', icon: MessageSquare },
	{ id: 'wallet', label: 'Wallet', icon: Wallet },
	{ id: 'settings', label: 'Settings', icon: Settings2 },
	{ id: 'help', label: 'Help', icon: HelpCircle },
]

const PANEL_HEIGHTS_VH = {
	peek: 45,
	expanded: 82,
} as const

const PANEL_SNAP_THRESHOLD_VH = (PANEL_HEIGHTS_VH.peek + PANEL_HEIGHTS_VH.expanded) / 2

function clampPanelHeightVh(heightVh: number): number {
	return Math.min(PANEL_HEIGHTS_VH.expanded, Math.max(PANEL_HEIGHTS_VH.peek, heightVh))
}

export function MobilePanel(props: MobilePanelProps) {
	const {
		geoEvents,
		collectionEvents,
		mapContextEvents,
		activeDataset,
		currentUserPubkey,
		userPubkey,
		datasetVisibility,
		collectionVisibility,
		isPublishing,
		deletingKey,
		isFocused,
		multiSelectModifier = 'Shift',
		onClearEditing,
		onLoadDataset,
		onStartNewDataset,
		onSwitchWorkspace,
		onDeleteWorkspace,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onOpenGeometryEditor,
		onInspectDataset,
		onExitFocus,
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToCollection,
		onInspectCollection,
		onCreateCollection,
		onEditCollection,
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
		collectionEditorMode,
		editingCollection,
		onSaveCollection,
		onCloseCollectionEditor,
		contextEditorMode,
		editingContext,
		onSaveContext,
		onCloseContextEditor,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
		onFilteredDatasetKeysChange,
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
	} = props
	const { contextNaddr, encodeContextNaddr, navigateToContext, clearContextScope } = useRouting()

	const activeContextScope = mapContextEvents.find((context) => {
		if (!contextNaddr) return false
		return encodeContextNaddr(context) === contextNaddr
	})
	const activeContextScopeLabel =
		activeContextScope?.context.name || activeContextScope?.contextId || activeContextScope?.id

	const handleContextScopeSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const context = result.entity as NDKMapContextEvent
		const naddr = encodeContextNaddr(context)
		if (!naddr) return
		navigateToContext(naddr)
	}

	// Store state for panel
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelTab = useEditorStore((state) => state.setMobilePanelTab)
	const setMobilePanelSnap = useEditorStore((state) => state.setMobilePanelSnap)

	const [dragHeightVh, setDragHeightVh] = useState<number | null>(null)
	const dragHeightRef = useRef<number | null>(null)
	const dragStartYRef = useRef<number | null>(null)
	const dragStartHeightRef = useRef<number>(PANEL_HEIGHTS_VH.peek)
	const draggedRef = useRef(false)

	const handleClose = () => setMobilePanelOpen(false)
	const baseHeightVh =
		mobilePanelSnap === 'expanded' ? PANEL_HEIGHTS_VH.expanded : PANEL_HEIGHTS_VH.peek
	const panelHeightVh = dragHeightVh ?? baseHeightVh

	const handleOpenChange = (open: boolean) => {
		setMobilePanelOpen(open)
		if (!open) {
			setDragHeightVh(null)
			dragHeightRef.current = null
		}
	}

	const handleDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault()
		dragStartYRef.current = event.clientY
		dragStartHeightRef.current = panelHeightVh
		draggedRef.current = false
		setDragHeightVh(panelHeightVh)
		dragHeightRef.current = panelHeightVh

		const handlePointerMove = (moveEvent: PointerEvent) => {
			if (dragStartYRef.current == null || typeof window === 'undefined') return
			const deltaY = dragStartYRef.current - moveEvent.clientY
			if (Math.abs(deltaY) > 4) {
				draggedRef.current = true
			}
			const deltaVh = (deltaY / window.innerHeight) * 100
			const nextHeight = clampPanelHeightVh(dragStartHeightRef.current + deltaVh)
			dragHeightRef.current = nextHeight
			setDragHeightVh(nextHeight)
		}

		const handlePointerUp = () => {
			const finalHeight = dragHeightRef.current ?? baseHeightVh
			const nextSnap = finalHeight >= PANEL_SNAP_THRESHOLD_VH ? 'expanded' : 'peek'
			setMobilePanelSnap(nextSnap)
			setDragHeightVh(null)
			dragHeightRef.current = null
			dragStartYRef.current = null
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', handlePointerUp)
			window.removeEventListener('pointercancel', handlePointerUp)
		}

		window.addEventListener('pointermove', handlePointerMove, { passive: true })
		window.addEventListener('pointerup', handlePointerUp)
		window.addEventListener('pointercancel', handlePointerUp)
	}

	const handleGrabberClick = () => {
		if (draggedRef.current) {
			draggedRef.current = false
			return
		}
		setMobilePanelSnap(mobilePanelSnap === 'expanded' ? 'peek' : 'expanded')
	}

	return (
		<Sheet open={mobilePanelOpen} onOpenChange={handleOpenChange} modal={false}>
			<SheetContent
				side="bottom"
				className="p-0 md:hidden flex flex-col gap-0"
				style={{ height: `${panelHeightVh}vh` }}
				onPointerDownOutside={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<div className="shrink-0 border-b border-gray-200 bg-white/95 backdrop-blur px-0 py-1">
					<button
						type="button"
						onPointerDown={handleDragStart}
						onClick={handleGrabberClick}
						className="w-full flex items-center justify-center touch-none py-1"
						aria-label="Resize panel"
					>
						<span className="h-1.5 w-12 rounded-full bg-gray-300" />
					</button>
				</div>

				<div className="shrink-0 border-b border-gray-200 bg-white px-3 py-1.5">
					<div className="flex items-center gap-1.5">
						<div className="w-full">
							<EntitySearchPopover
								sources={{ contexts: mapContextEvents }}
								entityTypes={['context']}
								onSelect={handleContextScopeSelect}
								placeholder={activeContextScopeLabel ?? 'No context filter'}
								searchMode="local"
								compact
							/>
						</div>
						{contextNaddr && (
							<button
								type="button"
								onClick={clearContextScope}
								aria-label="Leave context scope"
								className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-gray-600"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</div>
				</div>

				{/* Scrollable Tab Bar */}
				<div className="border-b border-gray-200 bg-gray-50/80 shrink-0 overflow-x-auto scrollbar-hide">
					<div className="flex min-w-max">
						{TAB_CONFIG.map((tab) => {
							const Icon = tab.icon
							const isActive = mobilePanelTab === tab.id
							return (
								<button
									key={tab.id}
									type="button"
									onClick={() => {
										if (tab.id === 'edit') {
											onOpenGeometryEditor?.()
										}
										setMobilePanelTab(tab.id)
									}}
									className={cn(
										'flex items-center justify-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap',
										isActive
											? 'text-blue-600 border-b-2 border-blue-600 bg-white'
											: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
									)}
								>
									<Icon className="h-3.5 w-3.5" />
									<span>{tab.label}</span>
								</button>
							)
						})}
					</div>
				</div>

				{/* Tab Content */}
				<div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
					{mobilePanelTab === 'datasets' && (
						<GeoDatasetsPanelContent
							mode="datasets"
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							mapContextEvents={mapContextEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onClearEditing={onClearEditing}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onZoomToCollection={onZoomToCollection}
							onInspectDataset={onInspectDataset}
							onInspectCollection={onInspectCollection}
							onInspectContext={onInspectContext}
							onOpenDebug={onOpenDebug}
							onCreateCollection={onCreateCollection}
							onCreateContext={onCreateContext}
							onEditCollection={onEditCollection}
							onEditContext={onEditContext}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
						/>
					)}

					{mobilePanelTab === 'collections' && (
						<GeoDatasetsPanelContent
							mode="collections"
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							mapContextEvents={mapContextEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onClearEditing={onClearEditing}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onZoomToCollection={onZoomToCollection}
							onInspectDataset={onInspectDataset}
							onInspectCollection={onInspectCollection}
							onInspectContext={onInspectContext}
							onOpenDebug={onOpenDebug}
							onCreateCollection={onCreateCollection}
							onCreateContext={onCreateContext}
							onEditCollection={onEditCollection}
							onEditContext={onEditContext}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
						/>
					)}

					{mobilePanelTab === 'contexts' && (
						<GeoDatasetsPanelContent
							mode="contexts"
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							mapContextEvents={mapContextEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onClearEditing={onClearEditing}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onZoomToCollection={onZoomToCollection}
							onInspectDataset={onInspectDataset}
							onInspectCollection={onInspectCollection}
							onInspectContext={onInspectContext}
							onOpenDebug={onOpenDebug}
							onCreateCollection={onCreateCollection}
							onCreateContext={onCreateContext}
							onEditCollection={onEditCollection}
							onEditContext={onEditContext}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
						/>
					)}

					{mobilePanelTab === 'context-editor' && (
						<GeoEditorInfoPanelContent
							currentUserPubkey={currentUserPubkey}
							onLoadDataset={onLoadDataset}
							onStartNewDataset={onStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onToggleVisibility={onToggleVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							onZoomToCollection={onZoomToCollection}
							deletingKey={deletingKey}
							onExitViewMode={onExitViewMode}
							onClose={handleClose}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectCollection={onInspectCollection}
							onCommentGeometryVisibility={onCommentGeometryVisibility}
							onZoomToBounds={onZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
							onEditCollection={onEditCollection}
							collectionEditorMode={collectionEditorMode}
							editingCollection={editingCollection}
							onSaveCollection={onSaveCollection}
							onCloseCollectionEditor={onCloseCollectionEditor}
							contextEditorMode={contextEditorMode !== 'none' ? contextEditorMode : 'create'}
							editingContext={editingContext}
							onSaveContext={onSaveContext}
							onCloseContextEditor={onCloseContextEditor}
							mapContextEvents={mapContextEvents}
							onZoomToFeature={onZoomToFeature}
							featureCollectionForUpload={featureCollectionForUpload}
							onBlossomUploadComplete={onBlossomUploadComplete}
							ndk={ndk}
						/>
					)}

					{mobilePanelTab === 'edit' && (
						<GeoEditorInfoPanelContent
							currentUserPubkey={currentUserPubkey}
							onLoadDataset={onLoadDataset}
							onStartNewDataset={onStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onToggleVisibility={onToggleVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							onZoomToCollection={onZoomToCollection}
							deletingKey={deletingKey}
							onExitViewMode={onExitViewMode}
							onClose={handleClose}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectCollection={onInspectCollection}
							onCommentGeometryVisibility={onCommentGeometryVisibility}
							onZoomToBounds={onZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
							onEditCollection={onEditCollection}
							collectionEditorMode={collectionEditorMode}
							editingCollection={editingCollection}
							onSaveCollection={onSaveCollection}
							onCloseCollectionEditor={onCloseCollectionEditor}
							contextEditorMode={contextEditorMode}
							editingContext={editingContext}
							onSaveContext={onSaveContext}
							onCloseContextEditor={onCloseContextEditor}
							mapContextEvents={mapContextEvents}
							onZoomToFeature={onZoomToFeature}
							featureCollectionForUpload={featureCollectionForUpload}
							onBlossomUploadComplete={onBlossomUploadComplete}
							ndk={ndk}
						/>
					)}

					{mobilePanelTab === 'chat' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<ChatPanel
								geoEvents={geoEvents}
								collectionEvents={collectionEvents}
								mapContextEvents={mapContextEvents}
								availableFeatures={availableFeatures}
								getDatasetName={getDatasetName}
								onStartNewDataset={onStartNewDataset}
								onSwitchWorkspace={onSwitchWorkspace}
							/>
						</div>
					)}

					{mobilePanelTab === 'profile' && (
						<MobileProfileContent
							pubkey={userPubkey ?? currentUserPubkey}
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							mapContextEvents={mapContextEvents}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onLoadDataset={onLoadDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onDeleteWorkspace={onDeleteWorkspace}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={onInspectDataset}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToCollection={onZoomToCollection}
							onInspectCollection={onInspectCollection}
							onInspectContext={onInspectContext}
							onEditCollection={onEditCollection}
							onEditContext={onEditContext}
							onOpenDebug={onOpenDebug}
						/>
					)}

					{mobilePanelTab === 'posts' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<ShoutboxPanel />
						</div>
					)}

					{mobilePanelTab === 'wallet' && (
						<div className="h-full -mx-3 -mt-2 -mb-4 p-4">
							<Nip60Wallet />
						</div>
					)}

					{mobilePanelTab === 'settings' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<MapSettingsPanel />
						</div>
					)}

					{mobilePanelTab === 'help' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<HelpPanel multiSelectModifier={multiSelectModifier} />
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}

interface MobileProfileContentProps {
	pubkey?: string | null
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	mapContextEvents: NDKMapContextEvent[]
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: NDKGeoEvent) => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onInspectDataset?: (event: NDKGeoEvent) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectContext?: (context: NDKMapContextEvent) => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void
}

function MobileProfileContent(props: MobileProfileContentProps) {
	const { pubkey, ...rest } = props

	if (!pubkey) {
		return (
			<div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm">
				<User className="h-8 w-8 mb-2 text-gray-400" />
				<p>Sign in to view your profile</p>
			</div>
		)
	}

	return <UserProfilePanel pubkey={pubkey} {...rest} />
}
