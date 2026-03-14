import { useNDK, useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent } from '@nostr-dev-kit/react'
import { useMemo, useState, useCallback } from 'react'
import { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'
import { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import {
	GEO_EDIT_PROPOSAL_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
} from '@/lib/ndk/kinds'
import {
	type ProposalStatus,
	type ProposalStatusInfo,
	getProposalReviewState,
	getLatestProposalStatus,
	createProposalStatusEvent,
} from '@/lib/ndk/proposalStatus'

export interface ProposalWithStatus {
	proposal: NDKGeoEditProposalEvent
	status: ProposalStatus
	statusInfo?: ProposalStatusInfo
}

export interface UseGeoProposalsOptions {
	/** The dataset to fetch edit proposals for */
	target: NDKGeoEvent | null
}

export interface UseGeoProposalsResult {
	/** Proposals with their current status */
	proposals: ProposalWithStatus[]
	/** Number of open proposals */
	openCount: number
	/** Loading state */
	isLoading: boolean
	/** Accept a proposal — republishes the target dataset with proposed content */
	acceptProposal: (proposal: NDKGeoEditProposalEvent) => Promise<NDKGeoEvent>
	/** Reject a proposal with optional reason */
	rejectProposal: (proposal: NDKGeoEditProposalEvent, reason?: string) => Promise<void>
}

function getSemanticProposalKey(proposal: NDKGeoEditProposalEvent): string {
	return [
		proposal.targetAddress ?? '',
		proposal.pubkey ?? '',
		proposal.baseVersion ?? '',
		proposal.description?.trim().toLowerCase() ?? '',
		proposal.content,
	].join('|')
}

function getProposalSortTimestamp(proposal: ProposalWithStatus): number {
	return proposal.statusInfo?.event.created_at ?? proposal.proposal.created_at ?? 0
}

function getProposalDisplayPriority(proposal: ProposalWithStatus): number {
	const reviewState = getProposalReviewState(proposal.status, proposal.statusInfo?.reason)
	switch (reviewState) {
		case 'accepted':
			return 5
		case 'open':
			return 4
		case 'needs_changes':
			return 3
		case 'rejected':
			return 2
		case 'draft':
			return 1
		default:
			return 0
	}
}

/**
 * Hook for fetching and managing edit proposals on geo datasets.
 * Two-stage subscription: proposals first, then status events.
 */
export function useGeoProposals({ target }: UseGeoProposalsOptions): UseGeoProposalsResult {
	const { ndk } = useNDK()
	const [isActing, setIsActing] = useState(false)

	// Stage 1: Subscribe to proposals targeting this dataset
	const proposalFilters = useMemo(() => {
		if (!target) return false

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag

		if (!targetKind || !targetPubkey || !targetDTag) return false

		const address = `${targetKind}:${targetPubkey}:${targetDTag}`

		return [
			{
				kinds: [GEO_EDIT_PROPOSAL_KIND],
				'#a': [address],
			},
		]
	}, [target])

	const { events: proposalEvents, eose: proposalEose } = useSubscribe(proposalFilters)

	// Convert to typed proposal events
	const typedProposals = useMemo(() => {
		const deduped = new Map<string, NDKGeoEditProposalEvent>()

		proposalEvents
			.filter((e: NDKEvent) => e.kind === GEO_EDIT_PROPOSAL_KIND)
			.map((e: NDKEvent) => NDKGeoEditProposalEvent.from(e))
			.forEach((proposal) => {
				const stableKey =
					proposal.proposalCoordinate ??
					proposal.id ??
					`${proposal.pubkey}:${proposal.proposalId ?? proposal.created_at ?? 0}`
				const existing = deduped.get(stableKey)
				if (!existing || (proposal.created_at ?? 0) > (existing.created_at ?? 0)) {
					deduped.set(stableKey, proposal)
				}
			})

		return Array.from(deduped.values()).sort(
			(a: NDKGeoEditProposalEvent, b: NDKGeoEditProposalEvent) =>
				(b.created_at ?? 0) - (a.created_at ?? 0),
		)
	}, [proposalEvents])

	// Stage 2: Subscribe to status events for all proposals
	const statusFilters = useMemo(() => {
		if (typedProposals.length === 0) return false

		const proposalAddresses = typedProposals
			.map((p) => p.proposalCoordinate)
			.filter((addr): addr is string => !!addr)

		if (proposalAddresses.length === 0) return false

		return [
			{
				kinds: [
					PROPOSAL_STATUS_OPEN_KIND,
					PROPOSAL_STATUS_APPLIED_KIND,
					PROPOSAL_STATUS_CLOSED_KIND,
					PROPOSAL_STATUS_DRAFT_KIND,
				],
				'#a': proposalAddresses,
			},
		]
	}, [typedProposals])

	const { events: statusEvents, eose: statusEose } = useSubscribe(statusFilters)

	// Merge proposals with their latest status
	const proposals = useMemo<ProposalWithStatus[]>(() => {
		const proposalsWithStatus = typedProposals.map((proposal) => {
			const address = proposal.proposalCoordinate
			const statusInfo = address ? getLatestProposalStatus(statusEvents, address) : undefined

			return {
				proposal,
				status: statusInfo?.status ?? 'open',
				statusInfo,
			}
		})
		const deduped = new Map<string, ProposalWithStatus>()

		for (const proposal of proposalsWithStatus) {
			const key = getSemanticProposalKey(proposal.proposal)
			const existing = deduped.get(key)
			if (!existing) {
				deduped.set(key, proposal)
				continue
			}

			const proposalTimestamp = getProposalSortTimestamp(proposal)
			const existingTimestamp = getProposalSortTimestamp(existing)
			if (proposalTimestamp !== existingTimestamp) {
				if (proposalTimestamp > existingTimestamp) {
					deduped.set(key, proposal)
				}
				continue
			}

			if (getProposalDisplayPriority(proposal) > getProposalDisplayPriority(existing)) {
				deduped.set(key, proposal)
			}
		}

		return Array.from(deduped.values()).sort(
			(a, b) => getProposalSortTimestamp(b) - getProposalSortTimestamp(a),
		)
	}, [typedProposals, statusEvents])

	const openCount = useMemo(() => proposals.filter((p) => p.status === 'open').length, [proposals])

	const acceptProposal = useCallback(
		async (proposal: NDKGeoEditProposalEvent) => {
			if (!ndk || !target) {
				throw new Error('NDK or target not available')
			}

			setIsActing(true)
			try {
				// Create new NDKGeoEvent with proposal's content
				const updatedDataset = new NDKGeoEvent(ndk)
				updatedDataset.featureCollection = proposal.featureCollection

				// Carry forward target's metadata
				updatedDataset.hashtags = target.hashtags
				updatedDataset.collectionReferences = target.collectionReferences
				updatedDataset.contextReferences = target.contextReferences
				updatedDataset.relayHints = target.relayHints

				// Publish as update to existing dataset (preserves d-tag lineage)
				await updatedDataset.publishUpdate(target)

				// Publish "applied" status
				await createProposalStatusEvent(ndk, proposal, 'applied')
				return updatedDataset
			} finally {
				setIsActing(false)
			}
		},
		[ndk, target],
	)

	const rejectProposal = useCallback(
		async (proposal: NDKGeoEditProposalEvent, reason?: string) => {
			if (!ndk) {
				throw new Error('NDK not available')
			}

			setIsActing(true)
			try {
				await createProposalStatusEvent(ndk, proposal, 'closed', reason)
			} finally {
				setIsActing(false)
			}
		},
		[ndk],
	)

	const isLoading =
		!proposalEose ||
		(typedProposals.length > 0 && statusFilters !== false && !statusEose) ||
		isActing

	return {
		proposals,
		openCount,
		isLoading,
		acceptProposal,
		rejectProposal,
	}
}
