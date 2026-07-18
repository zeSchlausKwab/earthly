import type { OutboxItemSummary } from '@/platform/contracts'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'

export interface OutboxSummaryCounts {
	waiting: number
	attention: number
	delivered: number
}

export interface OutboxPartitions {
	pending: OutboxItemSummary[]
	history: OutboxItemSummary[]
}

export const RETRYABLE_OUTBOX_STATES = new Set<OutboxItemSummary['state']>([
	'partial',
	'retryWait',
	'rejected',
])

export function summarizeOutbox(items: OutboxItemSummary[]): OutboxSummaryCounts {
	return items.reduce<OutboxSummaryCounts>(
		(summary, item) => {
			if (item.state === 'delivered') summary.delivered += 1
			else if (item.state === 'partial' || item.state === 'rejected') summary.attention += 1
			else if (item.state !== 'discarded') summary.waiting += 1
			return summary
		},
		{ waiting: 0, attention: 0, delivered: 0 },
	)
}

export function partitionOutbox(items: OutboxItemSummary[]): OutboxPartitions {
	const sorted = [...items].sort(
		(left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
	)
	return {
		pending: sorted.filter((item) => item.state !== 'delivered' && item.state !== 'discarded'),
		history: sorted.filter((item) => item.state === 'delivered'),
	}
}

export function outboxKindLabel(kind: number): string {
	switch (kind) {
		case GEO_EVENT_KIND:
			return 'Dataset'
		case GEO_COMMENT_KIND:
			return 'Comment'
		case MAP_CONTEXT_KIND:
			return 'Context'
		case GEO_EDIT_PROPOSAL_KIND:
			return 'Edit proposal'
		case ARTICLE_KIND:
			return 'Story'
		case TEMPORAL_SIGHTING_KIND:
			return 'Sighting'
		case 0:
			return 'Profile'
		case 1:
			return 'Note'
		case 3:
			return 'Contacts'
		case 10_002:
			return 'Relay list'
		default:
			return `Event kind ${kind}`
	}
}

export function relayAcknowledgementCount(item: OutboxItemSummary): number {
	return item.relays.filter((relay) => relay.state === 'acknowledged').length
}

export function canRetryOutboxItem(item: OutboxItemSummary): boolean {
	return RETRYABLE_OUTBOX_STATES.has(item.state)
}

export function canDiscardOutboxItem(item: OutboxItemSummary): boolean {
	return (
		item.state === 'queued' ||
		item.state === 'partial' ||
		item.state === 'retryWait' ||
		item.state === 'rejected'
	)
}
