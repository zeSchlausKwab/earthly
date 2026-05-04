import NDK, { NDKEvent, type NDKSigner } from '@/lib/ndk-shim'
import {
	PROPOSAL_STATUS_OPEN_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
} from './kinds'
import type { NDKGeoEditProposalEvent } from './NDKGeoEditProposalEvent'
import { publish } from '../nostr'

export type ProposalStatus = 'open' | 'applied' | 'closed' | 'draft'
export type ProposalReviewState = 'open' | 'accepted' | 'needs_changes' | 'rejected' | 'draft'

export interface ProposalStatusInfo {
	status: ProposalStatus
	event: NDKEvent
	reason?: string
}

const STATUS_EVENT_PRECEDENCE: Record<ProposalStatus, number> = {
	applied: 4,
	closed: 3,
	open: 2,
	draft: 1,
}

const STATUS_KIND_MAP: Record<number, ProposalStatus> = {
	[PROPOSAL_STATUS_OPEN_KIND]: 'open',
	[PROPOSAL_STATUS_APPLIED_KIND]: 'applied',
	[PROPOSAL_STATUS_CLOSED_KIND]: 'closed',
	[PROPOSAL_STATUS_DRAFT_KIND]: 'draft',
}

const STATUS_TO_KIND: Record<ProposalStatus, number> = {
	open: PROPOSAL_STATUS_OPEN_KIND,
	applied: PROPOSAL_STATUS_APPLIED_KIND,
	closed: PROPOSAL_STATUS_CLOSED_KIND,
	draft: PROPOSAL_STATUS_DRAFT_KIND,
}

/**
 * Creates and publishes a status event for a proposal.
 * Status events use NIP-34 kinds (1630-1633) with `a` and `e` tags
 * pointing to the proposal.
 */
export async function createProposalStatusEvent(
	ndk: NDK,
	proposal: NDKGeoEditProposalEvent,
	status: ProposalStatus,
	reason?: string,
	signer?: NDKSigner,
): Promise<NDKEvent> {
	const kind = STATUS_TO_KIND[status]
	const proposalAddress = proposal.proposalCoordinate
	if (!proposalAddress) {
		throw new Error('Proposal must have a pubkey and d-tag to create a status event.')
	}

	const event = new NDKEvent(ndk)
	event.kind = kind
	event.content = reason ?? ''
	event.tags.push(['a', proposalAddress])
	if (proposal.id) {
		event.tags.push(['e', proposal.id])
	}
	// Tag the proposal author for notifications
	if (proposal.pubkey) {
		event.tags.push(['p', proposal.pubkey])
	}

	await event.sign(signer)
	await publish(event.rawEvent(), { routing: 'outbox' })
	return event
}

/**
 * Determines the latest status for a proposal from a set of status events.
 * Returns the most recent status event by `created_at`.
 */
export function getLatestProposalStatus(
	statusEvents: NDKEvent[],
	proposalAddress: string,
): ProposalStatusInfo | undefined {
	const matching = statusEvents.filter((event) => {
		const aTag = event.tags.find((t) => t[0] === 'a')?.[1]
		return aTag === proposalAddress
	})

	if (matching.length === 0) return undefined

	const latest = matching.reduce((newest, event) => {
		const newestCreatedAt = newest.created_at ?? 0
		const eventCreatedAt = event.created_at ?? 0
		if (eventCreatedAt !== newestCreatedAt) {
			return eventCreatedAt > newestCreatedAt ? event : newest
		}

		const newestStatus = STATUS_KIND_MAP[newest.kind as number]
		const eventStatus = STATUS_KIND_MAP[event.kind as number]
		const newestRank = newestStatus ? STATUS_EVENT_PRECEDENCE[newestStatus] : 0
		const eventRank = eventStatus ? STATUS_EVENT_PRECEDENCE[eventStatus] : 0
		if (eventRank !== newestRank) {
			return eventRank > newestRank ? event : newest
		}

		return event.id && newest.id ? (event.id > newest.id ? event : newest) : newest
	})

	const status = STATUS_KIND_MAP[latest.kind as number]
	if (!status) return undefined

	return {
		status,
		event: latest,
		reason: latest.content || undefined,
	}
}

export function getProposalReviewState(
	status: ProposalStatus,
	reason?: string | null,
): ProposalReviewState {
	if (status === 'applied') return 'accepted'
	if (status === 'draft') return 'draft'
	if (status === 'closed') {
		return reason?.trim() ? 'needs_changes' : 'rejected'
	}
	return 'open'
}

/**
 * Builds a Nostr filter for fetching status events for the given proposal addresses.
 */
export function buildStatusFilter(proposalAddresses: string[]) {
	if (proposalAddresses.length === 0) return null
	return {
		kinds: [
			PROPOSAL_STATUS_OPEN_KIND,
			PROPOSAL_STATUS_APPLIED_KIND,
			PROPOSAL_STATUS_CLOSED_KIND,
			PROPOSAL_STATUS_DRAFT_KIND,
		],
		'#a': proposalAddresses,
	}
}
