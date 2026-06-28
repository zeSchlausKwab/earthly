/**
 * Cast for kind 37521 (Live Beacon Event) — read-only view.
 *
 * Follows the official applesauce casting contract (`EventCast`). Exposes the
 * NIP-40 `expiresAt` timestamp via `getExpirationTimestamp`; tag reads delegate
 * to the shared `tags.ts` seam through the helpers (SPEC-02).
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import { getExpirationTimestamp } from 'applesauce-core/helpers/expiration'
import {
	getLiveBeaconBoundingBox,
	getLiveBeaconContent,
	getLiveBeaconContextReferences,
	getLiveBeaconGeohash,
	getLiveBeaconHashtags,
	getLiveBeaconId,
	getLiveBeaconLabels,
	getLiveBeaconReferencedAddresses,
	isLiveBeacon,
	type LiveBeaconContent,
	type LiveBeaconEvent,
} from './helpers'

export class LiveBeacon extends EventCast<LiveBeaconEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isLiveBeacon(event)) throw new Error('Event is not a LiveBeacon (kind 37521)')
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
		return getLiveBeaconId(this.event)
	}

	/** NIP-40 expiration timestamp (epoch seconds), or undefined if unset. */
	get expiresAt(): number | undefined {
		return getExpirationTimestamp(this.event)
	}

	get beacon(): LiveBeaconContent {
		return getLiveBeaconContent(this.event)
	}

	/** Lifecycle discriminator — defaults to 'live' when absent (D-04). */
	get status(): 'live' | 'ended' {
		return this.beacon.status ?? 'live'
	}

	/** Precise placement carried in content (D-09), or undefined on a legacy event. */
	get geometry() {
		return this.beacon.geometry
	}

	get boundingBox() {
		return getLiveBeaconBoundingBox(this.event)
	}
	get geohash() {
		return getLiveBeaconGeohash(this.event)
	}
	get hashtags() {
		return getLiveBeaconHashtags(this.event)
	}
	get labels() {
		return getLiveBeaconLabels(this.event)
	}
	get contextReferences() {
		return getLiveBeaconContextReferences(this.event)
	}
	get referencedAddresses() {
		return getLiveBeaconReferencedAddresses(this.event)
	}

	rawEvent() {
		return this.event
	}
}
