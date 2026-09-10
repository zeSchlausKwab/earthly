import { useState } from 'react'
import {
	ChevronDown,
	CopyPlus,
	GitPullRequest,
	MapPinned,
	RefreshCw,
	TriangleAlert,
	UploadCloud,
} from 'lucide-react'
import { ProposalDialog } from './ProposalDialog'
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
import type { MapAuthoringIntent } from '@/components/info-panel/mapProposalPresentation'
import { useEditorStore } from '../../store'
import { useDraftPublishReview } from '../../hooks/useDraftPublishReview'

export interface PublishAudienceOption {
	id: string
	label: string
	publishChannel: PublishChannel
}

export interface PublishDropdownProps {
	authoringIntent?: MapAuthoringIntent
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
	authoringIntent,
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
	const [proposalOpen, setProposalOpen] = useState(false)
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'
	const workspaceMode = publishMode !== 'public'
	const workspaceLabel = publishMode === 'private' ? 'private' : 'nearby'
	const workspaceId = useEditorStore(state => state.activeWorkspaceId)
	const publishRef = useDraftPublishReview(`map:${workspaceId}`, () => {
		if (authoringIntent === 'propose' || canProposeEdit) setProposalOpen(true)
		else setOpen(true)
	})

	// The working copy already knows its intent. Sending never converts it to a fork.
	if (authoringIntent === 'propose' || canProposeEdit) {
		return (
			<>
				<Button
					ref={publishRef}
					size="sm"
					className={`${buttonSize} gap-1 rounded-none px-2`}
					disabled={isPublishing || !canProposeEdit}
					onClick={() => setProposalOpen(true)}
					aria-label="Send proposal"
				>
					<GitPullRequest className={iconSize} aria-hidden="true" />
					{!small && <span className="text-xs">Send proposal</span>}
				</Button>
				<ProposalDialog
					open={proposalOpen}
					onOpenChange={setProposalOpen}
					isPublishing={isPublishing}
					onSubmit={(description) => onProposeEdit?.(description)}
				/>
			</>
		)
	}

	// Determine primary action based on state
	const hasPrimaryAction = canPublishUpdate || canPublishNew || canPublishCopy
	const primaryIcon = canPublishUpdate ? RefreshCw : UploadCloud
	const primaryLabel = canPublishUpdate
		? 'Update'
		: canPublishNew
			? workspaceMode
				? 'Save'
				: 'Publish'
			: canPublishCopy
				? workspaceMode
					? 'Save'
					: 'Publish map'
				: 'Audience'
	const primaryAction = canPublishUpdate
		? onPublishUpdate
		: canPublishNew
			? onPublishNew
			: onPublishCopy
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
							ref={publishRef}
							variant="default"
							size="sm"
							disabled
							className={`${buttonSize} gap-1 px-2 bg-ok hover:bg-ok/15`}
							aria-label={primaryLabel}
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

	// Keep audience and the owner's optional publish-as-new action available.
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
							ref={publishRef}
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
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								ref={publishRef}
								variant="default"
								size="sm"
								disabled={isPublishing}
								className={`${buttonSize} gap-1 px-2 bg-ok hover:bg-ok/15`}
								aria-label={primaryLabel}
							>
								<PrimaryIcon className={iconSize} />
								{!small && <span className="text-xs">{primaryLabel}</span>}
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>
							{workspaceMode
								? publishMode === 'private'
									? 'Private save options'
									: 'Nearby save options'
								: 'Publish options'}
						</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="max-w-[280px] rounded-none">
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
										: canPublishUpdate
											? 'Publish as new map'
											: 'Publish map'}
							</DropdownMenuItem>
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
