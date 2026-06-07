import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Download, Eye, EyeOff, Layers, Loader2, Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo } from 'react'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
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

const DatasetLoadButton = memo(function DatasetLoadButton({
	datasetKey,
	event,
	isActive,
	isPublishing,
	onLoadDataset,
}: {
	datasetKey: string
	event: GeoDataset
	isActive: boolean
	isPublishing: boolean
	onLoadDataset: (event: GeoDataset) => void
}) {
	const isResolving = useEditorStore((state) => state.resolvingDatasets.has(datasetKey))
	const progress = useEditorStore((state) => state.resolvingProgress.get(datasetKey))

	const progressPercent =
		progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0

	const label = (() => {
		if (!isResolving) {
			return isActive ? 'Dataset loaded in editor' : 'Load dataset into editor'
		}
		if (progress && progress.total > 0) {
			const sizeMB = (progress.total / 1024 / 1024).toFixed(1)
			return `Loading ${progressPercent}% of ${sizeMB}MB...`
		}
		return 'Loading blob data...'
	})()

	if (isResolving && progress && progress.total > 0) {
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
		<Button
			size="icon-sm"
			variant="ghost"
			className={cn(
				actionButtonClass,
				isActive ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-500 hover:text-sky-600',
			)}
			onClick={() => onLoadDataset(event)}
			disabled={isPublishing || isResolving}
			aria-label={label}
			title={label}
		>
			{isResolving ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<Download className="h-4 w-4" />
			)}
		</Button>
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
							<DatasetLoadButton
								datasetKey={row.original.datasetKey}
								event={event}
								isActive={row.original.isActive}
								isPublishing={context.isPublishing}
								onLoadDataset={context.onLoadDataset}
							/>
							<Button
								size="icon-sm"
								variant="ghost"
								className={cn(actionButtonClass, 'hover:text-emerald-600')}
								onClick={() => context.onInspectDataset?.(event)}
								aria-label="Inspect dataset"
								title="Inspect dataset"
							>
								<Search className="h-4 w-4" />
							</Button>
							{context.onOpenDebug ? (
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-amber-600')}
									aria-label="Open debug"
									title="Open debug"
									onClick={() => context.onOpenDebug?.(event)}
								>
									<Bug className="h-4 w-4" />
								</Button>
							) : null}
						</div>
					</div>
				</div>
			)
		},
	},
]
