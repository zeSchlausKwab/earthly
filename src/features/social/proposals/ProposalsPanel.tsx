import { GitPullRequest, RefreshCw } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useGeoProposals } from '../hooks/useGeoProposals'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'
import { ProposalCard } from './ProposalCard'

interface ProposalsPanelProps {
	/** The dataset to show proposals for */
	target: NDKGeoEvent | null
	/** Current user's pubkey */
	currentUserPubkey?: string
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (proposal: NDKGeoEditProposalEvent, visible: boolean) => void
	/** Callback when a proposal is accepted (dataset republished) */
	onProposalAccepted?: () => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
	className?: string
}

export function ProposalsPanel({
	target,
	currentUserPubkey,
	onToggleProposalOverlay,
	onProposalAccepted,
	visibleProposalIds = new Set(),
	className = '',
}: ProposalsPanelProps) {
	const { proposals, openCount, isLoading, acceptProposal, rejectProposal } = useGeoProposals({
		target,
	})

	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const isOwner = !!(currentUserPubkey && target?.pubkey && currentUserPubkey === target.pubkey)

	const toggleExpanded = useCallback((proposalId: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(proposalId)) {
				next.delete(proposalId)
			} else {
				next.add(proposalId)
			}
			return next
		})
	}, [])

	const handleAccept = useCallback(
		async (proposal: NDKGeoEditProposalEvent) => {
			await acceptProposal(proposal)
			onProposalAccepted?.()
		},
		[acceptProposal, onProposalAccepted],
	)

	const handleReject = useCallback(
		async (proposal: NDKGeoEditProposalEvent, reason: string) => {
			await rejectProposal(proposal, reason.trim() || undefined)
		},
		[rejectProposal],
	)

	const handleRejectWithoutReason = useCallback(
		async (proposal: NDKGeoEditProposalEvent) => {
			await rejectProposal(proposal)
		},
		[rejectProposal],
	)

	if (!target) {
		return (
			<div className={`p-4 text-center text-sm text-gray-500 ${className}`}>
				Select a dataset to view edit proposals.
			</div>
		)
	}

	const openProposals = proposals.filter((p) => p.status === 'open')
	const resolvedProposals = proposals.filter((p) => p.status !== 'open')

	return (
		<div className={`flex flex-col h-full ${className}`}>
			{/* Header */}
			<div className="flex-shrink-0 border-b border-gray-100 pb-3 mb-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0">
						<GitPullRequest className="h-4 w-4 text-gray-400 flex-shrink-0" />
						<h3 className="text-sm font-semibold text-gray-800">Edit Proposals</h3>
					</div>
					{openCount > 0 && (
						<span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
							{openCount} open
						</span>
					)}
				</div>
			</div>

			{/* Proposals list */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{isLoading && proposals.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-sm text-gray-500">
						<RefreshCw className="h-4 w-4 animate-spin mr-2" />
						Loading proposals...
					</div>
				) : proposals.length === 0 ? (
					<div className="text-center py-8 text-sm text-gray-500">
						<GitPullRequest className="h-8 w-8 mx-auto mb-2 text-gray-300" />
						<p>No edit proposals</p>
						<p className="text-xs mt-1">Others can propose changes to this dataset.</p>
					</div>
				) : (
					<div className="space-y-2">
						{/* Open proposals */}
						{openProposals.map((pw) => {
							const id = pw.proposal.id ?? pw.proposal.proposalId ?? ''
							return (
								<ProposalCard
									key={id}
									proposalWithStatus={pw}
									isOwner={isOwner}
									isExpanded={expandedIds.has(id)}
									isOverlayVisible={visibleProposalIds.has(id)}
									onToggleExpanded={() => toggleExpanded(id)}
									onToggleOverlay={() =>
										onToggleProposalOverlay?.(pw.proposal, !visibleProposalIds.has(id))
									}
									onAccept={() => handleAccept(pw.proposal)}
									onRequestChanges={(reason) => handleReject(pw.proposal, reason)}
									onReject={() => handleRejectWithoutReason(pw.proposal)}
								/>
							)
						})}

						{/* Resolved proposals */}
						{resolvedProposals.length > 0 && (
							<>
								{openProposals.length > 0 && (
									<div className="border-t border-gray-100 pt-2 mt-2">
										<span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
											Resolved
										</span>
									</div>
								)}
								{resolvedProposals.map((pw) => {
									const id = pw.proposal.id ?? pw.proposal.proposalId ?? ''
									return (
										<ProposalCard
											key={id}
											proposalWithStatus={pw}
											isOwner={isOwner}
											isExpanded={expandedIds.has(id)}
											isOverlayVisible={visibleProposalIds.has(id)}
											onToggleExpanded={() => toggleExpanded(id)}
											onToggleOverlay={() =>
												onToggleProposalOverlay?.(pw.proposal, !visibleProposalIds.has(id))
											}
											onAccept={() => handleAccept(pw.proposal)}
											onRequestChanges={(reason) => handleReject(pw.proposal, reason)}
											onReject={() => handleRejectWithoutReason(pw.proposal)}
										/>
									)
								})}
							</>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
