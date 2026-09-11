import { castEvent } from 'applesauce-core/casts'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	buildPresentationSourceRequests,
	type MapPresentationAuthorization,
} from '@/lib/map-presentation/authorization'
import {
	indexPresentationSourceEvents,
	resolvePresentationLayers,
	type PresentationSourceResolution,
} from '@/lib/map-presentation/runtime'
import type {
	MapPresentationParseResult,
	MapPresentationSource,
} from '@/lib/map-presentation/types'
import {
	resolveGeoEventFeatureCollectionDetailed,
	type GeoBlobResolutionResult,
} from '@/lib/geo/resolveBlobReferences'
import { eventStore } from '@/lib/nostr'
import { GeoDataset, isGeoDataset } from '@/lib/nostr/geo-event'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import {
	getLocalBlobRevision,
	LOCAL_BLOBS_CHANGED_EVENT,
	type LocalBlobsChangedDetail,
} from '@/platform/registry'

export type PresentationBlobResolver = (event: GeoDataset) => Promise<GeoBlobResolutionResult>

export interface UsePresentationSourcesParams {
	presentation: MapPresentationParseResult
	authorization: MapPresentationAuthorization
	/** Deterministic test/native seam. */
	resolveBlobs?: PresentationBlobResolver
}

interface BlobResult {
	readonly result?: GeoBlobResolutionResult
	readonly error?: string
}

/**
 * Authorize first, then subscribe to exact Map coordinates. Unauthorized
 * layer instances never contribute a relay filter. The returned `layers` stay
 * in presentation order even though source fetches are deduplicated.
 */
export function usePresentationSources({
	presentation,
	authorization,
	resolveBlobs = resolveGeoEventFeatureCollectionDetailed,
}: UsePresentationSourcesParams) {
	const requests = useMemo(
		() => buildPresentationSourceRequests(presentation, authorization),
		[presentation, authorization],
	)
	const filters = useMemo(() => requests.map((request) => request.filter), [requests])
	const { events, eose } = useTimelineWithEose(filters.length > 0 ? filters : null)
	const sourceEvents = useMemo(
		() => events.filter(isGeoDataset).map((event) => castEvent(event, GeoDataset, eventStore)),
		[events],
	)
	const indexedEvents = useMemo(() => indexPresentationSourceEvents(sourceEvents), [sourceEvents])

	const [localBlobRevision, setLocalBlobRevision] = useState(getLocalBlobRevision)
	useEffect(() => {
		if (typeof window === 'undefined') return undefined
		const onLocalBlobsChanged = (event: Event) => {
			const detail = (event as CustomEvent<LocalBlobsChangedDetail>).detail
			setLocalBlobRevision(detail?.revision ?? getLocalBlobRevision())
		}
		window.addEventListener(LOCAL_BLOBS_CHANGED_EVENT, onLocalBlobsChanged)
		return () => window.removeEventListener(LOCAL_BLOBS_CHANGED_EVENT, onLocalBlobsChanged)
	}, [])

	const [blobResults, setBlobResults] = useState<ReadonlyMap<string, BlobResult>>(() => new Map())
	const inFlightRef = useRef(new Set<string>())
	const mountedRef = useRef(true)
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
		}
	}, [])

	useEffect(() => {
		for (const [source, event] of indexedEvents) {
			if (event.blobReferences.length === 0) continue
			const key = `${source}\u0000${event.id}\u0000${localBlobRevision}`
			if (blobResults.has(key) || inFlightRef.current.has(key)) continue
			inFlightRef.current.add(key)
			void resolveBlobs(event).then(
				(result) => {
					inFlightRef.current.delete(key)
					if (!mountedRef.current) return
					setBlobResults((current) => {
						const next = new Map(current)
						next.set(key, Object.freeze({ result }))
						return next
					})
				},
				(error) => {
					inFlightRef.current.delete(key)
					if (!mountedRef.current) return
					setBlobResults((current) => {
						const next = new Map(current)
						next.set(
							key,
							Object.freeze({ error: error instanceof Error ? error.message : String(error) }),
						)
						return next
					})
				},
			)
		}
	}, [blobResults, indexedEvents, localBlobRevision, resolveBlobs])

	const sourceStates = useMemo(() => {
		const states = new Map<MapPresentationSource, PresentationSourceResolution>()
		for (const request of requests) {
			const event = indexedEvents.get(request.source)
			if (!event) {
				states.set(request.source, { status: eose ? 'missing-source' : 'loading' })
				continue
			}
			if (event.blobReferences.length === 0) {
				states.set(request.source, {
					status: 'resolved',
					sourceEvent: event,
					featureCollection: event.featureCollection,
				})
				continue
			}

			const key = `${request.source}\u0000${event.id}\u0000${localBlobRevision}`
			const blob = blobResults.get(key)
			if (!blob) {
				states.set(request.source, { status: 'loading' })
				continue
			}
			if (blob.error) {
				states.set(request.source, {
					status: 'blob-error',
					sourceEvent: event,
					error: blob.error,
				})
				continue
			}
			const result = blob.result
			if (!result || result.failures.length > 0) {
				states.set(request.source, {
					status: 'blob-error',
					sourceEvent: event,
					error:
						result?.failures.map((failure) => failure.message).join('; ') ||
						'External Map data could not be resolved.',
				})
				continue
			}
			states.set(request.source, {
				status: 'resolved',
				sourceEvent: event,
				featureCollection: result.featureCollection,
			})
		}
		return states
	}, [blobResults, eose, indexedEvents, localBlobRevision, requests])

	const runtime = useMemo(
		() => resolvePresentationLayers(presentation, authorization, sourceStates),
		[presentation, authorization, sourceStates],
	)

	return Object.freeze({
		...runtime,
		filters,
		eose,
		sourceEvents,
	})
}
