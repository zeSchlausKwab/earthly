import {
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	Check,
	MessageSquareWarning,
	X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RichContentRenderer } from '@/components/editor'
import { UserProfile } from '@/components/user-profile'
import { GeoCommentForm } from '../comments'
import type { ProposalWithStatus } from '../hooks/useGeoProposals'
import { getProposalReviewState, type ProposalReviewState } from '@/lib/nostr/geo-proposal'

interface ProposalCardProps {
	proposalWithStatus: ProposalWithStatus
	isOwner: boolean
	isExpanded: boolean
	isOverlayVisible: boolean
	onToggleExpanded: () => void
	onToggleOverlay: () => void
	onAccept: () => void
	onRequestChanges: (reason: string) => Promise<void>
	onReject: () => Promise<void>
}

const STATUS_STYLES: Record<ProposalReviewState, { label: string; className: string }> = {
	open: { label: 'Open', className: 'bg-ok/15 text-ok' },
	accepted: { label: 'Accepted', className: 'bg-info/15 text-info' },
	needs_changes: { label: 'Needs changes', className: 'bg-primary/10 text-primary' },
	rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive' },
	draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
}

export function ProposalCard({
	proposalWithStatus,
	isOwner,
	isExpanded,
	isOverlayVisible,
	onToggleExpanded,
	onToggleOverlay,
	onAccept,
	onRequestChanges,
	onReject,
}: ProposalCardProps) {
	const { proposal, status, statusInfo } = proposalWithStatus
	const [showChangesNeededForm, setShowChangesNeededForm] = useState(false)

	const featureCount = proposal.featureCollection.features.length
	const description = proposal.description
	const statusReason = statusInfo?.reason?.trim()
	const reviewState = getProposalReviewState(status, statusReason)
	const statusStyle = STATUS_STYLES[reviewState]

	const timestamp = useMemo(() => {
		if (!proposal.created_at) return 'Unknown time'
		const date = new Date(proposal.created_at * 1000)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffMins = Math.floor(diffMs / 60000)
		const diffHours = Math.floor(diffMs / 3600000)
		const diffDays = Math.floor(diffMs / 86400000)

		if (diffMins < 1) return 'just now'
		if (diffMins < 60) return `${diffMins}m ago`
		if (diffHours < 24) return `${diffHours}h ago`
		if (diffDays < 7) return `${diffDays}d ago`
		return date.toLocaleDateString()
	}, [proposal.created_at])

	const handleSubmitChangesNeeded = useCallback(
		async (text: string) => {
			const reason = text.trim()
			if (!reason) return
			await onRequestChanges(reason)
			setShowChangesNeededForm(false)
		},
		[onRequestChanges],
	)

	return (
		<Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
			<div className="rounded-lg border border-border bg-card hover:border-border transition-colors">
				{/* Header — always visible */}
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="flex items-center gap-2 w-full px-2.5 py-2 text-left justify-start h-auto"
					>
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						)}

						<div className="flex items-center gap-2 min-w-0 flex-1">
							<UserProfile
								pubkey={proposal.pubkey}
								mode="avatar-name"
								size="xs"
								showNip05Badge={false}
								interactive={false}
							/>
							<span className="text-[10px] text-muted-foreground flex-shrink-0">{timestamp}</span>
						</div>

						<span
							className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusStyle.className}`}
						>
							{statusStyle.label}
						</span>
					</Button>
				</CollapsibleTrigger>

				{/* Expanded content */}
				<CollapsibleContent>
					<div className="px-2.5 pb-2.5 space-y-2">
						{/* Description */}
						{description && (
							<RichContentRenderer
								content={description}
								className="space-y-2 text-xs leading-relaxed text-muted-foreground"
							/>
						)}

						{/* Feature count */}
						<div className="text-[10px] text-muted-foreground">
							{featureCount} feature{featureCount === 1 ? '' : 's'}
						</div>

						{statusReason && (
							<div className="rounded-md border border-primary/40 bg-primary/10 p-2">
								<p className="text-[10px] font-medium uppercase tracking-wider text-primary">
									Changes needed
								</p>
								<p className="mt-1 text-xs text-primary leading-relaxed">{statusReason}</p>
							</div>
						)}

						{/* Action row */}
						<div className="flex flex-wrap items-center gap-1.5 pt-1">
							{/* Preview toggle */}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										type="button"
										onClick={(e) => {
											e.stopPropagation()
											onToggleOverlay()
										}}
										aria-label={
											isOverlayVisible ? 'Hide proposal preview' : 'Preview proposal change'
										}
										title={isOverlayVisible ? 'Hide preview' : 'Preview change'}
										aria-pressed={isOverlayVisible}
										className={`h-7 gap-1.5 px-2 text-[11px] ${
											isOverlayVisible
												? 'text-info bg-info/15'
												: 'text-muted-foreground hover:text-info'
										}`}
									>
										{isOverlayVisible ? (
											<Eye className="h-3.5 w-3.5" />
										) : (
											<EyeOff className="h-3.5 w-3.5" />
										)}
										<span>{isOverlayVisible ? 'Hide preview' : 'Preview change'}</span>
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									{isOverlayVisible ? 'Hide preview' : 'Preview on map'}
								</TooltipContent>
							</Tooltip>

							{/* Accept / Reject — only for owner on open proposals */}
							{isOwner && status === 'open' && (
								<div className="ml-auto flex flex-wrap items-center gap-1">
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												type="button"
												onClick={(e) => {
													e.stopPropagation()
													onAccept()
												}}
												aria-label="Accept proposal"
												title="Accept proposal"
												className="h-7 gap-1.5 px-2 text-[11px] text-ok hover:text-ok hover:bg-ok/15"
											>
												<Check className="h-3.5 w-3.5" />
												<span>Accept</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>Accept proposal</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant={showChangesNeededForm ? 'default' : 'outline'}
												size="sm"
												type="button"
												onClick={(e) => {
													e.stopPropagation()
													setShowChangesNeededForm((prev) => !prev)
												}}
												aria-label="Request changes"
												title="Request changes"
												className="h-7 gap-1.5 px-2 text-[11px]"
											>
												<MessageSquareWarning className="h-3.5 w-3.5" />
												<span>Request changes</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>Changes needed</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="outline"
												size="sm"
												type="button"
												onClick={(e) => {
													e.stopPropagation()
													void onReject()
												}}
												aria-label="Reject proposal"
												title="Reject proposal"
												className="h-7 gap-1.5 px-2 text-[11px] text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
											>
												<X className="h-3.5 w-3.5" />
												<span>Reject</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent>Reject proposal</TooltipContent>
									</Tooltip>
								</div>
							)}
						</div>

						{isOwner && status === 'open' && showChangesNeededForm && (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-2">
								<p className="mb-2 text-[11px] font-medium text-destructive">
									Describe what should be changed before this can be accepted.
								</p>
								<GeoCommentForm
									onSubmit={handleSubmitChangesNeeded}
									onCancel={() => setShowChangesNeededForm(false)}
									placeholder="What needs to change?"
								/>
							</div>
						)}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
}
