import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { FeatureCollection } from 'geojson'
import {
	Check,
	ChevronDown,
	Database,
	FilePenLine,
	Globe,
	HelpCircle,
	Layers,
	MessageCircle,
	MessageSquare,
	Pencil,
	Plus,
	Settings2,
	User,
	Wallet,
	X,
} from 'lucide-react'
import { EmbeddedListPanelContext } from '@/components/entity-list'
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

// biome-ignore lint/style/noNonNullAssertion: TAB_CONFIG is non-empty, so [0] is a safe fallback.
const tabMeta = (id: MobilePanelTab) => TAB_CONFIG.find((tab) => tab.id === id) ?? TAB_CONFIG[0]!

/**
 * §14a "One sheet, every panel": the sheet header is a grouped panel switcher
 * (same grouping as the desktop rail). Tapping the header pill opens this list;
 * picking a panel swaps the sheet's body. Transient editors (context-editor)
 * are reached via a "+ new" action, not the switcher.
 */
const SWITCHER_GROUPS: { label: string; tabs: MobilePanelTab[] }[] = [
	{ label: 'Workspace', tabs: ['datasets', 'contexts'] },
	{ label: 'On the map', tabs: ['map-stack'] },
	{ label: 'More', tabs: ['chat', 'posts', 'profile', 'wallet', 'settings', 'help'] },
]

/**
 * The three detents (redesign §5a "one sheet, three detents"): peek (retracted —
 * ONLY the grab handle shows, the map owns the screen), half (properties on
 * select), full (the outliner, full height). Half/full are viewport fractions;
 * peek is a FIXED handle height so the switcher/filter/list are clipped away when
 * retracted. All heights are resolved to px so the drag math is uniform.
 */
export const DETENT_VH: Record<MobilePanelSnap, number> = { peek: 14, half: 55, full: 92 }
const SNAP_ORDER: MobilePanelSnap[] = ['peek', 'half', 'full']
/** Peek = just the grab handle (px). Retracted shows only the handle + toolbar
 *  (the grab-handle row is ~34px: py-3 + the 6px bar + its bottom border). */
const PEEK_PX = 34
const viewportHeightPx = () => (typeof window !== 'undefined' ? window.innerHeight : 812)
const detentPx = (snap: MobilePanelSnap): number =>
	snap === 'peek' ? PEEK_PX : (DETENT_VH[snap] / 100) * viewportHeightPx()

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

	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelTab = useEditorStore((state) => state.setMobilePanelTab)
	const setMobilePanelSnap = useEditorStore((state) => state.setMobilePanelSnap)
	// Editor-in-Map-Stack (same as desktop): while a geometry draft is authored,
	// the editor forms portal into the draft entry's slot in the Map Stack instead
	// of living in a separate panel.
	const editorStance = useEditorStore((state) => state.stance)
	const draftEditorSlot = useEditorStore((state) => state.draftEditorSlot)

	const handleClose = () => setMobilePanelOpen(false)

	// The sheet height is driven from the store detent, but the grab handle can be
	// DRAGGED to resize live and snaps to the nearest detent on release (a plain
	// pointer handler — vaul's snap-point drag proved unreliable for an always-open
	// non-modal sheet). `dragPx` overrides the resting height while dragging.
	const [dragPx, setDragPx] = useState<number | null>(null)
	const dragRef = useRef<{ startY: number; startPx: number } | null>(null)

	const clampPx = (px: number) => Math.min(detentPx('full'), Math.max(PEEK_PX, px))
	const nearestSnap = (px: number): MobilePanelSnap =>
		SNAP_ORDER.reduce((best, snap) =>
			Math.abs(detentPx(snap) - px) < Math.abs(detentPx(best) - px) ? snap : best,
		)

	const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (typeof window === 'undefined') return
		event.preventDefault()
		// NOTE: no setPointerCapture — the handle already has `touch-action: none`
		// so the whole gesture is owned (content can't scroll-steal it), and capture
		// left stale state that broke the SECOND drag of a sequence (up then down).
		dragRef.current = { startY: event.clientY, startPx: detentPx(mobilePanelSnap) }
		setDragPx(detentPx(mobilePanelSnap))

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

	// §14a: the header pill opens a grouped panel switcher over the sheet body.
	const [switcherOpen, setSwitcherOpen] = useState(false)
	const panelCount = (id: MobilePanelTab): number | undefined =>
		id === 'datasets' ? geoEvents.length : id === 'contexts' ? mapContextEvents.length : undefined
	const selectPanel = (id: MobilePanelTab) => {
		if (id === 'edit') onOpenGeometryEditor?.()
		setMobilePanelTab(id)
		setSwitcherOpen(false)
	}
	const activeMeta = tabMeta(mobilePanelTab)
	const ActiveIcon = activeMeta.icon
	const activeCount = panelCount(mobilePanelTab)

	// The entity/geometry editor — rendered in the Map Stack draft slot while
	// authoring a draft (editor-in-Map-Stack), otherwise in the 'edit' tab body
	// (e.g. a sighting/story/context inspected from a link).
	const editorPanel = (
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
	)

	// The mobile sheet is always present (peek minimum) — it's the universal panel
	// container (§14a). A plain portal + a draggable grab handle; the height is the
	// live drag height while dragging, otherwise the resting detent.
	return (
		<>
			{editorStance === 'author' && draftEditorSlot
				? createPortal(<div className="min-w-0">{editorPanel}</div>, draftEditorSlot)
				: null}
			{createPortal(
				<div
					data-testid="mobile-sheet"
					className={cn(
						// bottom-[52px] docks the sheet directly above the mobile tool strip
						// (§14a Row 0). Its own height is the live drag / resting detent.
						'fixed inset-x-0 bottom-[52px] z-40 flex flex-col overflow-hidden rounded-t-lg border-t border-border bg-card md:hidden',
						dragPx === null && 'transition-[height] duration-200 ease-out',
					)}
					style={{ height: `${dragPx ?? detentPx(mobilePanelSnap)}px` }}
				>
					{/* Grab handle — drag up/down to resize; snaps to the nearest detent. */}
					<div
						role="slider"
						aria-label="Resize panel"
						aria-valuemin={PEEK_PX}
						aria-valuemax={Math.round(detentPx('full'))}
						aria-valuenow={Math.round(dragPx ?? detentPx(mobilePanelSnap))}
						tabIndex={0}
						onPointerDown={handleDragStart}
						style={{ touchAction: 'none' }}
						className="flex w-full shrink-0 cursor-grab touch-none items-center justify-center border-b border-border bg-card/95 py-3 backdrop-blur active:cursor-grabbing"
					>
						<span className="h-1.5 w-12 rounded-full bg-accent" />
					</div>

					{/* §14a: the sheet header IS the panel switcher — a pill showing the
					    current panel · count · "+ new", tap to open the grouped list. It
					    sits directly under the handle so it stays visible at the lowest
					    (peek) detent. */}
					<div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5">
						<button
							type="button"
							onClick={() => setSwitcherOpen((open) => !open)}
							aria-expanded={switcherOpen}
							className="flex items-center gap-1.5 rounded-[2px] border border-primary/50 bg-primary/10 px-2 py-1"
						>
							<ActiveIcon className="h-3.5 w-3.5 text-primary" />
							<span className="text-[13px] font-semibold text-foreground">{activeMeta.label}</span>
							<ChevronDown
								className={cn(
									'h-3 w-3 text-primary transition-transform',
									switcherOpen && 'rotate-180',
								)}
							/>
						</button>
						{activeCount != null ? (
							<span className="font-mono text-[9px] text-muted-foreground">{activeCount}</span>
						) : null}
						<div className="ml-auto flex items-center gap-1">
							{mobilePanelTab === 'datasets' && onStartNewDataset ? (
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									className="h-6 w-6 rounded-[2px]"
									onClick={onStartNewDataset}
									aria-label="New dataset"
								>
									<Plus className="h-3.5 w-3.5" />
								</Button>
							) : mobilePanelTab === 'contexts' && onCreateContext ? (
								<Button
									type="button"
									size="icon-sm"
									variant="outline"
									className="h-6 w-6 rounded-[2px]"
									onClick={onCreateContext}
									aria-label="New context"
								>
									<Plus className="h-3.5 w-3.5" />
								</Button>
							) : null}
						</div>
					</div>

					{/* Context-scope filter — below the switcher; scrolls away at peek. */}
					{!switcherOpen ? (
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
					) : null}

					{switcherOpen ? (
						<div className="flex-1 overflow-y-auto bg-card px-1.5 py-2">
							{SWITCHER_GROUPS.map((group) => (
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
												onClick={() => selectPanel(id)}
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
												<span className="flex-1 text-[13.5px] text-foreground">{meta.label}</span>
												{count != null ? (
													<span className="font-mono text-[9px] text-muted-foreground">
														{count}
													</span>
												) : null}
												{isActive ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
											</button>
										)
									})}
								</div>
							))}
						</div>
					) : (
						<EmbeddedListPanelContext.Provider value={true}>
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

								{/* The 'edit' tab hosts the editor only for non-draft entity views
						    (sighting/story). A geometry draft renders via the Map Stack
						    portal instead (see the editor-in-Map-Stack portal below). */}
								{mobilePanelTab === 'edit' && editorStance !== 'author' ? editorPanel : null}

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
						</EmbeddedListPanelContext.Provider>
					)}
				</div>,
				document.body,
			)}
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
