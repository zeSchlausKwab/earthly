import { ChevronDown, CopyPlus, GitPullRequest, RefreshCw, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface PublishDropdownProps {
	canPublishNew?: boolean
	canPublishUpdate?: boolean
	canPublishCopy?: boolean
	canProposeEdit?: boolean
	isPublishing?: boolean
	onPublishNew?: () => void
	onPublishUpdate?: () => void
	onPublishCopy?: () => void
	onProposeEdit?: () => void
	small?: boolean
}

export function PublishDropdown({
	canPublishNew,
	canPublishUpdate,
	canPublishCopy,
	canProposeEdit,
	isPublishing,
	onPublishNew,
	onPublishUpdate,
	onPublishCopy,
	onProposeEdit,
	small,
}: PublishDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'

	// Determine primary action based on state
	const hasPrimaryAction = canPublishUpdate || canPublishNew
	const primaryIcon = canPublishUpdate ? RefreshCw : UploadCloud
	const primaryLabel = canPublishUpdate ? 'Update' : 'Publish'
	const primaryAction = canPublishUpdate ? onPublishUpdate : onPublishNew
	const PrimaryIcon = primaryIcon

	// If no actions available, show disabled button
	if (!hasPrimaryAction && !canPublishCopy && !canProposeEdit) {
		return (
			<TooltipProvider delayDuration={500}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="default"
							size="sm"
							disabled
							className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
						>
							<UploadCloud className={iconSize} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Publish dataset</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	// Show dropdown if fork is also available
	const showDropdown = canPublishCopy || canProposeEdit || (canPublishUpdate && canPublishNew)

	if (!showDropdown) {
		return (
			<TooltipProvider delayDuration={500}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="default"
							size="sm"
							disabled={isPublishing}
							onClick={primaryAction}
							className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
						>
							<PrimaryIcon className={iconSize} />
							{!small && <span className="text-xs">{primaryLabel}</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>{primaryLabel} dataset</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="default"
								size="sm"
								disabled={isPublishing}
								className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
							>
								<PrimaryIcon className={iconSize} />
								{!small && <span className="text-xs">{primaryLabel}</span>}
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Publish options</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end">
					{canPublishNew && (
						<DropdownMenuItem onClick={onPublishNew}>
							<UploadCloud className="h-4 w-4" />
							Publish new dataset
						</DropdownMenuItem>
					)}
					{canPublishUpdate && (
						<DropdownMenuItem onClick={onPublishUpdate}>
							<RefreshCw className="h-4 w-4" />
							Update existing
						</DropdownMenuItem>
					)}
					{canPublishCopy && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onPublishCopy}>
								<CopyPlus className="h-4 w-4" />
								Fork as new dataset
							</DropdownMenuItem>
						</>
					)}
					{canProposeEdit && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onProposeEdit}>
								<GitPullRequest className="h-4 w-4" />
								Propose edit to owner
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
