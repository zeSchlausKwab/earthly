import { useCallback } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { useEditorStore } from '../store'

interface UseMentionActionsParams {
	geoEvents: GeoDataset[]
	resolvedCollectionResolver: (event: GeoDataset) => GeoJSON.FeatureCollection | null | undefined
	handleZoomToBounds: (bounds: [number, number, number, number]) => void
	zoomToDataset: (event: GeoDataset) => void
	getDatasetKey: (event: GeoDataset) => string
	isFocused: boolean
	clearFocus: () => void
	toggleDatasetVisibility: (event: GeoDataset) => void
	toggleAllDatasetVisibility: (visible: boolean) => void
}

export function useMentionActions({
	geoEvents,
	resolvedCollectionResolver,
	handleZoomToBounds,
	zoomToDataset,
	getDatasetKey,
	isFocused,
	clearFocus,
	toggleDatasetVisibility,
	toggleAllDatasetVisibility,
}: UseMentionActionsParams) {
	// Round D.3: mention visibility now toggles stack membership instead of
	// the deprecated `datasetVisibility` slice. Adding for visibility, removing
	// for hide — the eye toggle in mention UIs maps cleanly to add/remove.
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)

	const resolveNaddrToDataset = useCallback(
		(address: string): GeoDataset | null => {
			if (!address?.startsWith('naddr1')) {
				return null
			}
			try {
				const { nip19 } = require('nostr-tools')
				const decoded = nip19.decode(address)
				if (decoded.type !== 'naddr') return null

				const { kind, pubkey, identifier } = decoded.data

				return (
					geoEvents.find(
						(ev) =>
							ev.kind === kind &&
							ev.pubkey === pubkey &&
							(ev.datasetId === identifier || ev.dTag === identifier || ev.id === identifier),
					) ?? null
				)
			} catch {
				console.warn('Failed to decode naddr:', address)
				return null
			}
		},
		[geoEvents],
	)

	const handleMentionZoomTo = useCallback(
		(address: string, featureId: string | undefined) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}

			const collection = resolvedCollectionResolver?.(dataset) ?? dataset.featureCollection

			if (featureId) {
				const feature = collection?.features.find(
					(f) => f.id === featureId || String(f.id) === featureId || f.properties?.id === featureId,
				)
				if (feature?.geometry) {
					import('@turf/turf')
						.then((turf) => {
							const bbox = turf.bbox(feature) as [number, number, number, number]
							if (bbox.every((v) => Number.isFinite(v))) {
								handleZoomToBounds(bbox)
							}
						})
						.catch(() => {
							zoomToDataset(dataset)
						})
				} else {
					zoomToDataset(dataset)
				}
			} else {
				zoomToDataset(dataset)
			}
		},
		[resolveNaddrToDataset, resolvedCollectionResolver, handleZoomToBounds, zoomToDataset],
	)

	const handleMentionVisibilityToggle = useCallback(
		(address: string, _featureId: string | undefined, visible: boolean) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}
			const key = getDatasetKey(dataset)
			const entryId = `dataset:${key}`
			if (visible) {
				const collectionName = (
					dataset.featureCollection as GeoJSON.FeatureCollection & { name?: unknown }
				).name
				addMapStackEntry({
					entityType: 'dataset',
					entityKey: key,
					title:
						(typeof collectionName === 'string' && collectionName) || dataset.dTag || dataset.id,
					source: 'comment',
					visible: true,
					pinned: false,
				})
			} else if (mapStackEntries[entryId]) {
				removeMapStackEntry(entryId)
			}
		},
		[resolveNaddrToDataset, getDatasetKey, addMapStackEntry, removeMapStackEntry, mapStackEntries],
	)

	const handleToggleVisibilityWithExitFocus = useCallback(
		(event: GeoDataset) => {
			if (isFocused) {
				clearFocus()
			}
			toggleDatasetVisibility(event)
		},
		[isFocused, clearFocus, toggleDatasetVisibility],
	)

	const handleToggleAllVisibilityWithExitFocus = useCallback(
		(visible: boolean) => {
			if (isFocused) {
				clearFocus()
			}
			toggleAllDatasetVisibility(visible)
		},
		[isFocused, clearFocus, toggleAllDatasetVisibility],
	)

	return {
		resolveNaddrToDataset,
		handleMentionZoomTo,
		handleMentionVisibilityToggle,
		handleToggleVisibilityWithExitFocus,
		handleToggleAllVisibilityWithExitFocus,
	}
}
