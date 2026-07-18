import { useEffect, useRef, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	getLocalBlobRevision,
	LOCAL_BLOBS_CHANGED_EVENT,
	type LocalBlobsChangedDetail,
} from '@/platform/registry'

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
	const [localBlobRevision, setLocalBlobRevision] = useState(getLocalBlobRevision)

	useEffect(() => {
		const handleLocalBlobsChanged = (event: Event) => {
			const detail = (event as CustomEvent<LocalBlobsChangedDetail>).detail
			const changed = new Set(detail?.hashes ?? [])
			for (const dataset of geoEvents) {
				if (
					dataset.id &&
					dataset.blobReferences.some(
						(reference) => reference.sha256 && changed.has(reference.sha256.toLowerCase()),
					)
				) {
					processedBlobEventsRef.current.delete(dataset.id)
				}
			}
			setLocalBlobRevision(detail?.revision ?? getLocalBlobRevision())
		}
		window.addEventListener(LOCAL_BLOBS_CHANGED_EVENT, handleLocalBlobsChanged)
		return () => window.removeEventListener(LOCAL_BLOBS_CHANGED_EVENT, handleLocalBlobsChanged)
	}, [geoEvents])

	// The revision is an explicit invalidation token: its value is not read by the resolver, but a
	// change must rerun this effect after matching processed IDs are removed above.
	// biome-ignore lint/correctness/useExhaustiveDependencies: localBlobRevision intentionally invalidates resolved blob work
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
	}, [geoEvents, ensureResolvedFeatureCollection, isMountedRef, localBlobRevision, onResolved])
}
