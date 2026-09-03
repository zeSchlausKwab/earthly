import { useState } from 'react'
import {
	ChevronDown,
	CopyPlus,
	GitPullRequest,
	Info,
	MapPinned,
	RefreshCw,
	TriangleAlert,
	UploadCloud,
} from 'lucide-react'
import { GeoRichTextEditor } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PublishChannel } from '../../store/types'
import type { ResolvedAuthoringDestination } from '../authoringDestination'

export interface PublishAudienceOption {
	id: string
	label: string
	publishChannel: PublishChannel
}

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
	publishMode?: 'public' | 'private' | 'field'
	publishingScope?: ResolvedAuthoringDestination
	audienceOptions?: readonly PublishAudienceOption[]
	selectedAudienceId?: string
	onAudienceChange?: (publishChannel: PublishChannel) => void
	onOpenPublishingScope?: () => void
	onLeavePublishingScope?: () => void
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
	publishMode = 'public',
	publishingScope,
	audienceOptions = [],
	selectedAudienceId,
	onAudienceChange,
	onOpenPublishingScope,
	onLeavePublishingScope,
	small,
}: PublishDropdownProps) {
	const [open, setOpen] = useState(false)
	const [composingProposal, setComposingProposal] = useState(false)
	const [proposalDescription, setProposalDescription] = useState('')
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'
	const trimmedProposalDescription = proposalDescription.trim()
	const workspaceMode = publishMode !== 'public'
	const workspaceLabel = publishMode === 'private' ? 'private' : 'nearby'

	const resetProposalComposer = () => {
		setComposingProposal(false)
		setProposalDescription('')
	}

	// Determine primary action based on state
	const hasPrimaryAction = canPublishUpdate || canPublishNew
	const primaryIcon = canPublishUpdate ? RefreshCw : UploadCloud
	const primaryLabel = canPublishUpdate
		? 'Update'
		: canPublishNew
			? workspaceMode
				? 'Save'
				: 'Publish'
			: 'Audience'
	const primaryAction = canPublishUpdate ? onPublishUpdate : onPublishNew
	const PrimaryIcon = primaryIcon
	const hasAudienceMenu = audienceOptions.length > 0 && Boolean(onAudienceChange)
	const hasScopeMenu = Boolean(publishingScope)
	const canOpenScope =
		Boolean(onOpenPublishingScope) && publishingScope?.kind !== 'public-unattached'
	const canRemoveAtlas =
		publishingScope?.kind === 'public-context' &&
		publishingScope.canLeave &&
		Boolean(onLeavePublishingScope)

	// If no actions available, show disabled button
	if (
		!hasPrimaryAction &&
		!canPublishCopy &&
		!canProposeEdit &&
		!hasAudienceMenu &&
		!hasScopeMenu
	) {
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

	// User can only fork/propose — they're editing someone else's Map.
	const viewingOnly = !hasPrimaryAction && (canPublishCopy || canProposeEdit)

	// Show dropdown if fork is also available
	const showDropdown =
		canPublishCopy ||
		canProposeEdit ||
		(canPublishUpdate && canPublishNew) ||
		hasAudienceMenu ||
		hasScopeMenu

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
						<p>{workspaceMode ? `${primaryLabel} ${workspaceLabel} Map` : `${primaryLabel} Map`}</p>
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
						<p>
							{viewingOnly
								? "You're editing someone else's Map"
								: workspaceMode
									? publishMode === 'private'
										? 'Private save options'
										: 'Nearby save options'
									: 'Publish options'}
						</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="max-w-[280px] rounded-none">
					{viewingOnly && (
						<>
							<div className="flex items-start gap-2 px-3 py-2 text-xs text-muted-foreground">
								<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>
									You're editing someone else's Map. You can fork it as your own or propose changes
									to the owner.
								</span>
							</div>
							<DropdownMenuSeparator />
						</>
					)}
					{canPublishNew && (
						<DropdownMenuItem onClick={onPublishNew}>
							<UploadCloud className="h-4 w-4" />
							{publishMode === 'private'
								? 'Save new private Map'
								: publishMode === 'field'
									? 'Save new nearby Map'
									: 'Publish new Map'}
						</DropdownMenuItem>
					)}
					{canPublishUpdate && (
						<DropdownMenuItem onClick={onPublishUpdate}>
							<RefreshCw className="h-4 w-4" />
							{publishMode === 'private'
								? 'Update private Map'
								: publishMode === 'field'
									? 'Update nearby Map'
									: 'Update existing'}
						</DropdownMenuItem>
					)}
					{canPublishCopy && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onPublishCopy}>
								<CopyPlus className="h-4 w-4" />
								{publishMode === 'private'
									? 'Save as new private Map'
									: publishMode === 'field'
										? 'Save as new nearby Map'
										: 'Fork as new Map'}
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
					{hasAudienceMenu ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Audience</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={selectedAudienceId}
								onValueChange={(nextId) => {
									const option = audienceOptions.find((candidate) => candidate.id === nextId)
									if (option) onAudienceChange?.(option.publishChannel)
								}}
							>
								{audienceOptions.map((option) => (
									<DropdownMenuRadioItem key={option.id} value={option.id}>
										{option.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</>
					) : null}
					{publishingScope?.availability === 'unavailable' ? (
						<div className="flex items-start gap-2 px-2 py-2 text-xs text-amber-700 dark:text-amber-300">
							<TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
							<span>{publishingScope.accessibleLabel}</span>
						</div>
					) : null}
					{publishingScope?.kind === 'public-context' ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel>Belonging</DropdownMenuLabel>
							{canOpenScope ? (
								<DropdownMenuItem onClick={onOpenPublishingScope}>
									<MapPinned className="size-4" aria-hidden="true" />
									Open Atlas: {publishingScope.detailLabel}
								</DropdownMenuItem>
							) : null}
							{canRemoveAtlas ? (
								<DropdownMenuItem onClick={onLeavePublishingScope}>
									Remove from Atlas
								</DropdownMenuItem>
							) : null}
						</>
					) : canOpenScope && publishingScope ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onOpenPublishingScope}>
								Open {publishingScope.channelLabel}: {publishingScope.detailLabel}
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
