import { Eye, EyeOff, Maximize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { Button } from '../ui/button'

export interface DatasetActionCardProps {
	event: NDKGeoEvent
	datasetKey: string
	datasetName: string
	isVisible: boolean
	isOwned: boolean
	isPublishing?: boolean
	deletingKey: string | null
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
}

/**
 * A card component for displaying dataset actions (load, delete, toggle visibility, zoom).
 * Used in both View Mode and Edit Mode panels.
 */
export function DatasetActionCard({
	event,
	datasetKey,
	datasetName,
	isVisible,
	isOwned,
	isPublishing = false,
	deletingKey,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset,
}: DatasetActionCardProps) {
	const primaryLabel = isOwned ? 'Edit dataset' : 'Load copy'
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const isDeleting = deletingKey === datasetKey

	useEffect(() => {
		if (!isDeleting) {
			setConfirmingDelete(false)
		}
	}, [isDeleting])

	return (
		<div
			className={cn(
				'rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2',
				!isVisible && 'opacity-60',
			)}
		>
			<div className="font-semibold text-gray-900 truncate">{datasetName}</div>
			<div className="text-[11px] text-gray-500 truncate">
				Owner: {event.pubkey.slice(0, 8)}…{event.pubkey.slice(-4)}
			</div>
			{event.hashtags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{event.hashtags.slice(0, 3).map((tag) => (
						<span key={tag} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
							#{tag}
						</span>
					))}
				</div>
			)}
			<div className="flex flex-col gap-2">
				<Button
					size="sm"
					className={cn(
						'w-full',
						isOwned
							? 'bg-green-600 text-white hover:bg-green-700'
							: 'bg-blue-600 text-white hover:bg-blue-700',
					)}
					onClick={() => onLoadDataset(event)}
					disabled={isPublishing}
				>
					{primaryLabel}
				</Button>
				{isOwned &&
					(confirmingDelete || isDeleting ? (
						<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
							<p className="text-[11px] font-medium text-rose-900">
								Delete this dataset from Nostr?
							</p>
							<div className="mt-2 flex items-center justify-end gap-2">
								<Button
									size="sm"
									variant="ghost"
									className="h-7 px-2 text-[11px]"
									onClick={() => setConfirmingDelete(false)}
									disabled={isDeleting}
								>
									Keep
								</Button>
								<Button
									size="sm"
									variant="destructive"
									className="h-7 px-2 text-[11px]"
									onClick={() => onDeleteDataset(event)}
									disabled={isDeleting}
								>
									{isDeleting ? 'Deleting…' : 'Delete'}
								</Button>
							</div>
						</div>
					) : (
						<Button
							size="sm"
							variant="destructive"
							className="w-full"
							onClick={() => setConfirmingDelete(true)}
						>
							Delete
						</Button>
					))}
				<div className="flex items-center justify-between gap-2 text-[11px]">
					<Button
						size="sm"
						variant="outline"
						className="flex-1"
						onClick={() => onToggleVisibility(event)}
					>
						{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
						{isVisible ? 'Hide' : 'Show'}
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="flex-1"
						onClick={() => onZoomToDataset(event)}
					>
						<Maximize2 className="h-3 w-3" />
						Zoom
					</Button>
				</div>
			</div>
		</div>
	)
}
