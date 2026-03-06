import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Download, Loader2, Maximize2, Pencil, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { Button } from './ui/button'
import { UserProfile } from './user-profile'
import { nip19 } from 'nostr-tools'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { useEditorStore } from '../features/geo-editor/store'
import { memo, useEffect, useState } from 'react'

export interface DatasetRowData {
	event: NDKGeoEvent
	datasetKey: string
	datasetName: string
	isActive: boolean
	isOwned: boolean
	isVisible: boolean
	primaryLabel: string
}

export interface DatasetColumnsContext {
	onLoadDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onOpenDebug?: (event: NDKGeoEvent) => void
	isPublishing: boolean
	deletingKey: string | null
	allVisibleState: 'all' | 'none' | 'some'
	// Note: resolvingDatasets and resolvingProgress removed - DatasetLoadButton subscribes directly to store
}

/**
 * Self-subscribing load button that only re-renders when its own progress changes.
 * This prevents the entire table from re-rendering on every progress update.
 */
const DatasetLoadButton = memo(function DatasetLoadButton({
	datasetKey,
	event,
	isActive,
	isOwned,
	isPublishing,
	onLoadDataset,
}: {
	datasetKey: string
	event: NDKGeoEvent
	isActive: boolean
	isOwned: boolean
	isPublishing: boolean
	onLoadDataset: (event: NDKGeoEvent) => void
}) {
	// Subscribe directly to this dataset's resolving state
	const isResolving = useEditorStore((state) => state.resolvingDatasets.has(datasetKey))
	const progress = useEditorStore((state) => state.resolvingProgress.get(datasetKey))

	const progressPercent =
		progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0

	const getProgressLabel = () => {
		if (!isResolving) {
			return isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy'
		}
		if (progress && progress.total > 0) {
			const sizeMB = (progress.total / 1024 / 1024).toFixed(1)
			return `Loading ${progressPercent}% of ${sizeMB}MB...`
		}
		return 'Loading blob data...'
	}

	if (isResolving && progress && progress.total > 0) {
		return (
			<div className="relative h-6 w-6 flex items-center justify-center" title={getProgressLabel()}>
				{/* Circular progress indicator */}
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
						className="text-blue-600 transition-all duration-150"
					/>
				</svg>
				<span className="absolute text-[8px] font-medium text-blue-600">{progressPercent}</span>
			</div>
		)
	}

	return (
		<Button
			size="icon-sm"
			className={cn(
				isActive
					? 'bg-green-600 text-white hover:bg-green-700'
					: 'bg-blue-600 text-white hover:bg-blue-700',
			)}
			onClick={() => onLoadDataset(event)}
			disabled={isPublishing || isResolving}
			aria-label={getProgressLabel()}
			title={getProgressLabel()}
		>
			{isResolving ? (
				<Loader2 className="h-3 w-3 animate-spin" />
			) : isOwned ? (
				<Pencil className="h-3 w-3" />
			) : (
				<Download className="h-3 w-3" />
			)}
		</Button>
	)
})

const DatasetDeleteButton = memo(function DatasetDeleteButton({
	datasetKey,
	event,
	deletingKey,
	onDeleteDataset,
}: {
	datasetKey: string
	event: NDKGeoEvent
	deletingKey: string | null
	onDeleteDataset: (event: NDKGeoEvent) => void
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const isDeleting = deletingKey === datasetKey

	useEffect(() => {
		if (!isDeleting) {
			setConfirmingDelete(false)
		}
	}, [isDeleting])

	if (confirmingDelete || isDeleting) {
		return (
			<div className="flex items-center gap-0.5 rounded-md border border-rose-200 bg-rose-50 p-0.5">
				<Button
					size="icon-sm"
					variant="ghost"
					onClick={() => setConfirmingDelete(false)}
					disabled={isDeleting}
					aria-label="Cancel dataset deletion"
					title="Keep dataset"
				>
					<X className="h-3 w-3" />
				</Button>
				<Button
					size="icon-sm"
					variant="destructive"
					onClick={() => onDeleteDataset(event)}
					disabled={isDeleting}
					aria-label="Confirm dataset deletion"
					title={isDeleting ? 'Deleting…' : 'Delete dataset'}
				>
					{isDeleting ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Trash2 className="h-3 w-3" />
					)}
				</Button>
			</div>
		)
	}

	return (
		<Button
			size="icon-sm"
			variant="destructive"
			onClick={() => setConfirmingDelete(true)}
			aria-label="Delete dataset"
			title="Delete dataset"
		>
			<Trash2 className="h-3 w-3" />
		</Button>
	)
})

export const createDatasetColumns = (
	context: DatasetColumnsContext,
): ColumnDef<DatasetRowData>[] => [
	{
		id: 'visibility',
		header: () => {
			const isAllVisible = context.allVisibleState === 'all'
			const isIndeterminate = context.allVisibleState === 'some'
			return (
				<input
					type="checkbox"
					checked={isAllVisible}
					ref={(el) => {
						if (el) el.indeterminate = isIndeterminate
					}}
					onChange={() => context.onToggleAllVisibility(!isAllVisible)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isAllVisible ? 'Hide all datasets' : 'Show all datasets'}
					title={isAllVisible ? 'Hide all datasets' : 'Show all datasets'}
				/>
			)
		},
		size: 32,
		cell: ({ row }) => {
			const { event, isVisible } = row.original
			return (
				<input
					type="checkbox"
					checked={isVisible}
					onChange={() => context.onToggleVisibility(event)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isVisible ? 'Hide dataset' : 'Show dataset'}
					title={isVisible ? 'Hide dataset' : 'Show dataset'}
				/>
			)
		},
	},
	{
		accessorKey: 'datasetName',
		header: 'Dataset',
		cell: ({ row }) => {
			const { event, datasetName } = row.original

			const handleDragStart = (e: React.DragEvent) => {
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
				e.dataTransfer.effectAllowed = 'copy'
			}

			return (
				<button
					type="button"
					className="max-w-[160px] cursor-grab space-y-0.5 text-left active:cursor-grabbing"
					draggable
					onDragStart={handleDragStart}
				>
					<div className="text-xs font-semibold text-gray-900 truncate" title={datasetName}>
						{datasetName}
					</div>
					<UserProfile pubkey={event.pubkey} mode="avatar-name" size="xs" showNip05Badge={false} />
					{event.hashtags.length > 0 && (
						<div className="flex flex-wrap gap-0.5">
							{event.hashtags.slice(0, 2).map((tag) => (
								<span
									key={tag}
									className="rounded bg-blue-100 px-1 py-0.5 text-[9px] text-blue-700"
								>
									#{tag}
								</span>
							))}
						</div>
					)}
				</button>
			)
		},
	},
	{
		id: 'actions',
		header: '',
		cell: ({ row }) => {
			const { event, isActive, isOwned, datasetKey } = row.original
			return (
				<div className="flex items-center gap-0.5">
					<DatasetLoadButton
						datasetKey={datasetKey}
						event={event}
						isActive={isActive}
						isOwned={isOwned}
						isPublishing={context.isPublishing}
						onLoadDataset={context.onLoadDataset}
					/>
					{isOwned && (
						<DatasetDeleteButton
							datasetKey={datasetKey}
							event={event}
							deletingKey={context.deletingKey}
							onDeleteDataset={context.onDeleteDataset}
						/>
					)}
					<Button
						size="icon-sm"
						variant="outline"
						onClick={() => context.onInspectDataset?.(event)}
						aria-label="Inspect dataset"
						title="Inspect dataset"
					>
						<Search className="h-3 w-3" />
					</Button>
					<Button
						size="icon-sm"
						variant="outline"
						onClick={() => context.onZoomToDataset(event)}
						aria-label="Zoom to dataset"
						title="Zoom to dataset"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
					{context.onOpenDebug && (
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Open debug"
							title="Open debug"
							onClick={() => context.onOpenDebug?.(event)}
						>
							<Bug className="h-3 w-3" />
						</Button>
					)}
				</div>
			)
		},
	},
]
