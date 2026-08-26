import { nip19 } from 'nostr-tools'
import { useCallback, useMemo } from 'react'
import type { Article } from '@/lib/nostr/article'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	dedupeNostrAddressReferences,
	extractNostrAddressReferences,
	naddrToCoordinate,
} from '@/lib/nostr/references'
import { useEditorStore, type MapStackEntryVia } from '../store'
import { datasetReferenceEntryId } from '../referenceMapStack'

/**
 * Resolve a Story's inline geo-references without changing the user's map.
 * When a Story is open this hook:
 *
 *  1. **Fetches on demand** — pulls the referenced kind-37515 datasets into the
 *     event store by `kind:pubkey:d`, so they land in `geoEvents` and can render
 *     even when the broad dataset timeline was relay-capped and omitted them.
 *  2. **Exposes `isMentionVisible`** — the inline ref eye-toggles derive their
 *     state from map-stack membership instead of a private local boolean, so the
 *     chip and the map can never drift.
 *
 * Membership is keyed by `dataset:<pubkey>:<d>`, identical to the key
 * `useMentionActions`/`addDatasetToMapStack` compute, so the inline toggle
 * (add/remove) and this auto-stack operate on the same entry.
 */

interface ParsedStoryRef {
	/** Raw `kind:pubkey:d` coordinate from the Story's `a` tags. */
	coord: string
	pubkey: string
	identifier: string
	/** `pubkey:d` — matches `getDatasetKey(dataset)`. */
	datasetKey: string
	/** `dataset:pubkey:d` — the map-stack entry id. */
	entryId: string
	/** Exact feature selector, absent for a whole-dataset reference. */
	featureId?: string
	/**
	 * Carrier provenance stamped onto the auto-stacked entry: the Map Stack
	 * panel nests these entries under the Story's own row instead of showing
	 * them as mystery top-level datasets (see `MapStackEntryVia`).
	 */
	via: MapStackEntryVia
}

export function parseStoryRefs(story: Article | null): ParsedStoryRef[] {
	if (!story) return []
	const via: MapStackEntryVia = {
		entityType: 'story',
		entityKey: `${story.pubkey}:${story.dTag ?? ''}`,
		title: story.article.title?.trim() || story.dTag || 'Story',
	}
	const out: ParsedStoryRef[] = []
	const seenEntryIds = new Set<string>()
	const inlineByCoordinate = new Map<string, Array<{ featureId?: string }>>()
	for (const reference of dedupeNostrAddressReferences(
		extractNostrAddressReferences(story.article.content),
	)) {
		const coordinate = naddrToCoordinate(reference.address)
		if (!coordinate) continue
		const current = inlineByCoordinate.get(coordinate) ?? []
		current.push({ featureId: reference.featureId })
		inlineByCoordinate.set(coordinate, current)
	}

	const coordinates = new Set([...story.referencedAddresses, ...inlineByCoordinate.keys()])
	for (const coord of coordinates) {
		const parts = coord.split(':')
		if (parts.length < 3) continue
		const kind = Number(parts[0])
		const pubkey = parts[1]
		const identifier = parts.slice(2).join(':')
		if (kind !== GEO_EVENT_KIND || !pubkey || !identifier) continue
		const datasetKey = `${pubkey}:${identifier}`
		const inlineSelectors = inlineByCoordinate.get(coord)
		const selectors = inlineSelectors && inlineSelectors.length > 0 ? inlineSelectors : [{}]
		for (const selector of selectors) {
			const entryId = datasetReferenceEntryId(datasetKey, selector.featureId)
			if (seenEntryIds.has(entryId)) continue
			seenEntryIds.add(entryId)
			out.push({
				coord,
				pubkey,
				identifier,
				datasetKey,
				entryId,
				featureId: selector.featureId,
				via,
			})
		}
	}
	return out
}

export function useStoryMapRefs(story: Article | null) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)

	const refs = useMemo(() => parseStoryRefs(story), [story])

	// (1) Fetch-on-demand: subscribe to the referenced datasets so they enter the
	// event store and `geoEvents`. `null` when there are no refs → no subscription.
	// `useTimelineWithEose` dedupes by stringified filters, so a churning `refs`
	// identity with identical coordinates does not re-subscribe.
	const fetchFilters = useMemo(() => {
		if (refs.length === 0) return null
		const authors = [...new Set(refs.map((r) => r.pubkey))]
		const dTags = [...new Set(refs.map((r) => r.identifier))]
		return [{ kinds: [GEO_EVENT_KIND], authors, '#d': dTags }]
	}, [refs])
	useTimelineWithEose(fetchFilters)

	// Inspection is read-only: referenced geometry enters/leaves the Map Stack only
	// through the Story panel's explicit eye / "Show on map" actions.

	// (2) Single source of truth for an inline ref's eye state: is the resolved
	// dataset present and visible in the map stack?
	const isMentionVisible = useCallback(
		(address: string, featureId: string | undefined) => {
			if (address.startsWith('geo:')) {
				const entry = mapStackEntries[`coordinate:${address}`]
				return !!entry && entry.visible !== false
			}
			if (!address?.startsWith('naddr1')) return false
			try {
				const decoded = nip19.decode(address)
				if (decoded.type !== 'naddr') return false
				const { kind, pubkey, identifier } = decoded.data
				if (kind !== GEO_EVENT_KIND || !pubkey || !identifier) return false
				const datasetKey = `${pubkey}:${identifier}`
				const exact = mapStackEntries[datasetReferenceEntryId(datasetKey, featureId)]
				if (exact) return exact.visible !== false
				const whole = mapStackEntries[datasetReferenceEntryId(datasetKey)]
				return !!whole && whole.visible !== false
			} catch {
				return false
			}
		},
		[mapStackEntries],
	)

	return { isMentionVisible }
}
