import type { ColumnDef } from '@tanstack/react-table'
import { Eye, EyeOff, GitPullRequest, Maximize2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { Button } from '../ui/button'
import { UserProfile } from '../user-profile'
import { getMapEditPresentation } from './mapProposalPresentation'

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
		header: 'Map',
		cell: ({ row }) => {
			const { datasetName, event } = row.original
			return (
				<div className="space-y-0.5 max-w-[140px]">
					<div className="text-xs font-semibold text-foreground truncate" title={datasetName}>
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
								<span key={tag} className="rounded bg-info/15 px-1 py-0.5 text-[9px] text-info">
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
			const editPresentation = getMapEditPresentation(isOwned)
			return (
				<div className="flex items-center gap-0.5">
					<Button
						size="icon-xs"
						className={cn(
							isOwned ? 'bg-ok text-white hover:bg-ok/15' : 'bg-info text-white hover:bg-info/15',
						)}
						onClick={() => context.onLoadDataset(event)}
						disabled={context.isPublishing}
						aria-label={editPresentation.actionLabel}
						title={editPresentation.actionLabel}
					>
						{isOwned ? <Pencil className="h-3 w-3" /> : <GitPullRequest className="h-3 w-3" />}
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onToggleVisibility(event)}
						aria-label={isVisible ? 'Hide map' : 'Show map'}
						title={isVisible ? 'Hide map' : 'Show map'}
					>
						{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onZoomToDataset(event)}
						aria-label="Zoom to map"
						title="Zoom to map"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
				</div>
			)
		},
	},
]
