import type { ColumnDef } from '@tanstack/react-table'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo } from 'react'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import {
	DebugActionIcon,
	FavoriteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
	MapStackActionIcon,
	ZoomActionIcon,
} from './entity-action-icons'
import { Button } from './ui/button'
import { UserProfile } from './user-profile'
import { useEditorStore } from '../features/geo-editor/store'
import { GeoSocialActions } from '../features/social/comments/GeoSocialActions'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { cn } from '@/lib/utils'

export interface DatasetRowData {
	event: GeoDataset
	datasetKey: string
	datasetName: string
	isActive: boolean
	isOwned: boolean
	isVisible: boolean
	isInMapStack: boolean
	/** Round G.2: starred in the catalog Favorites tab. Optional — profile view doesn't wire it. */
	isCatalogPinned?: boolean
	primaryLabel: string
}

export interface DatasetColumnsContext {
	onLoadDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onInspectDataset?: (event: GeoDataset) => void
	/** Add to map stack. Idempotent — calling on an already-stacked entity is a no-op. */
	onAddDatasetToMap?: (event: GeoDataset) => void
	/** Round C: remove from map stack. Paired with onAddDatasetToMap to make the Layers button a toggle. */
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	/** Round G.2: toggle catalog favorite (Star). */
	onToggleCatalogPin?: (event: GeoDataset) => void
	/**
	 * P2.2 (report 6.x): favorites are persisted per-pubkey, so they're
	 * meaningless while logged out. When false, the favorite action is shown
	 * disabled with a sign-in hint instead of silently writing guest-scoped
	 * state. Defaults to allowed when omitted (callers that don't know auth).
	 */
	canFavorite?: boolean
	onOpenDebug?: (event: GeoDataset) => void
	isPublishing: boolean
	deletingKey: string | null
	allVisibleState: 'all' | 'none' | 'some'
}

// Shared resting style for entity row-action icons. Muted-but-present at rest
// (so the cluster doesn't read as disabled) with a subtle rounded hover chip so
// each icon clearly behaves like a button. Per-button hover tints
// (emerald/amber/…) are layered on at the call site.
const actionButtonClass =
	'rounded-md px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-info'

/**
 * Round F.1: the load verb moved into the row's overflow menu; this indicator
 * only surfaces blob-resolution progress (ring with percent, or a spinner
 * when the total is unknown). Renders nothing when idle.
 */
const DatasetResolvingIndicator = memo(function DatasetResolvingIndicator({
	datasetKey,
}: {
	datasetKey: string
}) {
	const isResolving = useEditorStore((state) => state.resolvingDatasets.has(datasetKey))
	const progress = useEditorStore((state) => state.resolvingProgress.get(datasetKey))

	if (!isResolving) return null

	const progressPercent =
		progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0

	if (progress && progress.total > 0) {
		const sizeMB = (progress.total / 1024 / 1024).toFixed(1)
		const label = `Loading ${progressPercent}% of ${sizeMB}MB...`
		return (
			<div className="relative flex h-8 w-8 items-center justify-center" title={label}>
				<svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="text-foreground"
					/>
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeDasharray={`${progressPercent * 0.5} 50`}
						className="text-info transition-all duration-150"
					/>
				</svg>
				<span className="absolute text-[8px] font-medium text-info">{progressPercent}</span>
			</div>
		)
	}

	return (
		<div className="flex h-8 w-8 items-center justify-center" title="Loading blob data...">
			<Loader2 className="h-4 w-4 animate-spin text-info" />
		</div>
	)
})

export const createDatasetColumns = (
	context: DatasetColumnsContext,
): ColumnDef<DatasetRowData>[] => [
	{
		accessorKey: 'datasetName',
		header: () => {
			const areAllVisible = context.allVisibleState === 'all'
			const hasVisibleDatasets = context.allVisibleState !== 'none'
			const label = areAllVisible ? 'Hide all datasets' : 'Show all datasets'

			return (
				<div className="flex items-center gap-2">
					<span>Dataset</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn(
							actionButtonClass,
							hasVisibleDatasets
								? 'text-info hover:text-info'
								: 'text-muted-foreground hover:text-info',
						)}
						onClick={() => context.onToggleAllVisibility(!areAllVisible)}
						aria-label={label}
						title={label}
					>
						{hasVisibleDatasets ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
					</Button>
				</div>
			)
		},
		cell: ({ row }) => {
			const { event, datasetName } = row.original

			const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
				const datasetId = event.datasetId ?? event.dTag
				if (!datasetId || !event.pubkey || !event.kind) return

				let naddr: string
				try {
					naddr = nip19.naddrEncode({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: datasetId,
					})
				} catch {
					naddr = `${event.kind}:${event.pubkey}:${datasetId}`
				}

				const item: GeoFeatureItem = {
					id: `dataset:${event.id}`,
					name: datasetName,
					address: naddr,
					datasetName,
					geometryType: 'Dataset',
				}

				e.dataTransfer.setData('application/geo-feature', JSON.stringify(item))
				e.dataTransfer.setData('application/earthly-dataset-key', row.original.datasetKey)
				e.dataTransfer.effectAllowed = 'copy'
			}

			return (
				<div className="min-w-0 whitespace-normal py-1 text-left">
					<button
						type="button"
						className="block w-full cursor-grab text-left text-sm font-semibold leading-snug text-foreground transition-colors hover:text-info active:cursor-grabbing"
						draggable
						onDragStart={handleDragStart}
						onClick={() => {
							// Round C: stack = visibility. Clicking the dataset name shows it on
							// the map (additive append). Zoom-to follows so the user lands on it.
							if (!row.original.isInMapStack) {
								context.onAddDatasetToMap?.(event)
							}
							context.onZoomToDataset(event)
						}}
						aria-label={
							row.original.isInMapStack
								? `Zoom to dataset ${datasetName}`
								: `Show and zoom to dataset ${datasetName}`
						}
						title={row.original.isInMapStack ? 'Zoom to dataset' : 'Show on map and zoom'}
					>
						<span className="line-clamp-2 break-words">{datasetName}</span>
					</button>
					<div className="mt-1 min-w-0">
						<UserProfile
							pubkey={event.pubkey}
							mode="avatar-name"
							size="xs"
							showNip05Badge={false}
							interactive={false}
						/>
					</div>
					<div className="mt-1 flex min-w-0 items-end justify-between gap-3">
						<GeoSocialActions
							target={event}
							onReplyClick={() => context.onInspectDataset?.(event)}
							showCommentButton={Boolean(context.onInspectDataset)}
							showAnnotateButton={false}
							loadCounts={false}
							compact
							className="-ml-2 shrink-0 gap-0"
						/>
						{/* U.2: actions inline (no overflow menu), in the canonical order
						    map-stack → zoom → inspect → load → favorite → debug, using the
						    shared action icons so every entity surface matches. */}
						<div className="flex shrink-0 items-center gap-0.5">
							{context.onAddDatasetToMap ? (
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(
										actionButtonClass,
										row.original.isInMapStack ? 'text-ok hover:text-ok' : 'hover:text-ok',
									)}
									onClick={() => {
										if (row.original.isInMapStack && context.onRemoveDatasetFromMap) {
											context.onRemoveDatasetFromMap(event)
										} else {
											context.onAddDatasetToMap?.(event)
										}
									}}
									aria-label={
										row.original.isInMapStack ? 'Remove from map stack' : 'Add to map stack'
									}
									title={row.original.isInMapStack ? 'Remove from map stack' : 'Add to map stack'}
								>
									<MapStackActionIcon className="h-4 w-4" />
								</Button>
							) : null}
							<Button
								size="icon-sm"
								variant="ghost"
								className={cn(actionButtonClass, 'hover:text-info')}
								onClick={() => context.onZoomToDataset(event)}
								aria-label="Zoom to dataset"
								title="Zoom to dataset"
							>
								<ZoomActionIcon className="h-4 w-4" />
							</Button>
							{context.onInspectDataset ? (
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-ok')}
									onClick={() => context.onInspectDataset?.(event)}
									aria-label="Inspect dataset"
									title="Inspect dataset"
								>
									<InspectActionIcon className="h-4 w-4" />
								</Button>
							) : null}
							<Button
								size="icon-sm"
								variant="ghost"
								disabled={context.isPublishing}
								className={cn(actionButtonClass, 'hover:text-ok')}
								onClick={() => context.onLoadDataset(event)}
								aria-label={row.original.isActive ? 'Loaded in editor' : 'Load into editor'}
								title={row.original.isActive ? 'Loaded in editor' : 'Load into editor'}
							>
								<LoadEditorActionIcon className="h-4 w-4" />
							</Button>
							{context.onToggleCatalogPin ? (
								<Button
									size="icon-sm"
									variant="ghost"
									disabled={context.canFavorite === false}
									className={cn(
										actionButtonClass,
										row.original.isCatalogPinned
											? 'text-primary hover:text-primary'
											: 'hover:text-primary',
									)}
									onClick={() => context.onToggleCatalogPin?.(event)}
									aria-label={
										context.canFavorite === false
											? 'Sign in to save favorites'
											: row.original.isCatalogPinned
												? 'Remove from favorites'
												: 'Add to favorites'
									}
									title={
										context.canFavorite === false
											? 'Sign in to save favorites'
											: row.original.isCatalogPinned
												? 'Remove from favorites'
												: 'Add to favorites'
									}
								>
									<FavoriteActionIcon
										className={cn('h-4 w-4', row.original.isCatalogPinned && 'fill-primary')}
									/>
								</Button>
							) : null}
							{context.onOpenDebug ? (
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-primary')}
									onClick={() => context.onOpenDebug?.(event)}
									aria-label="Debug event"
									title="Debug event"
								>
									<DebugActionIcon className="h-4 w-4" />
								</Button>
							) : null}
							<DatasetResolvingIndicator datasetKey={row.original.datasetKey} />
						</div>
					</div>
				</div>
			)
		},
	},
]
