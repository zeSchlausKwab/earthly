import { castEvent } from 'applesauce-core/casts'
import type { Filter } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Subscription } from 'rxjs'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { eventStore, pool, readRelaysFor } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { MapContext } from '@/lib/nostr/map-context'
import {
	type EntitySearchResult,
	type EntityType,
	contextToSearchResult,
	datasetToSearchResult,
} from './types'

const KIND_TO_TYPE: Record<number, EntityType> = {
	[GEO_EVENT_KIND]: 'dataset',
	[MAP_CONTEXT_KIND]: 'context',
}

const DEBOUNCE_MS = 300
const DEFAULT_RELAY_ENTITY_TYPES: EntityType[] = ['dataset', 'context']

interface UseRelayEntitySearchOptions {
	query: string
	entityTypes?: EntityType[]
	limit?: number
	enabled?: boolean
	getDatasetName?: (event: GeoDataset) => string
}

/**
 * NIP-50 (relay-side search) for datasets and contexts. Uses `pool.req` so
 * the subscription completes on EOSE (one-shot search, no live updates).
 *
 * Searches are routed through the relay router's content bucket: local relay
 * in dev (public only with the allowPublicReads dev flag), configured read
 * relays in prod.
 */
export function useRelayEntitySearch({
	query,
	entityTypes,
	limit = 20,
	enabled = true,
	getDatasetName,
}: UseRelayEntitySearchOptions) {
	const [results, setResults] = useState<EntitySearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [eose, setEose] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subRef = useRef<Subscription | null>(null)

	const activeTypes = useMemo(() => entityTypes ?? DEFAULT_RELAY_ENTITY_TYPES, [entityTypes])

	const kinds = useMemo(() => {
		const k: number[] = []
		if (activeTypes.includes('dataset')) k.push(GEO_EVENT_KIND)
		if (activeTypes.includes('context')) k.push(MAP_CONTEXT_KIND)
		return k
	}, [activeTypes])

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		subRef.current?.unsubscribe()
		subRef.current = null

		const trimmed = query.trim()
		if (!trimmed || !enabled || kinds.length === 0) {
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
				search: trimmed,
				limit,
			}

			subRef.current = pool.request(readRelaysFor('content'), filter).subscribe({
				next: (event) => {
					const kind = event.kind as number
					const eventId = event.id as string
					if (resultMap.has(eventId)) return

					const entityType = KIND_TO_TYPE[kind]
					if (!entityType) return

					let result: EntitySearchResult | null = null
					if (entityType === 'dataset') {
						const wrapped = castEvent(event, GeoDataset, eventStore)
						result = datasetToSearchResult(wrapped, getDatasetName)
					} else if (entityType === 'context') {
						const wrapped = castEvent(event, MapContext, eventStore)
						result = contextToSearchResult(wrapped)
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
	}, [query, kinds, limit, enabled, getDatasetName])

	return { results, loading, eose }
}
