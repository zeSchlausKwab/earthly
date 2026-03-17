import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FeatureCollection } from 'geojson'
import {
	Database,
	FilePenLine,
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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
	geoEvents: NDKGeoEvent[]
	mapContextEvents: NDKMapContextEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	userPubkey?: string | null
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	isFocused: boolean
	multiSelectModifier?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onDeleteContext?: (context: NDKMapContextEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onOpenGeometryEditor?: () => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onExitFocus?: () => void
	onInspectContext?: (context: NDKMapContextEvent) => void
	onCreateContext?: () => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKMapContextEvent) => void
	onExitViewMode?: () => void
	onCommentGeometryVisibility?: (
		comment: import('@/lib/ndk/NDKGeoCommentEvent').NDKGeoCommentEvent,
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
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	ndk?: import('@nostr-dev-kit/ndk').default | null
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
	onToggleProposalOverlay?: (
		proposal: import('@/lib/ndk/NDKGeoEditProposalEvent').NDKGeoEditProposalEvent,
		visible: boolean,
	) => void
	onProposalAccepted?: (dataset: NDKGeoEvent) => void
	visibleProposalIds?: Set<string>
	focusCommentId?: string
}

const TAB_CONFIG: { id: MobilePanelTab; label: string; icon: typeof Database }[] = [
	{ id: 'datasets', label: 'Datasets', icon: Database },
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
		onSwitchWorkspace,
		onDeleteWorkspace,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
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
		focusCommentId,
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
				className="flex flex-col gap-0 p-0 md:hidden"
				style={{ height: `${panelHeightVh}vh` }}
				onPointerDownOutside={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
			>
				<div className="shrink-0 border-b border-gray-200 bg-white/95 px-0 py-1 backdrop-blur">
					<Button
						type="button"
						variant="ghost"
						onPointerDown={handleDragStart}
						onClick={handleGrabberClick}
						className="flex w-full touch-none items-center justify-center py-1"
						aria-label="Resize panel"
					>
						<span className="h-1.5 w-12 rounded-full bg-gray-300" />
					</Button>
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
						{contextNaddr ? (
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								onClick={clearContextScope}
								aria-label="Leave context scope"
							>
								<X className="h-3.5 w-3.5" />
							</Button>
						) : null}
					</div>
				</div>

				<div className="shrink-0 overflow-x-auto border-b border-gray-200 bg-gray-50/80 scrollbar-hide">
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
										'flex items-center justify-center gap-1 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors',
										isActive
											? 'border-b-2 border-blue-600 bg-white text-blue-600'
											: 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
									)}
								>
									<Icon className="h-3.5 w-3.5" />
									<span>{tab.label}</span>
								</button>
							)
						})}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
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
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={onInspectDataset}
							onInspectContext={onInspectContext}
							onOpenDebug={onOpenDebug}
							onCreateContext={onCreateContext}
							onEditContext={onEditContext}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
						/>
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
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={onInspectDataset}
							onInspectContext={onInspectContext}
							onOpenDebug={onOpenDebug}
							onCreateContext={onCreateContext}
							onEditContext={onEditContext}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
						/>
					) : null}

					{mobilePanelTab === 'context-editor' ? (
						<GeoEditorInfoPanelContent
							currentUserPubkey={currentUserPubkey}
							onLoadDataset={onLoadDataset}
							onStartNewDataset={onStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onToggleVisibility={onToggleVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							onDeleteContext={onDeleteContext}
							deletingKey={deletingKey}
							onExitViewMode={onExitViewMode}
							onClose={handleClose}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onCommentGeometryVisibility={onCommentGeometryVisibility}
							onZoomToBounds={onZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
							contextEditorMode={contextEditorMode !== 'none' ? contextEditorMode : 'create'}
							editingContext={editingContext}
							onSaveContext={onSaveContext}
							onCloseContextEditor={onCloseContextEditor}
							mapContextEvents={mapContextEvents}
							onZoomToFeature={onZoomToFeature}
							featureCollectionForUpload={featureCollectionForUpload}
							onBlossomUploadComplete={onBlossomUploadComplete}
							ndk={ndk}
							focusCommentId={focusCommentId}
						/>
					) : null}

					{mobilePanelTab === 'edit' ? (
						<GeoEditorInfoPanelContent
							currentUserPubkey={currentUserPubkey}
							onLoadDataset={onLoadDataset}
							onStartNewDataset={onStartNewDataset}
							onSwitchWorkspace={onSwitchWorkspace}
							onOpenGeometryEditor={onOpenGeometryEditor}
							onToggleVisibility={onToggleVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							onDeleteContext={onDeleteContext}
							deletingKey={deletingKey}
							onExitViewMode={onExitViewMode}
							onClose={handleClose}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onCommentGeometryVisibility={onCommentGeometryVisibility}
							onZoomToBounds={onZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
							contextEditorMode={contextEditorMode}
							editingContext={editingContext}
							onSaveContext={onSaveContext}
							onCloseContextEditor={onCloseContextEditor}
							mapContextEvents={mapContextEvents}
							onZoomToFeature={onZoomToFeature}
							featureCollectionForUpload={featureCollectionForUpload}
							onBlossomUploadComplete={onBlossomUploadComplete}
							ndk={ndk}
							focusCommentId={focusCommentId}
						/>
					) : null}

					{mobilePanelTab === 'chat' ? (
						<div className="-mx-3 -mb-4 -mt-2 h-full">
							<ChatPanel
								geoEvents={geoEvents}
								mapContextEvents={mapContextEvents}
								availableFeatures={availableFeatures}
								getDatasetName={getDatasetName}
								onStartNewDataset={onStartNewDataset}
								onSwitchWorkspace={onSwitchWorkspace}
								onOpenSettings={() => setMobilePanelTab('settings')}
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
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={onInspectDataset}
							onInspectContext={onInspectContext}
							onEditContext={onEditContext}
							onOpenDebug={onOpenDebug}
						/>
					) : null}

					{mobilePanelTab === 'posts' ? (
						<div className="-mx-3 -mb-4 -mt-2 h-full">
							<ShoutboxPanel />
						</div>
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
			</SheetContent>
		</Sheet>
	)
}

interface MobileProfileContentProps {
	pubkey?: string | null
	geoEvents: NDKGeoEvent[]
	mapContextEvents: NDKMapContextEvent[]
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
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
	onInspectContext?: (context: NDKMapContextEvent) => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKMapContextEvent) => void
}

function MobileProfileContent(props: MobileProfileContentProps) {
	const { pubkey, ...rest } = props

	if (!pubkey) {
		return (
			<div className="flex h-32 flex-col items-center justify-center text-sm text-gray-500">
				<User className="mb-2 h-8 w-8 text-gray-400" />
				<p>Sign in to view your profile</p>
			</div>
		)
	}

	return <UserProfilePanel pubkey={pubkey} {...rest} />
}
