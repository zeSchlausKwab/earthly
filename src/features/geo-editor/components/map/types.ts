import type { BBox } from '@/lib/worldGeohash'
import type { PmtilesKind } from '@/lib/localPmtiles'

/**
 * Map source spec preserved verbatim from the pre-mapcn implementation.
 *
 *   - 'default'  → fetch a remote MapLibre style URL (also drives theme-aware
 *                  light/dark via mapcn's defaults when no `style` prop given)
 *   - 'pmtiles'  → single PMTiles file (remote URL or local File), styled with
 *                  Protomaps base layers
 *   - 'blossom'  → Nostr-announced PMTiles chunks resolved via the `pmworld://`
 *                  protocol using geohash longest-prefix matching
 */
export interface MapSource {
	type: 'default' | 'pmtiles' | 'blossom'
	location: 'remote' | 'local'
	url?: string
	file?: File
	/** Native content-addressed archive selected from Earthly's local blob store. */
	localBlobHash?: string
	/** Header-derived rendering mode; raster archives cannot use the Protomaps vector style. */
	pmtilesKind?: PmtilesKind
	/** Base URL for fetching PMTiles chunks (used with blossom map discovery) */
	blossomServer?: string
	/** Lock map zoom/pan to the bounds of the PMTiles source */
	boundsLocked?: boolean
}

/**
 * Announcement record that maps geohashes to PMTiles chunk files.
 * Resolved via NIP 34444 (kind: MAP_LAYER_SET_KIND) events.
 */
export type AnnouncementRecord = Record<
	string,
	{ bbox: BBox; file: string; maxZoom: number; size?: number }
>

export type OverlayStyleDescriptor = {
	id: string
	fullUrl: string
	enabled: boolean
	opacity: number
}
