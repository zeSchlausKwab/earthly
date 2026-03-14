import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Download, Loader2, Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo } from 'react'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { Button } from './ui/button'
import { UserProfile } from './user-profile'
import { useEditorStore } from '../features/geo-editor/store'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { cn } from '@/lib/utils'

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
	event: NDKGeoEvent
	isActive: boolean
	isPublishing: boolean
	onLoadDataset: (event: NDKGeoEvent) => void
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
			<div className="flex w-full justify-center" title={label}>
				<div className="relative flex h-8 w-8 items-center justify-center">
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
			</div>
		)
	}

	return (
		<div className="flex w-full justify-center">
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
		</div>
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
					className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
					className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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

			const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
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
					className="max-w-[220px] cursor-grab space-y-1 text-left active:cursor-grabbing"
					draggable
					onDragStart={handleDragStart}
					onClick={() => context.onZoomToDataset(event)}
					aria-label={`Zoom to dataset ${datasetName}`}
					title="Zoom to dataset"
				>
					<div className="truncate text-xs font-semibold text-gray-900 transition-colors hover:text-sky-700">
						{datasetName}
					</div>
					<UserProfile
						pubkey={event.pubkey}
						mode="avatar-name"
						size="xs"
						showNip05Badge={false}
						interactive={false}
					/>
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
		id: 'load',
		header: '',
		size: 44,
		cell: ({ row }) => {
			const { event, isActive, datasetKey } = row.original
			return (
				<DatasetLoadButton
					datasetKey={datasetKey}
					event={event}
					isActive={isActive}
					isPublishing={context.isPublishing}
					onLoadDataset={context.onLoadDataset}
				/>
			)
		},
	},
	{
		id: 'inspect',
		header: '',
		size: 44,
		cell: ({ row }) => {
			const { event } = row.original
			return (
				<div className="flex w-full justify-center">
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
				</div>
			)
		},
	},
	{
		id: 'debug',
		header: '',
		size: 44,
		cell: ({ row }) => {
			const { event } = row.original
			return context.onOpenDebug ? (
				<div className="flex w-full justify-center">
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
				</div>
			) : null
		},
	},
]
