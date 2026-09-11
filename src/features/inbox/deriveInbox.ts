import type { Filter, NostrEvent } from 'nostr-tools'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { getCommentText, getCommentThreading, getCommentId } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { getProposalDescription, getProposalTargetAddress } from '@/lib/nostr/geo-proposal'
import type { InboxEntityKind, InboxEntityTarget, InboxFilter, InboxItem } from './types'

const FOLLOW_KIND = 3
const REACTION_KIND = 7
const ZAP_RECEIPT_KIND = 9735

const STATUS_KINDS = new Set([PROPOSAL_STATUS_APPLIED_KIND, PROPOSAL_STATUS_CLOSED_KIND])

interface CoordinateParts {
	kind: number
	pubkey: string
	identifier: string
}

export interface DeriveInboxOptions {
	currentUserPubkey: string
	events: readonly NostrEvent[]
	geoEvents: readonly GeoDataset[]
	mapContextEvents: readonly MapContext[]
	getDatasetName: (event: GeoDataset) => string
}

function firstTag(event: NostrEvent, name: string): string | undefined {
	return event.tags.find((tag) => tag[0] === name)?.[1]
}

export function parseInboxCoordinate(value: string | undefined): CoordinateParts | null {
	if (!value) return null
	const firstSeparator = value.indexOf(':')
	const secondSeparator = value.indexOf(':', firstSeparator + 1)
	if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null
	const kind = Number.parseInt(value.slice(0, firstSeparator), 10)
	const pubkey = value.slice(firstSeparator + 1, secondSeparator)
	const identifier = value.slice(secondSeparator + 1)
	if (!Number.isInteger(kind) || !pubkey || !identifier) return null
	return { kind, pubkey, identifier }
}

function entityKindForProtocolKind(kind: number): InboxEntityKind | null {
	switch (kind) {
		case GEO_EVENT_KIND:
			return 'map'
		case MAP_CONTEXT_KIND:
			return 'atlas'
		case ARTICLE_KIND:
			return 'story'
		case TEMPORAL_SIGHTING_KIND:
			return 'sighting'
		case LIVE_BEACON_KIND:
			return 'live'
		default:
			return null
	}
}

function entityTarget(
	coordinate: string | undefined,
	tab: InboxEntityTarget['tab'],
	commentId?: string,
): InboxEntityTarget | undefined {
	const parsed = parseInboxCoordinate(coordinate)
	if (!parsed) return undefined
	const entityKind = entityKindForProtocolKind(parsed.kind)
	if (!entityKind) return undefined
	return { type: 'entity', entityKind, coordinate: coordinate as string, tab, commentId }
}

function humanizeIdentifier(identifier: string): string {
	const decoded = (() => {
		try {
			return decodeURIComponent(identifier)
		} catch {
			return identifier
		}
	})()
	const spaced = decoded.replaceAll(/[-_]+/g, ' ').trim()
	return spaced || 'Untitled'
}

function datasetCoordinate(event: GeoDataset): string | undefined {
	const identifier = event.datasetId ?? event.dTag
	return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : undefined
}

function buildEntityLabels(
	geoEvents: readonly GeoDataset[],
	mapContextEvents: readonly MapContext[],
	getDatasetName: (event: GeoDataset) => string,
): Map<string, string> {
	const labels = new Map<string, string>()
	for (const event of geoEvents) {
		const coordinate = datasetCoordinate(event)
		if (coordinate) labels.set(coordinate, getDatasetName(event))
	}
	for (const context of mapContextEvents) {
		const coordinate = context.contextCoordinate
		if (!coordinate) continue
		labels.set(coordinate, context.context.name || context.contextId || 'Untitled atlas')
	}
	return labels
}

function entityLabel(coordinate: string | undefined, labels: Map<string, string>): string {
	if (!coordinate) return 'your work'
	const known = labels.get(coordinate)
	if (known) return known
	const parsed = parseInboxCoordinate(coordinate)
	if (!parsed) return 'your work'
	const prefix =
		parsed.kind === MAP_CONTEXT_KIND
			? 'Atlas'
			: parsed.kind === ARTICLE_KIND
				? 'Story'
				: parsed.kind === TEMPORAL_SIGHTING_KIND
					? 'Sighting'
					: parsed.kind === LIVE_BEACON_KIND
						? 'Live map'
						: 'Map'
	return `${prefix} “${humanizeIdentifier(parsed.identifier)}”`
}

function previewText(value: string | undefined, maxLength = 120): string | undefined {
	const compact = value?.replaceAll(/\s+/g, ' ').trim()
	if (!compact) return undefined
	return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`
}

function proposalCoordinate(event: NostrEvent): string | undefined {
	const identifier = firstTag(event, 'd')
	return identifier ? `${GEO_EDIT_PROPOSAL_KIND}:${event.pubkey}:${identifier}` : undefined
}

function zapActorPubkey(event: NostrEvent): string {
	const description = firstTag(event, 'description')
	if (description) {
		try {
			const request = JSON.parse(description) as { pubkey?: unknown }
			if (typeof request.pubkey === 'string' && request.pubkey) return request.pubkey
		} catch {
			// A malformed zap request remains a notification attributed to the receipt signer.
		}
	}
	return event.pubkey
}

function deriveDirectedItem(
	event: NostrEvent,
	currentUserPubkey: string,
	labels: Map<string, string>,
	proposalByCoordinate: Map<string, NostrEvent>,
): InboxItem | null {
	if (event.pubkey === currentUserPubkey) return null

	if (event.kind === GEO_EDIT_PROPOSAL_KIND) {
		const targetAddress = getProposalTargetAddress(event)
		const target = parseInboxCoordinate(targetAddress)
		// The target coordinate, not the advisory `p` routing tag, establishes
		// ownership. This prevents an unrelated proposal from becoming Inbox spam
		// merely by tagging the account.
		if (target?.pubkey !== currentUserPubkey) return null
		return {
			id: `proposal:${event.id}`,
			eventId: event.id,
			kind: 'proposal',
			category: 'proposals',
			actorPubkey: event.pubkey,
			createdAt: event.created_at,
			action: 'proposed changes to',
			thingLabel: entityLabel(targetAddress, labels),
			preview: previewText(getProposalDescription(event)),
			target: entityTarget(targetAddress, 'details'),
		}
	}

	if (STATUS_KINDS.has(event.kind)) {
		const referencedProposal = proposalByCoordinate.get(firstTag(event, 'a') ?? '')
		if (referencedProposal?.pubkey !== currentUserPubkey) return null
		const targetAddress = getProposalTargetAddress(referencedProposal)
		const target = parseInboxCoordinate(targetAddress)
		// Only the owner of the proposed-against object can author its meaningful
		// acceptance/closure notification.
		if (!target || target.pubkey !== event.pubkey) return null
		const accepted = event.kind === PROPOSAL_STATUS_APPLIED_KIND
		return {
			id: `${accepted ? 'accepted' : 'declined'}:${event.id}`,
			eventId: event.id,
			kind: accepted ? 'accepted' : 'declined',
			category: 'proposals',
			actorPubkey: event.pubkey,
			createdAt: event.created_at,
			action: accepted ? 'accepted your proposal for' : 'closed your proposal for',
			thingLabel: entityLabel(targetAddress, labels),
			preview: previewText(event.content),
			target: entityTarget(targetAddress, 'details'),
		}
	}

	if (event.kind === GEO_COMMENT_KIND) {
		const threading = getCommentThreading(event)
		const targetAddress = threading.rootAddress
		const directlyAddressesUser = event.tags.some(
			(tag) => (tag[0] === 'p' || tag[0] === 'P') && tag[1] === currentUserPubkey,
		)
		if (!directlyAddressesUser) return null
		const isDirectReply =
			threading.parentKind === String(GEO_COMMENT_KIND) &&
			threading.parentPubkey === currentUserPubkey
		const isOnOwnedEntity = threading.rootPubkey === currentUserPubkey
		const kind = isDirectReply || isOnOwnedEntity ? 'reply' : 'mention'
		return {
			id: `${kind}:${event.id}`,
			eventId: event.id,
			kind,
			category: 'replies',
			actorPubkey: event.pubkey,
			createdAt: event.created_at,
			action: isDirectReply ? 'replied on' : isOnOwnedEntity ? 'commented on' : 'mentioned you in',
			thingLabel: entityLabel(targetAddress, labels),
			preview: previewText(getCommentText(event)),
			target: entityTarget(targetAddress, 'comments', getCommentId(event)),
		}
	}

	if (event.kind === FOLLOW_KIND) {
		if (!event.tags.some((tag) => tag[0] === 'p' && tag[1] === currentUserPubkey)) return null
		return {
			id: `follow:${event.id}`,
			eventId: event.id,
			kind: 'follow',
			category: 'activity',
			actorPubkey: event.pubkey,
			createdAt: event.created_at,
			action: 'followed',
			thingLabel: 'you',
			target: { type: 'person', pubkey: event.pubkey },
		}
	}

	if (event.kind === REACTION_KIND || event.kind === ZAP_RECEIPT_KIND) {
		if (!event.tags.some((tag) => tag[0] === 'p' && tag[1] === currentUserPubkey)) return null
		const targetAddress = firstTag(event, 'a')
		const isZap = event.kind === ZAP_RECEIPT_KIND
		const actorPubkey = isZap ? zapActorPubkey(event) : event.pubkey
		if (actorPubkey === currentUserPubkey) return null
		return {
			id: `${isZap ? 'zap' : 'reaction'}:${event.id}`,
			eventId: event.id,
			kind: isZap ? 'zap' : 'reaction',
			category: 'activity',
			actorPubkey,
			createdAt: event.created_at,
			action: isZap ? 'zapped' : 'reacted to',
			thingLabel: entityLabel(targetAddress, labels),
			preview: !isZap ? previewText(event.content) : undefined,
			target: entityTarget(targetAddress, 'details'),
		}
	}

	return null
}

function deriveAtlasArrivals(
	event: NostrEvent,
	currentUserPubkey: string,
	ownedAtlases: Map<string, MapContext>,
	labels: Map<string, string>,
	getDatasetName: (event: GeoDataset) => string,
	geoEvents: readonly GeoDataset[],
): InboxItem[] {
	if (event.kind !== GEO_EVENT_KIND || event.pubkey === currentUserPubkey) return []
	const identifier = firstTag(event, 'd')
	if (!identifier) return []
	const mapCoordinate = `${GEO_EVENT_KIND}:${event.pubkey}:${identifier}`
	const dataset = geoEvents.find((candidate) => datasetCoordinate(candidate) === mapCoordinate)
	const mapLabel = dataset ? getDatasetName(dataset) : entityLabel(mapCoordinate, labels)
	const references = event.tags
		.filter((tag) => tag[0] === 'c' && typeof tag[1] === 'string')
		.map((tag) => tag[1] as string)

	return references.flatMap((atlasCoordinate) => {
		const atlas = ownedAtlases.get(atlasCoordinate)
		if (!atlas || atlas.referencedAddresses.includes(mapCoordinate)) return []
		return [
			{
				id: `atlas-arrival:${event.id}:${atlasCoordinate}`,
				eventId: event.id,
				kind: 'atlas-arrival' as const,
				category: 'activity' as const,
				actorPubkey: event.pubkey,
				createdAt: event.created_at,
				action: `added ${mapLabel} to`,
				thingLabel: labels.get(atlasCoordinate) ?? 'your atlas',
				target: entityTarget(atlasCoordinate, 'details'),
			},
		]
	})
}

/**
 * Build the Inbox from events the app already reads. No notification event is
 * published, and the same source event always yields the same notification id.
 */
export function deriveInboxItems({
	currentUserPubkey,
	events,
	geoEvents,
	mapContextEvents,
	getDatasetName,
}: DeriveInboxOptions): InboxItem[] {
	if (!currentUserPubkey) return []
	const labels = buildEntityLabels(geoEvents, mapContextEvents, getDatasetName)
	const ownedAtlases = new Map(
		mapContextEvents
			.filter((context) => context.pubkey === currentUserPubkey && context.contextCoordinate)
			.map((context) => [context.contextCoordinate as string, context]),
	)
	const proposalByCoordinate = new Map<string, NostrEvent>()
	for (const event of events) {
		if (event.kind !== GEO_EDIT_PROPOSAL_KIND) continue
		const coordinate = proposalCoordinate(event)
		if (coordinate) proposalByCoordinate.set(coordinate, event)
	}

	const items: InboxItem[] = []
	for (const event of events) {
		const directed = deriveDirectedItem(event, currentUserPubkey, labels, proposalByCoordinate)
		if (directed) items.push(directed)
		items.push(
			...deriveAtlasArrivals(
				event,
				currentUserPubkey,
				ownedAtlases,
				labels,
				getDatasetName,
				geoEvents,
			),
		)
	}

	return items.sort((left, right) => {
		if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
		return left.id.localeCompare(right.id)
	})
}

export function filterInboxItems<T extends InboxItem>(
	items: readonly T[],
	filter: InboxFilter,
): T[] {
	if (filter === 'all') return [...items]
	return items.filter((item) => item.category === filter)
}

/** The relay queries required to derive a signed-in account's Inbox. */
export function buildInboxFilters(
	currentUserPubkey: string | undefined,
	ownedAtlasCoordinates: readonly string[],
): Filter[] | null {
	if (!currentUserPubkey) return null
	const filters: Filter[] = [
		{
			kinds: [
				GEO_COMMENT_KIND,
				GEO_EDIT_PROPOSAL_KIND,
				PROPOSAL_STATUS_APPLIED_KIND,
				PROPOSAL_STATUS_CLOSED_KIND,
				FOLLOW_KIND,
				REACTION_KIND,
				ZAP_RECEIPT_KIND,
			],
			'#p': [currentUserPubkey],
			limit: 500,
		},
		// Status events refer to a proposal coordinate. Fetching the account's own
		// proposals lets the client resolve that coordinate back to its Map/Story.
		{ kinds: [GEO_EDIT_PROPOSAL_KIND], authors: [currentUserPubkey], limit: 250 },
	]
	if (ownedAtlasCoordinates.length > 0) {
		filters.push({
			kinds: [GEO_EVENT_KIND],
			'#c': [...ownedAtlasCoordinates],
			limit: 500,
		})
	}
	return filters
}
