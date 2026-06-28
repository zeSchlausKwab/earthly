/**
 * Pure helpers for kind 37522 (Temporal Sighting Event).
 *
 * A TemporalSighting is a NIP-52 time-bounded observation with a NIP-40 expiry.
 * Scaffolding only (Phase 8): a minimal content interface (NIP-52 start/optional
 * end placeholder), a defensive content getter, and an `isTemporalSighting`
 * guard gating on kind + `d` + the SPEC-03 `modelVersion` discriminator. Tag
 * reads delegate to the shared `tags.ts` seam (SPEC-02).
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import type { LineString, Point, Polygon } from 'geojson'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import { hasCurrentModelVersion } from '@/lib/nostr/modelVersion'
import {
	getBbox,
	getContextRefs,
	getGeohash,
	getHashtags,
	getLabels,
	getReferencedAddresses,
} from '@/lib/nostr/tags'

export { TEMPORAL_SIGHTING_KIND }

export type TemporalSightingEvent = KnownEvent<typeof TEMPORAL_SIGHTING_KIND>

/** Minimal NIP-52-style sighting content (scaffolding only). */
export interface TemporalSightingContent {
	modelVersion?: string
	title?: string
	description?: string
	/** NIP-52 start (epoch seconds) placeholder. */
	start?: number
	/** Optional NIP-52 end (epoch seconds) placeholder. */
	end?: number
	/**
	 * NEW (D-02): precise placement carried in content. A single Point by default;
	 * a small Line/Polygon for the "area where I saw it" case. The lossy `bbox`/`g`
	 * discovery tags are derived from this on every publish (lifecycle.ts), so the
	 * tags never drift from the precise coordinates.
	 */
	geometry?: Point | LineString | Polygon
}

export const DEFAULT_TEMPORAL_SIGHTING_CONTENT: TemporalSightingContent = {}

const TemporalSightingContentSymbol = Symbol.for('temporal-sighting-content')

/**
 * SPEC-03 guard. True only for a well-formed 37522 event with a `d` tag AND the
 * current `modelVersion`. Wrong-kind / legacy events ⇒ false WITHOUT throwing.
 */
export function isTemporalSighting(event: NostrEvent): event is TemporalSightingEvent {
	return (
		event.kind === TEMPORAL_SIGHTING_KIND &&
		getTagValue(event, 'd') !== undefined &&
		hasCurrentModelVersion(event)
	)
}

export function getTemporalSightingId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

/** Defensive content getter — never throws; malformed content ⇒ defaults. */
export function getTemporalSightingContent(event: NostrEvent): TemporalSightingContent {
	return getOrComputeCachedValue(event, TemporalSightingContentSymbol, () => {
		if (!event.content) return { ...DEFAULT_TEMPORAL_SIGHTING_CONTENT }
		try {
			const parsed = JSON.parse(event.content) as Partial<TemporalSightingContent>
			return { ...DEFAULT_TEMPORAL_SIGHTING_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_TEMPORAL_SIGHTING_CONTENT }
		}
	})
}

// Tag reads delegate to the shared tags.ts seam (SPEC-02) — no copy-paste.
export function getTemporalSightingBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getBbox(event)
}

export function getTemporalSightingGeohash(event: NostrEvent): string | undefined {
	return getGeohash(event)
}

export function getTemporalSightingHashtags(event: NostrEvent): string[] {
	return getHashtags(event)
}

export function getTemporalSightingLabels(event: NostrEvent): string[] {
	return getLabels(event)
}

export function getTemporalSightingContextReferences(event: NostrEvent): string[] {
	return getContextRefs(event)
}

export function getTemporalSightingReferencedAddresses(event: NostrEvent): string[] {
	return getReferencedAddresses(event)
}
