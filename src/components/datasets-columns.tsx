import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Download, Eye, EyeOff, Layers, Loader2, MoreVertical, Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo } from 'react'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { Button } from './ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu'
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
	onOpenDebug?: (event: GeoDataset) => void
	isPublishing: boolean
	deletingKey: string | null
	allVisibleState: 'all' | 'none' | 'some'
}

const actionButtonClass =
	'rounded-none px-2 text-xs text-gray-500 shadow-none hover:bg-transparent hover:text-sky-600'

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
						className="text-gray-200"
					/>
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeDasharray={`${progressPercent * 0.5} 50`}
						className="text-sky-600 transition-all duration-150"
					/>
				</svg>
				<span className="absolute text-[8px] font-medium text-sky-600">{progressPercent}</span>
			</div>
		)
	}

	return (
		<div className="flex h-8 w-8 items-center justify-center" title="Loading blob data...">
			<Loader2 className="h-4 w-4 animate-spin text-sky-600" />
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
								? 'text-sky-600 hover:text-sky-700'
								: 'text-gray-400 hover:text-sky-600',
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
						className="block w-full cursor-grab text-left text-sm font-semibold leading-snug text-gray-900 transition-colors hover:text-sky-700 active:cursor-grabbing"
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
						<div className="flex shrink-0 items-center gap-0.5">
							{/* Round F.1: one primary verb per row. The stack toggle is the
							    primary action (it IS visibility under the Round C model);
							    Inspect / Load / Debug live in the overflow menu. */}
							{context.onAddDatasetToMap ? (
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(
										actionButtonClass,
										row.original.isInMapStack
											? 'text-emerald-600 hover:text-emerald-700'
											: 'hover:text-emerald-600',
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
									<Layers className="h-4 w-4" />
								</Button>
							) : null}
							<DatasetResolvingIndicator datasetKey={row.original.datasetKey} />
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										size="icon-sm"
										variant="ghost"
										className={cn(actionButtonClass, 'hover:text-foreground')}
										aria-label="More actions"
										title="More actions"
									>
										<MoreVertical className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-44">
									<DropdownMenuItem onSelect={() => context.onInspectDataset?.(event)}>
										<Search className="h-4 w-4" />
										Inspect
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={context.isPublishing}
										onSelect={() => context.onLoadDataset(event)}
									>
										<Download className="h-4 w-4" />
										{row.original.isActive ? 'Loaded in editor' : 'Load into editor'}
									</DropdownMenuItem>
									{context.onOpenDebug ? (
										<DropdownMenuItem onSelect={() => context.onOpenDebug?.(event)}>
											<Bug className="h-4 w-4" />
											Debug event
										</DropdownMenuItem>
									) : null}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				</div>
			)
		},
	},
]
