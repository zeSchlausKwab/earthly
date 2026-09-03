import { nip19, type Filter } from 'nostr-tools'
import { useCallback, useMemo } from 'react'
import {
	deriveStoryPresentationAuthorization,
	extractSemanticStoryMapReferences,
	parseMapPresentationSource,
} from '@/lib/map-presentation'
import type { Article } from '@/lib/nostr/article'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { dedupeNostrAddressReferences, naddrToCoordinate } from '@/lib/nostr/references'
import { useEditorStore, type MapStackEntryVia } from '../store'
import { datasetReferenceEntryId } from '../referenceMapStack'

/**
 * Resolve a Story's inline geo-references for map presentation and inline actions.
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
 * `useMentionActions` and shared-route hydration compute, so the inline toggle
 * and the Map Stack always operate on the same entry.
 */

export interface ParsedStoryRef {
	/** Canonical `kind:pubkey:d` coordinate derived from semantic body prose. */
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
	for (const reference of dedupeNostrAddressReferences(
		extractSemanticStoryMapReferences(story.article.content),
	)) {
		const coordinate = naddrToCoordinate(reference.address)
		const parsed = parseMapPresentationSource(coordinate)
		if (!parsed) continue
		const { pubkey, identifier } = parsed
		const coord = parsed.coordinate
		const datasetKey = `${pubkey}:${identifier}`
		const entryId = datasetReferenceEntryId(datasetKey, reference.featureId)
		if (seenEntryIds.has(entryId)) continue
		seenEntryIds.add(entryId)
		out.push({
			coord,
			pubkey,
			identifier,
			datasetKey,
			entryId,
			featureId: reference.featureId,
			via,
		})
	}
	return out
}

/** One exact relay filter per referenced coordinate; never an author×d-tag product. */
export function buildStoryRefFilters(refs: readonly ParsedStoryRef[]): Filter[] {
	const seen = new Set<string>()
	return refs.flatMap((ref) => {
		if (seen.has(ref.coord)) return []
		seen.add(ref.coord)
		return [{ kinds: [GEO_EVENT_KIND], authors: [ref.pubkey], '#d': [ref.identifier] }]
	})
}

export function useStoryMapRefs(story: Article | null) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)

	const refs = useMemo(() => parseStoryRefs(story), [story])
	const presentationAuthorization = useMemo(
		() => deriveStoryPresentationAuthorization(story?.article.content),
		[story],
	)

	// (1) Fetch-on-demand: subscribe to the referenced datasets so they enter the
	// event store and `geoEvents`. `null` when there are no refs → no subscription.
	// `useTimelineWithEose` dedupes by stringified filters, so a churning `refs`
	// identity with identical coordinates does not re-subscribe.
	const fetchFilters = useMemo(() => {
		if (refs.length === 0) return null
		return buildStoryRefFilters(refs)
	}, [refs])
	useTimelineWithEose(fetchFilters)

	// Fetching alone never changes membership. Story activation and the inline
	// eye / "Show on map" actions are the explicit Map Stack entry points.

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

	return { isMentionVisible, refs, presentationAuthorization }
}
