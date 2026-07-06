/**
 * Cast for kind 37522 (Temporal Sighting Event) — read-only view.
 *
 * Follows the official applesauce casting contract (`EventCast`). Exposes the
 * NIP-40 `expiresAt` timestamp via `getExpirationTimestamp` (sightings are
 * expiry-bearing); tag reads delegate to the shared `tags.ts` seam through the
 * helpers (SPEC-02).
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import { getExpirationTimestamp } from 'applesauce-core/helpers/expiration'
import {
	getTemporalSightingBoundingBox,
	getTemporalSightingContent,
	getTemporalSightingContextReferences,
	getTemporalSightingGeohash,
	getTemporalSightingHashtags,
	getTemporalSightingId,
	getTemporalSightingImages,
	getTemporalSightingLabels,
	getTemporalSightingPrimaryImage,
	getTemporalSightingReferencedAddresses,
	isTemporalSighting,
	type TemporalSightingContent,
	type TemporalSightingEvent,
} from './helpers'

export class TemporalSighting extends EventCast<TemporalSightingEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isTemporalSighting(event)) {
			throw new Error('Event is not a TemporalSighting (kind 37522)')
		}
		super(event, store)
	}

	// Raw-event proxies (mirror MapContext).
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

	/** The addressable d-tag value. */
	get dTag(): string | undefined {
		return getTemporalSightingId(this.event)
	}

	/** NIP-40 expiration timestamp (epoch seconds), or undefined if unset. */
	get expiresAt(): number | undefined {
		return getExpirationTimestamp(this.event)
	}

	get sighting(): TemporalSightingContent {
		return getTemporalSightingContent(this.event)
	}

	get boundingBox() {
		return getTemporalSightingBoundingBox(this.event)
	}
	get geohash() {
		return getTemporalSightingGeohash(this.event)
	}
	get hashtags() {
		return getTemporalSightingHashtags(this.event)
	}
	get labels() {
		return getTemporalSightingLabels(this.event)
	}
	get contextReferences() {
		return getTemporalSightingContextReferences(this.event)
	}
	get referencedAddresses() {
		return getTemporalSightingReferencedAddresses(this.event)
	}

	/** NIP-92 imeta attachments (SPEC §6.1); first = primary. */
	get images() {
		return getTemporalSightingImages(this.event)
	}

	/** The primary image shown in the map pin bubble, if any. */
	get primaryImage() {
		return getTemporalSightingPrimaryImage(this.event)
	}

	rawEvent() {
		return this.event
	}
}
