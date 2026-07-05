import { useState } from 'react'
import { ChevronDown, CopyPlus, GitPullRequest, Info, RefreshCw, UploadCloud } from 'lucide-react'
import { GeoRichTextEditor } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
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
	onProposeEdit?: (description: string) => void
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
	const [open, setOpen] = useState(false)
	const [composingProposal, setComposingProposal] = useState(false)
	const [proposalDescription, setProposalDescription] = useState('')
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'
	const trimmedProposalDescription = proposalDescription.trim()

	const resetProposalComposer = () => {
		setComposingProposal(false)
		setProposalDescription('')
	}

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
							className={`${buttonSize} gap-1 px-2 bg-ok hover:bg-ok/15`}
						>
							<UploadCloud className={iconSize} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>No publish actions available</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	// User can only fork/propose — they're editing someone else's dataset
	const viewingOnly = !hasPrimaryAction && (canPublishCopy || canProposeEdit)

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
							className={`${buttonSize} gap-1 px-2 bg-ok hover:bg-ok/15`}
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
			<DropdownMenu
				open={open}
				onOpenChange={(nextOpen) => {
					setOpen(nextOpen)
					if (!nextOpen) {
						resetProposalComposer()
					}
				}}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant={viewingOnly ? 'outline' : 'default'}
								size="sm"
								disabled={isPublishing}
								className={`${buttonSize} gap-1 px-2 ${viewingOnly ? '' : 'bg-ok hover:bg-ok/15'}`}
							>
								{viewingOnly ? (
									<GitPullRequest className={iconSize} />
								) : (
									<PrimaryIcon className={iconSize} />
								)}
								{!small && (
									<span className="text-xs">{viewingOnly ? 'Fork / Propose' : primaryLabel}</span>
								)}
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>{viewingOnly ? "You're editing someone else's dataset" : 'Publish options'}</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="max-w-[280px]">
					{viewingOnly && (
						<>
							<div className="flex items-start gap-2 px-3 py-2 text-xs text-muted-foreground">
								<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>
									You're editing someone else's dataset. You can fork it as your own or propose
									changes to the owner.
								</span>
							</div>
							<DropdownMenuSeparator />
						</>
					)}
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
							{!composingProposal ? (
								<DropdownMenuItem
									onSelect={(event) => {
										event.preventDefault()
										setComposingProposal(true)
									}}
								>
									<GitPullRequest className="h-4 w-4" />
									Propose edit to owner
								</DropdownMenuItem>
							) : (
								<div className="space-y-2 px-2 py-2">
									<DropdownMenuLabel className="px-0 py-0 text-xs font-medium text-foreground">
										Proposal summary
									</DropdownMenuLabel>
									<GeoRichTextEditor
										initialValue={proposalDescription}
										onChange={setProposalDescription}
										rows={3}
										placeholder="Describe your proposed changes..."
										className="min-h-[120px]"
									/>
									<div className="flex items-center justify-end gap-2">
										<Button
											type="button"
											size="sm"
											variant="ghost"
											className="h-8 px-2 text-xs"
											onClick={resetProposalComposer}
										>
											Cancel
										</Button>
										<Button
											type="button"
											size="sm"
											className="h-8 bg-ok px-2 text-xs hover:bg-ok/15"
											onClick={() => {
												if (!trimmedProposalDescription) return
												onProposeEdit?.(trimmedProposalDescription)
												setOpen(false)
												resetProposalComposer()
											}}
											disabled={!trimmedProposalDescription || isPublishing}
										>
											Send proposal
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
