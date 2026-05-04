/**
 * Status events for Geo Edit Proposals (NIP-34 kinds 1630–1633, reused).
 *
 * The dataset owner publishes a status event to declare a proposal as
 * `open`, `applied`, `closed`, or `draft`. Each status event references the
 * proposal via an `a` tag (proposal coordinate) and an `e` tag (proposal id).
 */

import { EventFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import {
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
} from '@/lib/ndk/kinds'
import { publish } from '..'

export type ProposalStatus = 'open' | 'applied' | 'closed' | 'draft'
export type ProposalReviewState = 'open' | 'accepted' | 'needs_changes' | 'rejected' | 'draft'

export interface ProposalStatusInfo {
	status: ProposalStatus
	event: NostrEvent
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

/** Minimal interface for a proposal that can have a status event published against it. */
export interface ProposalLike {
	/** `37519:<author-pubkey>:<proposal-d-tag>` */
	proposalCoordinate?: string
	id?: string
	pubkey?: string
}

/**
 * Build, sign and publish a status event for a proposal. Returns the signed
 * NostrEvent. Routes via the proposal author's outboxes (with the dev-mode
 * fallback to `config.relayUrls`).
 */
export async function createProposalStatusEvent(
	proposal: ProposalLike,
	status: ProposalStatus,
	signer: EventSigner,
	reason?: string,
): Promise<NostrEvent> {
	const proposalAddress = proposal.proposalCoordinate
	if (!proposalAddress) {
		throw new Error('Proposal must have a pubkey and d-tag to create a status event.')
	}
	const kind = STATUS_TO_KIND[status]

	const tags: string[][] = [['a', proposalAddress]]
	if (proposal.id) tags.push(['e', proposal.id])
	if (proposal.pubkey) tags.push(['p', proposal.pubkey])

	const event = await EventFactory.fromKind(kind)
		.content(reason ?? '')
		.modifyPublicTags(() => tags)
		.sign(signer)

	await publish(event as NostrEvent, { routing: 'outbox' })
	return event as NostrEvent
}

/** Pick the most recent status event for a given proposal coordinate. */
export function getLatestProposalStatus(
	statusEvents: NostrEvent[],
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

/** Build a Nostr filter for fetching status events for the given proposal addresses. */
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
