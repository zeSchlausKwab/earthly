import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { isExpired } from '@/lib/nostr/expiry'
import { GEO_EVENT_KIND, LIVE_BEACON_KIND, TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import { hasCurrentModelVersion } from '@/lib/nostr/modelVersion'
import type { MapStackEntry } from '../store/types'

/**
 * Pure planning logic for query-by-view (useGeoQueryByView): map viewport
 * relay results to prospective Map Stack entries, and reconcile them against
 * the current stack. Extracted so the invariants are unit-testable without
 * the map or the relay.
 */

/**
 * Kinds painted by query-by-view. Datasets render via the dataset pipeline;
 * sightings/beacons resolve as individual stack pins through the Phase 13
 * render gate. Groups/stories are containers/narratives — they don't paint.
 */
export const GEO_QUERY_KINDS = [GEO_EVENT_KIND, TEMPORAL_SIGHTING_KIND, LIVE_BEACON_KIND]

export interface GeoQueryEntryPlan {
	entityType: 'dataset' | 'sighting' | 'beacon'
	entityKey: string
	title: string
}

/** Matches mapStackSlice's createMapStackEntryId convention. */
export function geoQueryEntryId(plan: GeoQueryEntryPlan): string {
	return `${plan.entityType}:${plan.entityKey}`
}

function contentOf(event: NostrEvent): Record<string, unknown> {
	try {
		return JSON.parse(event.content) as Record<string, unknown>
	} catch {
		return {}
	}
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function naddrOf(event: NostrEvent, dTag: string): string | null {
	try {
		return nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: dTag })
	} catch {
		return null
	}
}

/**
 * Map one relay event to a prospective stack entry. Returns null for events
 * that must not enter the stack: unknown kinds, missing d tags, expired
 * (NIP-40, SPEC §10), or legacy new-model events without the modelVersion
 * discriminator (SPEC §8).
 *
 * Entity keys match the app's add-to-stack conventions so a geo-query entry
 * and a manual entry for the same entity collide on the same stack id:
 * datasets use `pubkey:d` (getDatasetKey), sightings/beacons use the naddr
 * (falling back to dTag).
 */
export function planGeoQueryEntry(event: NostrEvent, now: number): GeoQueryEntryPlan | null {
	const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
	if (!dTag) return null
	if (isExpired(event, now)) return null

	switch (event.kind) {
		case GEO_EVENT_KIND: {
			const content = contentOf(event)
			return {
				entityType: 'dataset',
				entityKey: `${event.pubkey}:${dTag}`,
				title: str(content.name) ?? dTag,
			}
		}
		case TEMPORAL_SIGHTING_KIND: {
			if (!hasCurrentModelVersion(event)) return null
			const content = contentOf(event)
			return {
				entityType: 'sighting',
				entityKey: naddrOf(event, dTag) ?? dTag,
				title: str(content.title) ?? 'Sighting',
			}
		}
		case LIVE_BEACON_KIND: {
			if (!hasCurrentModelVersion(event)) return null
			const content = contentOf(event)
			// Ended beacons are tombstones — never surface them from a query.
			if (str(content.status) === 'ended') return null
			return {
				entityType: 'beacon',
				entityKey: naddrOf(event, dTag) ?? dTag,
				title: str(content.label) ?? 'Live location',
			}
		}
	}
	return null
}

export interface GeoQueryReconciliation {
	/** Fresh results not on the stack at all — add with source 'geo-query'. */
	toAdd: GeoQueryEntryPlan[]
	/** Stale geo-query entry ids (unpinned, no longer in the viewport) — remove. */
	toRemove: string[]
}

/**
 * Reconcile fresh viewport results against the current stack.
 *
 * Invariants:
 * - NEVER touch entries the user owns: only source 'geo-query' entries are
 *   ever removed, and pinned ones survive (pinning graduates an entry out of
 *   the section — user contract "pin means keep").
 * - NEVER re-add an id that already exists (any source): addMapStackEntry
 *   overwrites visible/pinned flags, so re-adding would reset a user's
 *   hide/pin toggles on every pan.
 */
export function planGeoQueryReconciliation(
	currentEntries: Record<string, MapStackEntry>,
	fresh: GeoQueryEntryPlan[],
): GeoQueryReconciliation {
	const freshIds = new Set(fresh.map(geoQueryEntryId))

	const toRemove: string[] = []
	for (const entry of Object.values(currentEntries)) {
		if (entry.source !== 'geo-query') continue
		if (entry.pinned) continue
		if (!freshIds.has(entry.id)) toRemove.push(entry.id)
	}

	const toAdd = fresh.filter((plan) => !currentEntries[geoQueryEntryId(plan)])

	return { toAdd, toRemove }
}
