import { useEffect, useRef, useState } from 'react'
import { earthlyGeoServer } from '@/ctxcn'
import { placeToSearchResult, type EntitySearchResult } from './types'

const PLACE_SEARCH_DEBOUNCE_MS = 300

interface UsePlaceEntitySearchOptions {
	query: string
	limit?: number
	enabled?: boolean
}

/**
 * Search Places through Earthly's existing ContextVM geocoder seam.
 *
 * The hook deliberately does not call a new HTTP service. A monotonically
 * increasing request id discards late responses because the generated MCP
 * client does not expose AbortSignal support.
 */
export function usePlaceEntitySearch({
	query,
	limit = 5,
	enabled = true,
}: UsePlaceEntitySearchOptions) {
	const [results, setResults] = useState<EntitySearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const requestIdRef = useRef(0)

	useEffect(() => {
		const trimmed = query.trim()
		const requestId = ++requestIdRef.current
		if (!enabled || !trimmed) {
			setResults([])
			setLoading(false)
			setError(null)
			return
		}

		setLoading(true)
		setError(null)
		const timer = setTimeout(() => {
			void earthlyGeoServer
				.SearchLocation(trimmed, limit)
				.then((response) => {
					if (requestIdRef.current !== requestId) return
					const places = response.result?.results ?? []
					setResults(
						places
							.filter(
								(place) =>
									place &&
									typeof place.placeId === 'number' &&
									typeof place.displayName === 'string' &&
									Number.isFinite(place.coordinates?.lat) &&
									Number.isFinite(place.coordinates?.lon),
							)
							.map(placeToSearchResult),
					)
				})
				.catch((cause: unknown) => {
					if (requestIdRef.current !== requestId) return
					setResults([])
					setError(cause instanceof Error ? cause.message : 'Place search failed')
				})
				.finally(() => {
					if (requestIdRef.current === requestId) setLoading(false)
				})
		}, PLACE_SEARCH_DEBOUNCE_MS)

		return () => clearTimeout(timer)
	}, [enabled, limit, query])

	return { results, loading, error }
}
