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
	acceptProposal: (proposal: NDKGeoEditProposalEvent) => Promise<void>
	/** Reject a proposal with optional reason */
	rejectProposal: (proposal: NDKGeoEditProposalEvent, reason?: string) => Promise<void>
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
		return proposalEvents
			.filter((e: NDKEvent) => e.kind === GEO_EDIT_PROPOSAL_KIND)
			.map((e: NDKEvent) => NDKGeoEditProposalEvent.from(e))
			.sort(
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
		return typedProposals.map((proposal) => {
			const address = proposal.proposalCoordinate
			const statusInfo = address ? getLatestProposalStatus(statusEvents, address) : undefined

			return {
				proposal,
				status: statusInfo?.status ?? 'open',
				statusInfo,
			}
		})
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
