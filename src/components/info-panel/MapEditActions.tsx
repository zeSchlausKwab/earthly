import { ChevronDown, CopyPlus, GitPullRequest, Pencil } from 'lucide-react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'
import { Button } from '../ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { DatasetEditOptions } from './mapProposalPresentation'

/** Choose whose Map the work is for before opening a retained working copy. */
export function MapEditActions({
	dataset,
	isOwner,
	disabled,
	onBegin,
}: {
	dataset: GeoDataset
	isOwner: boolean
	disabled?: boolean
	onBegin: (dataset: GeoDataset, options?: DatasetEditOptions) => void
}) {
	const canPropose =
		!privateWorkspaceIdForDataset(dataset) && !fieldSessionIdForEvent(dataset.event)
	const intent = isOwner ? 'edit' : canPropose ? 'propose' : 'fork'
	const label = isOwner ? 'Edit map' : canPropose ? 'Propose changes' : 'Fork map'
	const Icon = isOwner ? Pencil : canPropose ? GitPullRequest : CopyPlus

	return (
		<div className="inline-flex shrink-0 items-center gap-px">
			<Button
				size="sm"
				className="gap-1 rounded-none"
				onClick={() => onBegin(dataset, { intent })}
				disabled={disabled}
			>
				<Icon className="size-3.5" aria-hidden="true" />
				{label}
			</Button>
			{!isOwner && canPropose && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="icon-sm"
							className="rounded-none"
							disabled={disabled}
							aria-label="Other ways to edit"
						>
							<ChevronDown className="size-3.5" aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="z-[70] w-64 rounded-none">
						<DropdownMenuItem
							className="items-start gap-3 py-3"
							aria-label="Fork map"
							onSelect={() => onBegin(dataset, { intent: 'fork' })}
						>
							<CopyPlus className="mt-0.5 size-4" aria-hidden="true" />
							<span>
								Fork map
								<span className="mt-1 block text-xs text-muted-foreground">
									Work on your own copy. Nothing is published until you choose Publish.
								</span>
							</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	)
}
