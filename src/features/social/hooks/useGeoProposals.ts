import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'nostr-tools'
import { useMemo, useState, useCallback } from 'react'
import { accounts, eventStore, publish } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GeoProposal } from '@/lib/nostr/geo-proposal'
import { GeoDataset, GeoDatasetFactory } from '@/lib/nostr/geo-event'
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
} from '@/lib/nostr/geo-proposal'

export interface ProposalWithStatus {
	proposal: GeoProposal
	status: ProposalStatus
	statusInfo?: ProposalStatusInfo
}

export interface UseGeoProposalsOptions {
	/** The dataset to fetch edit proposals for */
	target: GeoDataset | null
}

export interface UseGeoProposalsResult {
	/** Proposals with their current status */
	proposals: ProposalWithStatus[]
	/** Number of open proposals */
	openCount: number
	/** Loading state */
	isLoading: boolean
	/** Accept a proposal — republishes the target dataset with proposed content */
	acceptProposal: (proposal: GeoProposal) => Promise<GeoDataset>
	/** Reject a proposal with optional reason */
	rejectProposal: (proposal: GeoProposal, reason?: string) => Promise<void>
}

function getSemanticProposalKey(proposal: GeoProposal): string {
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
	const [isActing, setIsActing] = useState(false)

	// Stage 1: Subscribe to proposals targeting this dataset
	const proposalFilters = useMemo(() => {
		if (!target) return null

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag

		if (!targetKind || !targetPubkey || !targetDTag) return null

		const address = `${targetKind}:${targetPubkey}:${targetDTag}`

		return [
			{
				kinds: [GEO_EDIT_PROPOSAL_KIND],
				'#a': [address],
			},
		]
	}, [target])

	const { events: proposalEvents, eose: proposalEose } = useTimelineWithEose(proposalFilters)

	// Convert to typed proposal events
	const typedProposals = useMemo(() => {
		const deduped = new Map<string, GeoProposal>()

		proposalEvents
			.filter((e) => e.kind === GEO_EDIT_PROPOSAL_KIND)
			.map((e) => castEvent(e, GeoProposal, eventStore))
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
			(a: GeoProposal, b: GeoProposal) =>
				(b.created_at ?? 0) - (a.created_at ?? 0),
		)
	}, [proposalEvents])

	// Stage 2: Subscribe to status events for all proposals
	const statusFilters = useMemo(() => {
		if (typedProposals.length === 0) return null

		const proposalAddresses = typedProposals
			.map((p) => p.proposalCoordinate)
			.filter((addr): addr is string => !!addr)

		if (proposalAddresses.length === 0) return null

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

	const { events: statusEvents, eose: statusEose } = useTimelineWithEose(statusFilters)

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
		async (proposal: GeoProposal) => {
			if (!target) throw new Error('No target')
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			setIsActing(true)
			try {
				// Build a new dataset version that adopts the proposal's content
				// while preserving the target's metadata + d-tag lineage.
				const signedEvent = await GeoDatasetFactory.update(target.event, proposal.featureCollection)
					.hashtags(target.hashtags)
					.collectionReferences(target.collectionReferences)
					.contextReferences(target.contextReferences)
					.relayHints(target.relayHints)
					.withDerivedMetadata()
					.sign(signer)

				await publish(signedEvent, { routing: 'outbox' })
				const updatedDataset = castEvent(signedEvent, GeoDataset, eventStore)

				// Publish the "applied" status event for the proposal.
				await createProposalStatusEvent(proposal, 'applied', signer)
				return updatedDataset
			} finally {
				setIsActing(false)
			}
		},
		[target],
	)

	const rejectProposal = useCallback(
		async (proposal: GeoProposal, reason?: string) => {
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			setIsActing(true)
			try {
				await createProposalStatusEvent(proposal, 'closed', signer, reason)
			} finally {
				setIsActing(false)
			}
		},
		[],
	)

	const isLoading =
		!proposalEose ||
		(typedProposals.length > 0 && statusFilters !== null && !statusEose) ||
		isActing

	return {
		proposals,
		openCount,
		isLoading,
		acceptProposal,
		rejectProposal,
	}
}
