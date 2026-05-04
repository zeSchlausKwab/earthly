import type { ColumnDef } from '@tanstack/react-table'
import { Download, Eye, EyeOff, Maximize2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { Button } from '../ui/button'
import { UserProfile } from '../user-profile'

export interface ViewModeRowData {
	event: GeoDataset
	datasetKey: string
	datasetName: string
	isVisible: boolean
	isOwned: boolean
}

export interface ViewModeColumnsContext {
	onLoadDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	isPublishing: boolean
	datasetVisibility: Record<string, boolean>
}

export const createViewModeColumns = (
	context: ViewModeColumnsContext,
): ColumnDef<ViewModeRowData>[] => [
	{
		accessorKey: 'datasetName',
		header: 'Dataset',
		cell: ({ row }) => {
			const { datasetName, event } = row.original
			return (
				<div className="space-y-0.5 max-w-[140px]">
					<div className="text-xs font-semibold text-gray-900 truncate" title={datasetName}>
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
				</div>
			)
		},
	},
	{
		id: 'actions',
		header: '',
		cell: ({ row }) => {
			const { event, isOwned, isVisible } = row.original
			return (
				<div className="flex items-center gap-0.5">
					<Button
						size="icon-xs"
						className={cn(
							isOwned
								? 'bg-green-600 text-white hover:bg-green-700'
								: 'bg-blue-600 text-white hover:bg-blue-700',
						)}
						onClick={() => context.onLoadDataset(event)}
						disabled={context.isPublishing}
						aria-label={isOwned ? 'Edit dataset' : 'Load copy'}
						title={isOwned ? 'Edit dataset' : 'Load copy'}
					>
						{isOwned ? <Pencil className="h-3 w-3" /> : <Download className="h-3 w-3" />}
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onToggleVisibility(event)}
						aria-label={isVisible ? 'Hide dataset' : 'Show dataset'}
						title={isVisible ? 'Hide dataset' : 'Show dataset'}
					>
						{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onZoomToDataset(event)}
						aria-label="Zoom to dataset"
						title="Zoom to dataset"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
				</div>
			)
		},
	},
]
