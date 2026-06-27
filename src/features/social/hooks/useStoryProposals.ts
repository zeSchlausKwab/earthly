/**
 * useStoryProposals (STORY-06) — the Story-narrative analog of {@link useGeoProposals}.
 *
 * Subscribes to kind-37519 proposals whose `#a` is a Story's `37520:<owner>:<d>`
 * coordinate, surfaces each with its latest status, and lets the Story author
 * accept or reject. The ONLY substantive difference from the dataset hook is the
 * accept path: instead of republishing a FeatureCollection via
 * `GeoDatasetFactory.update`, accept routes through the Plan-01 `editStory` path,
 * passing the proposal's Markdown body as the new Story content — so the body's
 * `a` tags re-derive (STORY-03) and the `d`-tag lineage is preserved (STORY-04).
 * No phantom `a` tag or forked lineage can be injected by an accepted proposal
 * (T-10-12).
 *
 * The proposal `content` is read defensively as a raw string
 * (`getProposalMarkdownContent`, never throws — T-10-14); the target kind is read
 * off the `a` coordinate alone (no spec discriminator — SPEC.md §17). The
 * dataset proposal path (`useGeoProposals`) is left entirely untouched.
 */

import { castEvent } from 'applesauce-core/casts'
import { useCallback, useMemo, useState } from 'react'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import { accounts, eventStore } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import type { Article } from '@/lib/nostr/article'
import {
	GeoProposal,
	createProposalStatusEvent,
	getLatestProposalStatus,
	type ProposalStatus,
	type ProposalStatusInfo,
} from '@/lib/nostr/geo-proposal'
import {
	GEO_EDIT_PROPOSAL_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
} from '@/lib/nostr/kinds'
import { acceptStoryProposalImpl } from './acceptStoryProposal'

export { acceptStoryProposalImpl }

export interface StoryProposalWithStatus {
	proposal: GeoProposal
	status: ProposalStatus
	statusInfo?: ProposalStatusInfo
}

export interface UseStoryProposalsOptions {
	/** The Story to fetch narrative-edit proposals for. */
	target: Article | null
}

export interface UseStoryProposalsResult {
	proposals: StoryProposalWithStatus[]
	openCount: number
	isLoading: boolean
	/** Accept a proposal — republishes the Story in place via `editStory`. */
	acceptStoryProposal: (proposal: GeoProposal) => Promise<void>
	/** Reject a proposal with an optional reason. */
	rejectStoryProposal: (proposal: GeoProposal, reason?: string) => Promise<void>
}

export function useStoryProposals({ target }: UseStoryProposalsOptions): UseStoryProposalsResult {
	const [isActing, setIsActing] = useState(false)

	// Stage 1: proposals targeting this Story coordinate.
	const proposalFilters = useMemo(() => {
		if (!target) return null
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag
		if (!target.kind || !targetPubkey || !targetDTag) return null
		const address = `${target.kind}:${targetPubkey}:${targetDTag}`
		return [{ kinds: [GEO_EDIT_PROPOSAL_KIND], '#a': [address] }]
	}, [target])

	const { events: proposalEvents, eose: proposalEose } = useTimelineWithEose(proposalFilters)

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
		return Array.from(deduped.values()).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [proposalEvents])

	// Stage 2: status events for those proposals.
	const statusFilters = useMemo(() => {
		if (typedProposals.length === 0) return null
		const addresses = typedProposals
			.map((p) => p.proposalCoordinate)
			.filter((addr): addr is string => !!addr)
		if (addresses.length === 0) return null
		return [
			{
				kinds: [
					PROPOSAL_STATUS_OPEN_KIND,
					PROPOSAL_STATUS_APPLIED_KIND,
					PROPOSAL_STATUS_CLOSED_KIND,
					PROPOSAL_STATUS_DRAFT_KIND,
				],
				'#a': addresses,
			},
		]
	}, [typedProposals])

	const { events: statusEvents, eose: statusEose } = useTimelineWithEose(statusFilters)

	const proposals = useMemo<StoryProposalWithStatus[]>(() => {
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

	const acceptStoryProposal = useCallback(
		async (proposal: GeoProposal) => {
			if (!target) throw new Error('No target')
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')
			setIsActing(true)
			try {
				await acceptStoryProposalImpl(target.rawEvent(), proposal.rawEvent(), signer as SignerLike)
			} finally {
				setIsActing(false)
			}
		},
		[target],
	)

	const rejectStoryProposal = useCallback(async (proposal: GeoProposal, reason?: string) => {
		const signer = accounts.signer
		if (!signer) throw new Error('No active account')
		setIsActing(true)
		try {
			await createProposalStatusEvent(proposal, 'closed', signer, reason)
		} finally {
			setIsActing(false)
		}
	}, [])

	const isLoading =
		!proposalEose ||
		(typedProposals.length > 0 && statusFilters !== null && !statusEose) ||
		isActing

	return {
		proposals,
		openCount,
		isLoading,
		acceptStoryProposal,
		rejectStoryProposal,
	}
}
