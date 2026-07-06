/**
 * Cast for kind 37519 (Geo Edit Proposal Event) — read-only view.
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import {
	getProposalBaseVersion,
	getProposalBoundingBox,
	getProposalCoordinate,
	getProposalDescription,
	getProposalFeatureCollection,
	getProposalGeohash,
	getProposalHashtags,
	getProposalId,
	getProposalOwnerPubkey,
	getProposalTargetAddress,
	getProposalTargetDatasetId,
	getProposalTargetPubkey,
	isGeoProposal,
	type GeoProposalEvent,
} from './helpers'

export class GeoProposal extends EventCast<GeoProposalEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isGeoProposal(event)) {
			throw new Error('Event is not a Geo Edit Proposal (kind 37519)')
		}
		super(event, store)
	}

	get kind() {
		return this.event.kind
	}
	get pubkey() {
		return this.event.pubkey
	}
	get tags() {
		return this.event.tags
	}
	get content() {
		return this.event.content
	}
	get created_at() {
		return this.event.created_at
	}

	get proposalId() {
		return getProposalId(this.event)!
	}
	/** Alias for `proposalId` — the addressable d-tag value. */
	get dTag() {
		return getProposalId(this.event)
	}

	get featureCollection() {
		return getProposalFeatureCollection(this.event)
	}

	get targetAddress() {
		return getProposalTargetAddress(this.event)
	}
	get targetPubkey() {
		return getProposalTargetPubkey(this.event)
	}
	get targetDatasetId() {
		return getProposalTargetDatasetId(this.event)
	}
	get ownerPubkey() {
		return getProposalOwnerPubkey(this.event)
	}
	get baseVersion() {
		return getProposalBaseVersion(this.event)
	}
	get description() {
		return getProposalDescription(this.event)
	}
	get boundingBox() {
		return getProposalBoundingBox(this.event)
	}
	get geohash() {
		return getProposalGeohash(this.event)
	}
	get hashtags() {
		return getProposalHashtags(this.event)
	}
	get proposalCoordinate() {
		return getProposalCoordinate(this.event)
	}

	rawEvent() {
		return this.event
	}
}
