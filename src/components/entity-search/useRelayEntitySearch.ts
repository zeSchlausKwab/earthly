import { useNDK } from '@nostr-dev-kit/react'
import { castEvent } from 'applesauce-core/casts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/ndk/kinds'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
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

export function useRelayEntitySearch({
	query,
	entityTypes,
	limit = 20,
	enabled = true,
	getDatasetName,
}: UseRelayEntitySearchOptions) {
	const { ndk } = useNDK()
	const [results, setResults] = useState<EntitySearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [eose, setEose] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subscriptionRef = useRef<{ stop: () => void } | null>(null)

	const activeTypes = useMemo(() => entityTypes ?? DEFAULT_RELAY_ENTITY_TYPES, [entityTypes])

	const kinds = useMemo(() => {
		const k: number[] = []
		if (activeTypes.includes('dataset')) k.push(GEO_EVENT_KIND)
		if (activeTypes.includes('context')) k.push(MAP_CONTEXT_KIND)
		return k
	}, [activeTypes])

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		if (subscriptionRef.current) {
			subscriptionRef.current.stop()
			subscriptionRef.current = null
		}

		const trimmed = query.trim()
		if (!trimmed || !ndk || !enabled || kinds.length === 0) {
			setResults([])
			setLoading(false)
			setEose(false)
			return
		}

		setLoading(true)
		setEose(false)

		debounceRef.current = setTimeout(() => {
			const resultMap = new Map<string, EntitySearchResult>()

			// biome-ignore lint/suspicious/noExplicitAny: NDK types don't include NIP-50 `search` field
			const sub = ndk.subscribe({ kinds, search: trimmed, limit } as any, { closeOnEose: true })
			subscriptionRef.current = sub

			// biome-ignore lint/suspicious/noExplicitAny: NDK subscription event type is loosely typed
			sub.on('event', (event: any) => {
				const kind = event.kind as number
				const eventId = event.id as string
				if (resultMap.has(eventId)) return

				const entityType = KIND_TO_TYPE[kind]
				if (!entityType) return

				let result: EntitySearchResult | null = null
				if (entityType === 'dataset') {
					const raw = (event as { rawEvent?: () => unknown }).rawEvent?.() ?? event
					// biome-ignore lint/suspicious/noExplicitAny: NDK event shape varies; cast accepts the standard NostrEvent fields
					const wrapped = castEvent(raw as any, GeoDataset, eventStore)
					result = datasetToSearchResult(wrapped, getDatasetName)
				} else if (entityType === 'context') {
					const wrapped = NDKMapContextEvent.from(event)
					result = contextToSearchResult(wrapped)
				}

				if (result) {
					resultMap.set(eventId, result)
					setResults(Array.from(resultMap.values()))
				}
			})

			sub.on('eose', () => {
				setLoading(false)
				setEose(true)
			})
		}, DEBOUNCE_MS)

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
			if (subscriptionRef.current) {
				subscriptionRef.current.stop()
				subscriptionRef.current = null
			}
		}
	}, [ndk, query, kinds, limit, enabled, getDatasetName])

	return { results, loading, eose }
}
