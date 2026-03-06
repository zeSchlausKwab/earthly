import { ChevronDown, ChevronRight, Eye, EyeOff, Check, X } from 'lucide-react'
import { useMemo } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserProfile } from '@/components/user-profile'
import type { ProposalWithStatus } from '../hooks/useGeoProposals'
import type { ProposalStatus } from '@/lib/ndk/proposalStatus'

interface ProposalCardProps {
	proposalWithStatus: ProposalWithStatus
	isOwner: boolean
	isExpanded: boolean
	isOverlayVisible: boolean
	onToggleExpanded: () => void
	onToggleOverlay: () => void
	onAccept: () => void
	onReject: () => void
}

const STATUS_STYLES: Record<ProposalStatus, { label: string; className: string }> = {
	open: { label: 'Open', className: 'bg-green-100 text-green-700' },
	applied: { label: 'Applied', className: 'bg-blue-100 text-blue-700' },
	closed: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
	draft: { label: 'Draft', className: 'bg-gray-100 text-gray-600' },
}

export function ProposalCard({
	proposalWithStatus,
	isOwner,
	isExpanded,
	isOverlayVisible,
	onToggleExpanded,
	onToggleOverlay,
	onAccept,
	onReject,
}: ProposalCardProps) {
	const { proposal, status } = proposalWithStatus
	const statusStyle = STATUS_STYLES[status]

	const featureCount = proposal.featureCollection.features.length
	const description = proposal.description

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

	return (
		<Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
			<div className="rounded-lg border border-gray-100 bg-white hover:border-gray-200 transition-colors">
				{/* Header — always visible */}
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex items-center gap-2 w-full px-2.5 py-2 text-left cursor-pointer"
					>
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
						)}

						<div className="flex items-center gap-2 min-w-0 flex-1">
							<UserProfile
								pubkey={proposal.pubkey}
								mode="avatar-name"
								size="xs"
								showNip05Badge={false}
							/>
							<span className="text-[10px] text-gray-400 flex-shrink-0">{timestamp}</span>
						</div>

						<span
							className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusStyle.className}`}
						>
							{statusStyle.label}
						</span>
					</button>
				</CollapsibleTrigger>

				{/* Expanded content */}
				<CollapsibleContent>
					<div className="px-2.5 pb-2.5 space-y-2">
						{/* Description */}
						{description && <p className="text-xs text-gray-600 leading-relaxed">{description}</p>}

						{/* Feature count */}
						<div className="text-[10px] text-gray-400">
							{featureCount} feature{featureCount === 1 ? '' : 's'}
						</div>

						{/* Action row */}
						<div className="flex items-center gap-1.5 pt-1">
							{/* Preview toggle */}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={(e) => {
											e.stopPropagation()
											onToggleOverlay()
										}}
										className={`h-6 w-6 ${
											isOverlayVisible
												? 'text-blue-600 bg-blue-50'
												: 'text-gray-400 hover:text-blue-600'
										}`}
									>
										{isOverlayVisible ? (
											<Eye className="h-3.5 w-3.5" />
										) : (
											<EyeOff className="h-3.5 w-3.5" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>
									{isOverlayVisible ? 'Hide preview' : 'Preview on map'}
								</TooltipContent>
							</Tooltip>

							{/* Accept / Reject — only for owner on open proposals */}
							{isOwner && status === 'open' && (
								<div className="flex items-center gap-1 ml-auto">
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="icon-xs"
												onClick={(e) => {
													e.stopPropagation()
													onAccept()
												}}
												className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
											>
												<Check className="h-3.5 w-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Accept proposal</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="outline"
												size="icon-xs"
												onClick={(e) => {
													e.stopPropagation()
													onReject()
												}}
												className="h-6 w-6 text-red-500 hover:text-red-600 border-red-200 hover:bg-red-50"
											>
												<X className="h-3.5 w-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Reject proposal</TooltipContent>
									</Tooltip>
								</div>
							)}
						</div>
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
}
