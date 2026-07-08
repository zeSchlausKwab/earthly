import { castEvent } from 'applesauce-core/casts'
import type { Filter } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Subscription } from 'rxjs'
import {
	ARTICLE_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { eventStore, pool, readRelaysFor } from '@/lib/nostr'
import { Article } from '@/lib/nostr/article'
import { isExpired } from '@/lib/nostr/expiry'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { LiveBeacon } from '@/lib/nostr/live-beacon'
import { MapContext } from '@/lib/nostr/map-context'
import { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { buildSearchString, type SearchQuery } from '@/lib/search'
import {
	type EntitySearchResult,
	type EntityType,
	beaconToSearchResult,
	contextToSearchResult,
	datasetToSearchResult,
	sightingToSearchResult,
	storyToSearchResult,
} from './types'

const TYPE_TO_KIND: Partial<Record<EntityType, number>> = {
	dataset: GEO_EVENT_KIND,
	context: MAP_CONTEXT_KIND,
	story: ARTICLE_KIND,
	beacon: LIVE_BEACON_KIND,
	sighting: TEMPORAL_SIGHTING_KIND,
}

const KIND_TO_TYPE: Record<number, EntityType> = {
	[GEO_EVENT_KIND]: 'dataset',
	[MAP_CONTEXT_KIND]: 'context',
	[ARTICLE_KIND]: 'story',
	[LIVE_BEACON_KIND]: 'beacon',
	[TEMPORAL_SIGHTING_KIND]: 'sighting',
}

const DEBOUNCE_MS = 300
const DEFAULT_RELAY_ENTITY_TYPES: EntityType[] = ['dataset', 'context']

interface UseRelayEntitySearchOptions {
	query: string
	entityTypes?: EntityType[]
	limit?: number
	enabled?: boolean
	getDatasetName?: (event: GeoDataset) => string
	/**
	 * Extra search constraints (viewport bbox, labels, temporal range, …)
	 * serialized through the src/lib/search facade into the Earthly NIP-50
	 * extension grammar. Foreign relays ignore unknown tokens.
	 */
	geo?: Omit<SearchQuery, 'text'>
}

/**
 * NIP-50 (relay-side search) across the Earthly entity kinds. Uses
 * `pool.request` so the subscription completes on EOSE (one-shot search).
 *
 * The search string is built by the src/lib/search facade — free text plus
 * optional extension tokens (docs/GEO_SEARCH_REWRITE.md §4 Lane 2). Expired
 * beacons/sightings are filtered on read per SPEC §10.
 */
export function useRelayEntitySearch({
	query,
	entityTypes,
	limit = 20,
	enabled = true,
	getDatasetName,
	geo,
}: UseRelayEntitySearchOptions) {
	const [results, setResults] = useState<EntitySearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [eose, setEose] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subRef = useRef<Subscription | null>(null)

	const activeTypes = useMemo(() => entityTypes ?? DEFAULT_RELAY_ENTITY_TYPES, [entityTypes])

	const kinds = useMemo(
		() => activeTypes.map((t) => TYPE_TO_KIND[t]).filter((k): k is number => typeof k === 'number'),
		[activeTypes],
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: geo is compared by serialized value
	const search = useMemo(() => {
		const trimmed = query.trim()
		if (!trimmed && !geo) return ''
		try {
			return buildSearchString({ ...geo, text: trimmed })
		} catch {
			return trimmed
		}
	}, [query, JSON.stringify(geo ?? null)])

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		subRef.current?.unsubscribe()
		subRef.current = null

		if (!search || !enabled || kinds.length === 0) {
			setResults([])
			setLoading(false)
			setEose(false)
			return
		}

		setLoading(true)
		setEose(false)

		debounceRef.current = setTimeout(() => {
			const resultMap = new Map<string, EntitySearchResult>()
			// NIP-50: relays with `search` capability filter server-side.
			const filter: Filter & { search: string } = {
				kinds,
				search,
				limit,
			}

			subRef.current = pool.request(readRelaysFor('content'), filter).subscribe({
				next: (event) => {
					const kind = event.kind as number
					const eventId = event.id as string
					if (resultMap.has(eventId)) return

					const entityType = KIND_TO_TYPE[kind]
					if (!entityType) return

					// SPEC §10: expired beacons/sightings never reach the UI,
					// regardless of relay behavior.
					if (isExpired(event, Math.floor(Date.now() / 1000))) return

					let result: EntitySearchResult | null = null
					if (entityType === 'dataset') {
						const wrapped = castEvent(event, GeoDataset, eventStore)
						result = datasetToSearchResult(wrapped, getDatasetName)
					} else if (entityType === 'context') {
						const wrapped = castEvent(event, MapContext, eventStore)
						result = contextToSearchResult(wrapped)
					} else if (entityType === 'story') {
						const wrapped = castEvent(event, Article, eventStore)
						result = storyToSearchResult(wrapped)
					} else if (entityType === 'beacon') {
						const wrapped = castEvent(event, LiveBeacon, eventStore)
						result = beaconToSearchResult(wrapped)
					} else if (entityType === 'sighting') {
						const wrapped = castEvent(event, TemporalSighting, eventStore)
						result = sightingToSearchResult(wrapped)
					}

					if (result) {
						resultMap.set(eventId, result)
						setResults(Array.from(resultMap.values()))
					}
				},
				complete: () => {
					setLoading(false)
					setEose(true)
				},
				error: (err) => {
					console.error('[entity-search] subscription error', err)
					setLoading(false)
				},
			})
		}, DEBOUNCE_MS)

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
			subRef.current?.unsubscribe()
			subRef.current = null
		}
	}, [search, kinds, limit, enabled, getDatasetName])

	return { results, loading, eose }
}
