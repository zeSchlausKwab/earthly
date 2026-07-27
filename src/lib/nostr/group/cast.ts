/**
 * Cast for kind 37518 (Group / Topic Event) — read-only view.
 *
 * The maintainer-mandated applesauce casting contract: a thin `EventCast`
 * subclass that guard-throws in its ctor and exposes raw-event proxies plus
 * helper-backed getters. Never hand-roll an NDK-style wrapper.
 */

import { type CastRefEventStore, EventCast } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import {
	getGroupContent,
	getGroupCoordinate,
	getGroupId,
	getGroupReferencedAddresses,
	getGroupSchemaHash,
	type GroupEvent,
	isGroup,
} from './helpers'

export class Group extends EventCast<GroupEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isGroup(event)) throw new Error('Event is not a Group (kind 37518)')
		super(event, store)
	}

	// Raw-event proxies (mirror GeoDataset/MapContext).
	override get kind() {
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
	override get id() {
		return this.event.id
	}

	/** The addressable `d`-tag value. */
	get groupId() {
		// biome-ignore lint/style/noNonNullAssertion: isGroup validates the required d tag in the constructor.
		return getGroupId(this.event)!
	}
	/** Alias for `groupId` — the addressable d-tag value. */
	get dTag() {
		return getGroupId(this.event)
	}

	/** The slimmed governance content payload. */
	get group() {
		return getGroupContent(this.event)
	}

	get groupCoordinate() {
		return getGroupCoordinate(this.event)
	}

	/** Curated (`a`) lane — the owner's pinned/blessed references. */
	get referencedAddresses() {
		return getGroupReferencedAddresses(this.event)
	}

	get schemaHash() {
		return getGroupSchemaHash(this.event)
	}

	rawEvent() {
		return this.event
	}
}
