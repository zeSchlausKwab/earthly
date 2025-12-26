import { NDKEvent, registerEventClass } from '@nostr-dev-kit/react'

import type { BBox } from '@/lib/worldGeohash'

export type MapChunkAnnouncementRecord = Record<
	string,
	{ bbox: BBox; file: string; maxZoom: number }
>

export type MapLayerDescriptor =
	| {
			id: string
			title: string
			kind: 'chunked-vector'
			/** Base URL for fetching chunk files (e.g. Blossom server). */
			blossomServer: string
			/** Geohash -> chunk file mapping. */
			announcement: MapChunkAnnouncementRecord
			defaultEnabled?: boolean
			defaultOpacity?: number
	  }
	| {
			id: string
			title: string
			kind: 'pmtiles'
			/** Base URL for fetching PMTiles (e.g. Blossom server). */
			blossomServer: string
			/** File name or sha-based blob path on the blossom server. */
			file: string
			pmtilesType?: 'raster' | 'vector'
			defaultEnabled?: boolean
			defaultOpacity?: number
	  }

export interface MapLayerSetAnnouncementPayload {
	version: 1
	layers: MapLayerDescriptor[]
}

const DEFAULT_PAYLOAD: MapLayerSetAnnouncementPayload = { version: 1, layers: [] }

/**
 * Earthly Map Layer Set Announcement
 *
 * Custom kind (replaceable) carrying a set of map layers that the client can render.
 * Signed by the server identity; clients should filter by `authors: [SERVER_PUBKEY]`.
 */
export class NDKMapLayerSetEvent extends NDKEvent {
	static kinds = [15000]

	static from(event: NDKEvent): NDKMapLayerSetEvent {
		const wrapped = new NDKMapLayerSetEvent(event.ndk, event)
		wrapped.kind = event.kind ?? NDKMapLayerSetEvent.kinds[0]
		return wrapped
	}

	get payload(): MapLayerSetAnnouncementPayload {
		if (!this.content) return DEFAULT_PAYLOAD
		try {
			const parsed = JSON.parse(this.content) as Partial<MapLayerSetAnnouncementPayload>
			if (parsed && parsed.version === 1 && Array.isArray(parsed.layers)) {
				return parsed as MapLayerSetAnnouncementPayload
			}
			return DEFAULT_PAYLOAD
		} catch {
			return DEFAULT_PAYLOAD
		}
	}
}

registerEventClass(NDKMapLayerSetEvent)
