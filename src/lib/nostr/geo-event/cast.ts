/**
 * Cast for kind 37515 (GeoJSON Data Event) — read-only view.
 *
 * Use `castEvent(event, GeoDataset, eventStore)` to wrap a raw NostrEvent.
 * For reactive bindings in React, prefer `castTimelineStream` or the
 * `useTimeline` helper hook combined with `.map(e => castEvent(e, GeoDataset))`.
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import {
	addRelayHintsToPointer,
	getAddressPointerForEvent,
	naddrEncode,
	type NostrEvent,
} from 'applesauce-core/helpers'
import { withImmediateValueOrDefault } from 'applesauce-core'
import { map } from 'rxjs'
import {
	getBlobReferences,
	getBoundingBox,
	getChecksum,
	getCollectionReferences,
	getContextReferences,
	getCoordinateReferenceSystem,
	getDatasetId,
	getDatasetSize,
	getFeatureCollection,
	getGeohash,
	getHashtags,
	getRelayHints,
	getVersion,
	isGeoDataset,
	type GeoDatasetEvent,
} from './helpers'

export class GeoDataset extends EventCast<GeoDatasetEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isGeoDataset(event)) throw new Error('Event is not a GeoJSON Data Event (kind 37515)')
		super(event, store)
	}

	// Proxies to the raw event so existing read-side consumers don't need to
	// chase `cast.event.X` everywhere. These are read-only by definition;
	// to mutate, build a new event with `GeoDatasetFactory`.
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

	get datasetId() {
		return getDatasetId(this.event)!
	}
	/** Alias for `datasetId` — the addressable d-tag value. */
	get dTag() {
		return getDatasetId(this.event)
	}
	/** NDK-compat shim: returns the raw NostrEvent. Prefer `cast.event` directly. */
	rawEvent() {
		return this.event
	}
	get featureCollection() {
		return getFeatureCollection(this.event)
	}
	get boundingBox() {
		return getBoundingBox(this.event)
	}
	get geohash() {
		return getGeohash(this.event)
	}
	get coordinateReferenceSystem() {
		return getCoordinateReferenceSystem(this.event)
	}
	get checksum() {
		return getChecksum(this.event)
	}
	get datasetSize() {
		return getDatasetSize(this.event)
	}
	get version() {
		return getVersion(this.event)
	}
	get hashtags() {
		return getHashtags(this.event)
	}
	get collectionReferences() {
		return getCollectionReferences(this.event)
	}
	get contextReferences() {
		return getContextReferences(this.event)
	}
	get relayHints() {
		return getRelayHints(this.event)
	}
	get blobReferences() {
		return getBlobReferences(this.event)
	}

	/** Address pointer for this dataset (kind:pubkey:identifier). */
	get pointer() {
		return getAddressPointerForEvent(this.event)!
	}

	/** Pointer with relay hints from the author's outboxes. Reactive. */
	get pointer$() {
		return this.author.outboxes$.pipe(
			withImmediateValueOrDefault(undefined),
			map((outboxes) =>
				outboxes ? addRelayHintsToPointer(this.pointer, outboxes.slice(0, 3)) : this.pointer,
			),
		)
	}

	/** naddr encoding (synchronous, no relay hints). */
	get address() {
		return naddrEncode(this.pointer)
	}

	/** naddr encoding with relay hints from author's outboxes. Reactive. */
	get address$() {
		return this.pointer$.pipe(map((pointer) => naddrEncode(pointer)))
	}
}
