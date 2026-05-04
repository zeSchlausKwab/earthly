/**
 * Cast for kind 37517 (GeoJSON Comment Event) — read-only view.
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import {
	getCommentBoundingBox,
	getCommentContent,
	getCommentGeohash,
	getCommentGeojson,
	getCommentId,
	getCommentParentAddress,
	getCommentParentEventId,
	getCommentRootAddress,
	getCommentText,
	getCommentThreading,
	isCommentReply,
	isGeoComment,
	parseInlineReferences,
	type GeoCommentEvent,
} from './helpers'

export class GeoComment extends EventCast<GeoCommentEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isGeoComment(event)) throw new Error('Event is not a GeoComment (kind 37517)')
		super(event, store)
	}

	// Raw-event proxies (same pattern as GeoDataset)
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

	get commentId() {
		return getCommentId(this.event)!
	}
	/** Alias for `commentId` — the addressable d-tag value. */
	get dTag() {
		return getCommentId(this.event)
	}

	get commentContent() {
		return getCommentContent(this.event)
	}
	get text() {
		return getCommentText(this.event)
	}
	get geojson() {
		return getCommentGeojson(this.event)
	}

	get boundingBox() {
		return getCommentBoundingBox(this.event)
	}
	get geohash() {
		return getCommentGeohash(this.event)
	}

	get threading() {
		return getCommentThreading(this.event)
	}
	get rootAddress() {
		return getCommentRootAddress(this.event)
	}
	get parentAddress() {
		return getCommentParentAddress(this.event)
	}
	get parentEventId() {
		return getCommentParentEventId(this.event)
	}
	get isReply() {
		return isCommentReply(this.event)
	}

	parseInlineReferences() {
		return parseInlineReferences(this.event)
	}

	rawEvent() {
		return this.event
	}
}
