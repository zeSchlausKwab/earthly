import { useEffect, useRef } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'

interface UseBlobResolutionParams {
	geoEvents: GeoDataset[]
	ensureResolvedFeatureCollection: (event: GeoDataset) => Promise<GeoJSON.FeatureCollection>
	isMountedRef: React.RefObject<boolean>
	onResolved: () => void
}

export function useBlobResolution({
	geoEvents,
	ensureResolvedFeatureCollection,
	isMountedRef,
	onResolved,
}: UseBlobResolutionParams) {
	const processedBlobEventsRef = useRef<Set<string>>(new Set())

	useEffect(() => {
		let cancelled = false
		const eventsToProcess = geoEvents.filter(
			(event) =>
				event.blobReferences.length > 0 &&
				event.id &&
				!processedBlobEventsRef.current.has(event.id),
		)

		if (eventsToProcess.length === 0) return

		;(async () => {
			let resolvedAny = false
			for (const event of eventsToProcess) {
				if (cancelled) break
				try {
					await ensureResolvedFeatureCollection(event)
					if (event.id) {
						processedBlobEventsRef.current.add(event.id)
					}
					resolvedAny = true
				} catch (error) {
					console.warn('Failed to resolve external blob for dataset', event.id, error)
					if (event.id) {
						processedBlobEventsRef.current.add(event.id)
					}
				}
			}
			if (resolvedAny && isMountedRef.current && !cancelled) {
				onResolved()
			}
		})()
		return () => {
			cancelled = true
		}
	}, [geoEvents, ensureResolvedFeatureCollection, isMountedRef, onResolved])
}
