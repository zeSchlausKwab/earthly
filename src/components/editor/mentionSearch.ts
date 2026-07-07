/**
 * Relay-backed entity suggestions for the $-mention picker.
 *
 * The in-memory `availableFeatures` list only covers loaded content — this
 * module lets the picker also find datasets, groups, and stories that are
 * NOT loaded, via the relay's NIP-50 search (src/lib/search facade). Entity
 * mentions insert address-only GeoMention nodes (no featureId), which is
 * what the Story naddr→`a` mirror consumes (SPEC §4.1).
 */

import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { ARTICLE_KIND, GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { searchEntityEvents } from '@/lib/search'
import type { GeoFeatureItem } from './GeoRichTextEditor'

/**
 * Kinds surfaced as mention suggestions. Beacons/sightings are excluded —
 * they are ephemeral and their chips would dangle after expiry.
 */
const MENTIONABLE_KINDS = [GEO_EVENT_KIND, MAP_CONTEXT_KIND, ARTICLE_KIND]

const KIND_TO_MENTION_TYPE: Record<
	number,
	{ entityType: GeoFeatureItem['entityType']; label: string }
> = {
	[GEO_EVENT_KIND]: { entityType: 'dataset', label: 'Dataset' },
	[MAP_CONTEXT_KIND]: { entityType: 'context', label: 'Group' },
	[ARTICLE_KIND]: { entityType: 'story', label: 'Story' },
}

const MIN_QUERY_LENGTH = 2
const RELAY_SUGGESTION_LIMIT = 6
const RELAY_TIMEOUT_MS = 4000

/** Map a relay entity event to a mention item (null when not addressable). */
export function entityEventToMentionItem(event: NostrEvent): GeoFeatureItem | null {
	const mapping = KIND_TO_MENTION_TYPE[event.kind]
	const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
	if (!mapping || !dTag) return null

	let address: string
	try {
		address = nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: dTag })
	} catch {
		return null
	}

	let content: Record<string, unknown> = {}
	try {
		content = JSON.parse(event.content) as Record<string, unknown>
	} catch {
		// name falls back to the d tag
	}
	const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
	const name = str(content.name) ?? str(content.title) ?? dTag

	return {
		id: address,
		name,
		address,
		entityType: mapping.entityType,
		// Rendered as the dropdown subtitle — tells the user this is a
		// relay-wide entity, not a loaded feature.
		datasetName: mapping.label,
	}
}

/** One-shot relay lookup for mention suggestions. Never throws. */
export async function searchMentionEntities(query: string): Promise<GeoFeatureItem[]> {
	const trimmed = query.trim()
	if (trimmed.length < MIN_QUERY_LENGTH) return []
	try {
		const events = await searchEntityEvents(
			{ text: trimmed },
			{ kinds: MENTIONABLE_KINDS, limit: RELAY_SUGGESTION_LIMIT, timeoutMs: RELAY_TIMEOUT_MS },
		)
		return events
			.map(entityEventToMentionItem)
			.filter((item): item is GeoFeatureItem => item !== null)
	} catch {
		return []
	}
}

/**
 * Merge local (loaded) matches with relay results: local first, relay
 * deduped against local, capped for the dropdown.
 *
 * The dedup key includes the featureId: a loaded FEATURE mention shares the
 * dataset's naddr but targets a different thing than the relay's
 * dataset-level (address-only) mention — both belong in the list.
 */
export function mergeMentionItems(
	local: GeoFeatureItem[],
	relay: GeoFeatureItem[],
	cap = 10,
): GeoFeatureItem[] {
	const key = (item: GeoFeatureItem) => `${item.address}#${item.featureId ?? ''}`
	const seen = new Set(local.map(key))
	const merged = [...local]
	for (const item of relay) {
		if (seen.has(key(item))) continue
		seen.add(key(item))
		merged.push(item)
	}
	return merged.slice(0, cap)
}
