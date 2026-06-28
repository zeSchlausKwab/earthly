/**
 * Pure helpers for kind 37521 (Live Beacon Event).
 *
 * A LiveBeacon is a replaceable presence/position event carrying a NIP-40
 * `expiration`. Scaffolding only (Phase 8): a minimal content interface, a
 * defensive content getter, and an `isLiveBeacon` guard gating on kind + `d` +
 * the SPEC-03 `modelVersion` discriminator. Tag reads delegate to the shared
 * `tags.ts` seam (SPEC-02).
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import type { Point } from 'geojson'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { hasCurrentModelVersion } from '@/lib/nostr/modelVersion'
import {
	getBbox,
	getContextRefs,
	getGeohash,
	getHashtags,
	getLabels,
	getReferencedAddresses,
} from '@/lib/nostr/tags'

export { LIVE_BEACON_KIND }

export type LiveBeaconEvent = KnownEvent<typeof LIVE_BEACON_KIND>

/** Minimal beacon content. */
export interface LiveBeaconContent {
	modelVersion?: string
	/** Human-readable label for the presence/position. */
	label?: string
	/**
	 * Precise placement carried in content (D-09). A single GeoJSON Point — the
	 * lossy `bbox`/`g` discovery tags are derived from this on every publish
	 * (lifecycle.ts), so the tags never drift from the precise coordinates.
	 * Mirrors the Sighting `geometry` field.
	 */
	geometry?: Point
	/**
	 * Lifecycle discriminator (D-04). 'live' on every heartbeat; 'ended' on the
	 * one final Stop event. Defaults to 'live' when absent (back-compat with the
	 * Phase-8 scaffold + seeded beacons, which the map renders as live).
	 */
	status?: 'live' | 'ended'
}

export const DEFAULT_LIVE_BEACON_CONTENT: LiveBeaconContent = { status: 'live' }

const LiveBeaconContentSymbol = Symbol.for('live-beacon-content')

/**
 * SPEC-03 guard. True only for a well-formed 37521 event with a `d` tag AND the
 * current `modelVersion`. Wrong-kind / legacy events ⇒ false WITHOUT throwing.
 */
export function isLiveBeacon(event: NostrEvent): event is LiveBeaconEvent {
	return (
		event.kind === LIVE_BEACON_KIND &&
		getTagValue(event, 'd') !== undefined &&
		hasCurrentModelVersion(event)
	)
}

export function getLiveBeaconId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

/** Defensive content getter — never throws; malformed content ⇒ defaults. */
export function getLiveBeaconContent(event: NostrEvent): LiveBeaconContent {
	return getOrComputeCachedValue(event, LiveBeaconContentSymbol, () => {
		if (!event.content) return { ...DEFAULT_LIVE_BEACON_CONTENT }
		try {
			const parsed = JSON.parse(event.content) as Partial<LiveBeaconContent>
			return { ...DEFAULT_LIVE_BEACON_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_LIVE_BEACON_CONTENT }
		}
	})
}

// Tag reads delegate to the shared tags.ts seam (SPEC-02) — no copy-paste.
export function getLiveBeaconBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getBbox(event)
}

export function getLiveBeaconGeohash(event: NostrEvent): string | undefined {
	return getGeohash(event)
}

export function getLiveBeaconHashtags(event: NostrEvent): string[] {
	return getHashtags(event)
}

export function getLiveBeaconLabels(event: NostrEvent): string[] {
	return getLabels(event)
}

export function getLiveBeaconContextReferences(event: NostrEvent): string[] {
	return getContextRefs(event)
}

export function getLiveBeaconReferencedAddresses(event: NostrEvent): string[] {
	return getReferencedAddresses(event)
}
