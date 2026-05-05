/**
 * Map Layer Set Announcement (kind 34444) — read-only Cast.
 *
 * These events are published by Mapnolia (server identity) to advertise the
 * map layers a client should render. Clients filter by `authors: [SERVER_PUBKEY]`.
 * No factory/delete needed — Earthly never publishes kind 34444.
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import { MAP_LAYER_SET_KIND } from '@/lib/nostr/kinds'
import type { BBox } from '@/lib/worldGeohash'

export type MapLayerSetEvent = KnownEvent<typeof MAP_LAYER_SET_KIND>

export type MapChunkAnnouncementRecord = Record<
	string,
	{ bbox: BBox; file: string; maxZoom: number; size?: number }
>

export type MapLayerDescriptor =
	| {
			id: string
			title: string
			kind: 'chunked-vector'
			blossomServer: string
			announcement: MapChunkAnnouncementRecord
			defaultEnabled?: boolean
			defaultOpacity?: number
	  }
	| {
			id: string
			title: string
			kind: 'pmtiles' | 'file'
			blossomServer: string
			file: string
			pmtilesType?: string
			defaultEnabled?: boolean
			defaultOpacity?: number
	  }

export interface MapLayerSetAnnouncementPayload {
	version?: 1
	layers: MapLayerDescriptor[]
}

const DEFAULT_PAYLOAD: MapLayerSetAnnouncementPayload = {
	version: 1,
	layers: [],
}

const PayloadSymbol = Symbol.for('map-layer-set-payload')

export function isMapLayerSet(event: NostrEvent): event is MapLayerSetEvent {
	return event.kind === MAP_LAYER_SET_KIND
}

export function getMapLayerSetPayload(event: NostrEvent): MapLayerSetAnnouncementPayload {
	return getOrComputeCachedValue(event, PayloadSymbol, () => {
		if (!event.content) return DEFAULT_PAYLOAD
		try {
			const parsed = JSON.parse(event.content) as Partial<MapLayerSetAnnouncementPayload>
			if (parsed && Array.isArray(parsed.layers)) {
				return parsed as MapLayerSetAnnouncementPayload
			}
			return DEFAULT_PAYLOAD
		} catch {
			return DEFAULT_PAYLOAD
		}
	})
}

export class MapLayerSet extends EventCast<MapLayerSetEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isMapLayerSet(event)) throw new Error('Event is not a MapLayerSet (kind 34444)')
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

	get payload() {
		return getMapLayerSetPayload(this.event)
	}

	rawEvent() {
		return this.event
	}
}
