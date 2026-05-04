/**
 * Cast for kind 37518 (Map Context Event) — read-only view.
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import {
	getContextBoundingBox,
	getContextCoordinate,
	getContextHashtags,
	getContextId,
	getContextRelayHints,
	getContextReferencedAddresses,
	getContextReferencesOnContext,
	getContextSchemaHash,
	getContextVersion,
	getMapContextContent,
	getParentContextCoordinate,
	isMapContext,
	type MapContextEvent,
} from './helpers'

export class MapContext extends EventCast<MapContextEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isMapContext(event)) throw new Error('Event is not a MapContext (kind 37518)')
		super(event, store)
	}

	// Raw-event proxies (mirror GeoDataset/GeoComment)
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

	get contextId() {
		return getContextId(this.event)!
	}
	/** Alias for `contextId` — the addressable d-tag value. */
	get dTag() {
		return getContextId(this.event)
	}

	get context() {
		return getMapContextContent(this.event)
	}

	get contextCoordinate() {
		return getContextCoordinate(this.event)
	}

	get boundingBox() {
		return getContextBoundingBox(this.event)
	}

	get relayHints() {
		return getContextRelayHints(this.event)
	}
	get hashtags() {
		return getContextHashtags(this.event)
	}
	get version() {
		return getContextVersion(this.event)
	}
	get contextReferences() {
		return getContextReferencesOnContext(this.event)
	}
	get referencedAddresses() {
		return getContextReferencedAddresses(this.event)
	}
	get schemaHash() {
		return getContextSchemaHash(this.event)
	}
	get parentContextCoordinate() {
		return getParentContextCoordinate(this.event)
	}

	rawEvent() {
		return this.event
	}
}
