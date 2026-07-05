import { Drawer } from 'vaul'
import type { FeatureCollection } from 'geojson'
import {
	Database,
	FilePenLine,
	Globe,
	HelpCircle,
	Layers,
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
import { MapStackPanel } from '@/components/MapStackPanel'
import { UserProfilePanel } from '@/components/UserProfilePanel'
import { ShoutboxPanel } from '@/features/social/shoutbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
import type { EditorFeature } from '../core'
import type { BlossomUploadResult } from '@/lib/blossom/blossomUpload'
import { useEditorStore, type MapStackEntry, type MobilePanelSnap } from '../store'
import { MapSettingsPanel } from './MapSettingsPanel'
import { ChatPanel } from '@/features/chat'
import { Nip60Wallet } from '@/features/wallet/components/Nip60Wallet'
import { useRouting } from '../hooks/useRouting'

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

export interface MobilePanelProps {
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
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset) => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onSetMapStackEntryVisible: (entry: MapStackEntry, visible: boolean) => void
	onSetMapStackEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
	onRemoveMapStackEntry: (entry: MapStackEntry) => void
	onOpenDraftEditor?: () => void
	onZoomToDraft?: () => void
	onClearMapStack: () => void
	onDeleteDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onOpenGeometryEditor?: () => void
	onInspectDataset?: (event: GeoDataset) => void
	onExitFocus?: () => void
	onInspectContext?: (context: MapContext) => void
	onCreateContext?: () => void
	onEditContext?: (context: MapContext) => void
	onOpenDebug?: (event: GeoDataset | MapContext) => void
	onExitViewMode?: () => void
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
	isMentionVisible?: (address: string, featureId: string | undefined) => boolean
	contextEditorMode?: 'none' | 'create' | 'edit'
	editingContext?: MapContext | null
	onSaveContext?: (context: MapContext) => void
	onCloseContextEditor?: () => void
	/** Story view props (Phase 10, D-03) — a deep-linked Story renders in the edit tab. */
	onEditStory?: (story: import('@/lib/nostr/article').Article) => void
	onStoryUpdated?: (story: import('@/lib/nostr/article').Article) => void
	onDeleteStory?: (story: import('@/lib/nostr/article').Article) => void
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
}

const TAB_CONFIG: { id: MobilePanelTab; label: string; icon: typeof Database }[] = [
	{ id: 'datasets', label: 'Datasets', icon: Database },
	{ id: 'map-stack', label: 'Map', icon: Layers },
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

/**
 * The three detents (redesign §5a "one sheet, three detents"): peek (browse, map
 * owns the screen), half (properties on select), full (the outliner, full
 * height). Heights are viewport fractions; the sheet content is sized to the
 * tallest detent and vaul's snap points are fractions of THAT content height.
 */
export const DETENT_VH: Record<MobilePanelSnap, number> = { peek: 15, half: 55, full: 92 }
const SNAP_ORDER: MobilePanelSnap[] = ['peek', 'half', 'full']
const SHEET_MAX_VH = DETENT_VH.full
/** vaul snapPoints — each detent as a fraction of the sheet's max height. */
const MOBILE_SNAP_POINTS = SNAP_ORDER.map((snap) => DETENT_VH[snap] / SHEET_MAX_VH)

const snapToPoint = (snap: MobilePanelSnap): number => DETENT_VH[snap] / SHEET_MAX_VH
const pointToSnap = (point: number | string | null): MobilePanelSnap => {
	const index = MOBILE_SNAP_POINTS.findIndex((value) => value === point)
	return SNAP_ORDER[index] ?? 'peek'
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
		onEditStory,
		onStoryUpdated,
		onDeleteStory,
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
		const context = result.entity as MapContext
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

	const handleClose = () => setMobilePanelOpen(false)

	const handleOpenChange = (open: boolean) => {
		setMobilePanelOpen(open)
	}

	// vaul owns the drag; we mirror the resting detent into the store so the map
	// FAB (and any auto-rise-on-select) can react to peek/half/full.
	const handleSnapPointChange = (point: number | string | null) => {
		setMobilePanelSnap(pointToSnap(point))
	}

	return (
		<Drawer.Root
			open={mobilePanelOpen}
			onOpenChange={handleOpenChange}
			modal={false}
			snapPoints={MOBILE_SNAP_POINTS}
			activeSnapPoint={snapToPoint(mobilePanelSnap)}
			setActiveSnapPoint={handleSnapPointChange}
		>
			<Drawer.Portal>
				<Drawer.Content
					data-testid="mobile-sheet"
					className="fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-lg border-t border-border bg-card outline-none md:hidden"
					style={{ height: `${SHEET_MAX_VH}vh` }}
				>
					{/* Grab handle — vaul drags between the three detents. */}
					<div className="shrink-0 border-b border-border bg-card/95 py-2 backdrop-blur">
						<Drawer.Handle className="mx-auto h-1.5 w-12 rounded-full bg-accent" />
						<Drawer.Title className="sr-only">Panel</Drawer.Title>
						<Drawer.Description className="sr-only">
							Datasets, contexts, map stack, and editor panels.
						</Drawer.Description>
					</div>

					<div className="shrink-0 border-b border-border bg-card px-3 py-1.5">
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

					<div className="shrink-0 overflow-x-auto border-b border-border bg-muted/80 scrollbar-hide">
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
												? 'border-b-2 border-info/40 bg-card text-info'
												: 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
								onAddDatasetToMap={onAddDatasetToMap}
								onRemoveDatasetFromMap={onRemoveDatasetFromMap}
								onDeleteDataset={onDeleteDataset}
								getDatasetKey={getDatasetKey}
								getDatasetName={getDatasetName}
								onInspectDataset={onInspectDataset}
								onInspectContext={onInspectContext}
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
							<div className="-mx-1 -mb-2 h-full min-h-[18rem]">
								<MapStackPanel
									geoEvents={geoEvents}
									mapContextEvents={mapContextEvents}
									getDatasetKey={getDatasetKey}
									getDatasetName={getDatasetName}
									onAddDatasetToMap={onAddDatasetToMap}
									onInspectDataset={onInspectDataset ?? (() => {})}
									onZoomToDataset={onZoomToDataset}
									onLoadDataset={onLoadDataset}
									onInspectContext={onInspectContext ?? (() => {})}
									onSetEntryVisible={onSetMapStackEntryVisible}
									onSetEntryIsolated={onSetMapStackEntryIsolated}
									onRemoveEntry={onRemoveMapStackEntry}
									onOpenDraftEditor={onOpenDraftEditor}
									onZoomToDraft={onZoomToDraft}
									onClear={onClearMapStack}
									onClose={handleClose}
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
								onZoomToDataset={onZoomToDataset}
								onAddDatasetToMap={onAddDatasetToMap}
								onRemoveDatasetFromMap={onRemoveDatasetFromMap}
								onDeleteDataset={onDeleteDataset}
								getDatasetKey={getDatasetKey}
								getDatasetName={getDatasetName}
								onInspectDataset={onInspectDataset}
								onInspectContext={onInspectContext}
								onOpenDebug={onOpenDebug}
								onStartNewDataset={onStartNewDataset}
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
								isMentionVisible={isMentionVisible}
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
								isMentionVisible={isMentionVisible}
								onToggleProposalOverlay={onToggleProposalOverlay}
								onProposalAccepted={onProposalAccepted}
								visibleProposalIds={visibleProposalIds}
								contextEditorMode={contextEditorMode}
								editingContext={editingContext}
								onSaveContext={onSaveContext}
								onCloseContextEditor={onCloseContextEditor}
								onEditStory={onEditStory}
								onStoryUpdated={onStoryUpdated}
								onDeleteStory={onDeleteStory}
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
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
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
			<div className="flex h-32 flex-col items-center justify-center text-sm text-muted-foreground">
				<User className="mb-2 h-8 w-8 text-muted-foreground" />
				<p>Sign in to view your profile</p>
			</div>
		)
	}

	return <UserProfilePanel pubkey={pubkey} {...rest} />
}
