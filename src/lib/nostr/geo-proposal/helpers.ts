/**
 * Pure helpers for kind 37519 (Geo Edit Proposal Event).
 *
 * A proposal stores a full replacement FeatureCollection that some user
 * suggests applying to another user's dataset. The dataset owner can then
 * accept (publish a new dataset version) or close the proposal.
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import {
	getTagValue,
	type KnownEvent,
	type NostrEvent,
} from 'applesauce-core/helpers/event'
import type { FeatureCollection } from 'geojson'
import { GEO_EDIT_PROPOSAL_KIND } from '@/lib/nostr/kinds'
import {
	computeBboxFor,
	computeGeohashFor,
	type GeoBoundingBox,
} from '@/lib/nostr/geo-event'
import { normalizeGeoJsonToFeatureCollection } from '@/lib/geo/normalizeGeoJSON'

export type GeoProposalEvent = KnownEvent<typeof GEO_EDIT_PROPOSAL_KIND>

const DEFAULT_COLLECTION: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

const FeatureCollectionSymbol = Symbol.for('geo-proposal-feature-collection')
const BoundingBoxSymbol = Symbol.for('geo-proposal-bbox')
const HashtagsSymbol = Symbol.for('geo-proposal-hashtags')

export function isGeoProposal(event: NostrEvent): event is GeoProposalEvent {
	return event.kind === GEO_EDIT_PROPOSAL_KIND && getProposalId(event) !== undefined
}

export function getProposalId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

export function getProposalFeatureCollection(event: NostrEvent): FeatureCollection {
	return getOrComputeCachedValue(event, FeatureCollectionSymbol, () => {
		if (!event.content) return DEFAULT_COLLECTION
		try {
			return normalizeGeoJsonToFeatureCollection(JSON.parse(event.content))
		} catch {
			return DEFAULT_COLLECTION
		}
	})
}

/** Address of the target dataset: `37515:<owner-pubkey>:<dataset-d-tag>` */
export function getProposalTargetAddress(event: NostrEvent): string | undefined {
	return getTagValue(event, 'a')
}

export function getProposalTargetPubkey(event: NostrEvent): string | undefined {
	const address = getProposalTargetAddress(event)
	return address ? address.split(':')[1] : undefined
}

export function getProposalTargetDatasetId(event: NostrEvent): string | undefined {
	const address = getProposalTargetAddress(event)
	return address ? address.split(':')[2] : undefined
}

/** The dataset owner's pubkey (`p` tag) — used for outbox/inbox routing. */
export function getProposalOwnerPubkey(event: NostrEvent): string | undefined {
	return getTagValue(event, 'p')
}

/** Event ID of the dataset version this proposal is based on. */
export function getProposalBaseVersion(event: NostrEvent): string | undefined {
	return getTagValue(event, 'base-version')
}

export function getProposalDescription(event: NostrEvent): string | undefined {
	return getTagValue(event, 'description')
}

export function getProposalBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getOrComputeCachedValue(event, BoundingBoxSymbol, () => {
		const raw = getTagValue(event, 'bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return undefined
		return parts as GeoBoundingBox
	})
}

export function getProposalGeohash(event: NostrEvent): string | undefined {
	return getTagValue(event, 'g')
}

export function getProposalHashtags(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, HashtagsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

export function getProposalCoordinate(event: NostrEvent): string | undefined {
	const id = getProposalId(event)
	if (!id || !event.pubkey) return undefined
	return `${GEO_EDIT_PROPOSAL_KIND}:${event.pubkey}:${id}`
}

// Re-export shared computations so the factory only needs one import.
export { computeBboxFor, computeGeohashFor }
