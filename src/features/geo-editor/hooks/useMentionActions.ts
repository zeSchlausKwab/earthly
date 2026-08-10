import { useCallback } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace'
import { privateDatasetStackEntryId } from '@/features/private-maps/privateDatasetStack'
import { geoReferenceLabel, parseGeoReference } from '@/lib/geo/reference'
import { datasetReferenceEntryId } from '../referenceMapStack'
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
	// Round D.3: mention visibility toggles stack membership. A ref that is
	// already on the stack (e.g. a Story's auto-stacked `source:'story'` entry)
	// flips visibility IN PLACE via setMapStackEntryVisible — preserving its
	// source/order/pin and keeping the resolver-driven chip in sync. A ref not yet
	// stacked (e.g. a comment ref) is added on show.
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
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
			const spatialReference = parseGeoReference(address)
			if (spatialReference?.kind === 'coordinate') {
				handleZoomToBounds([
					spatialReference.longitude,
					spatialReference.latitude,
					spatialReference.longitude,
					spatialReference.latitude,
				])
				return
			}
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
		(address: string, featureId: string | undefined, visible: boolean) => {
			const spatialReference = parseGeoReference(address)
			if (spatialReference?.kind === 'coordinate') {
				const entryId = `coordinate:${address}`
				const existing = mapStackEntries[entryId]
				if (existing) {
					setMapStackEntryVisible(entryId, visible)
				} else if (visible) {
					addMapStackEntry({
						id: entryId,
						entityType: 'coordinate',
						entityKey: address,
						title: geoReferenceLabel(spatialReference),
						source: 'comment',
						visible: true,
						pinned: false,
					})
				}
				return
			}
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}
			const key = getDatasetKey(dataset)
			const privateWorkspaceId = privateWorkspaceIdForDataset(dataset)
			const privateEntryId = privateWorkspaceId
				? privateDatasetStackEntryId(privateWorkspaceId, key)
				: undefined
			const entryId =
				privateEntryId && !featureId ? privateEntryId : datasetReferenceEntryId(key, featureId)
			const existingEntry = mapStackEntries[entryId]
			if (existingEntry) {
				// Already stacked (auto-stacked Story ref, or a previously-shown ref):
				// flip visibility in place so source/order/pin survive and the
				// resolver-backed chip icon tracks the map exactly.
				setMapStackEntryVisible(existingEntry.id, visible)
			} else if (visible) {
				const collectionName = (
					dataset.featureCollection as GeoJSON.FeatureCollection & { name?: unknown }
				).name
				const collection = resolvedCollectionResolver?.(dataset) ?? dataset.featureCollection
				const referencedFeature = featureId
					? collection.features.find(
							(feature) => String(feature.id) === featureId || feature.properties?.id === featureId,
						)
					: undefined
				const featureTitle =
					typeof referencedFeature?.properties?.name === 'string'
						? referencedFeature.properties.name
						: featureId
				addMapStackEntry({
					id: entryId,
					entityType: 'dataset',
					entityKey: key,
					title:
						featureTitle ||
						(typeof collectionName === 'string' && collectionName) ||
						dataset.dTag ||
						dataset.id,
					featureIds: featureId ? [featureId] : undefined,
					source: privateWorkspaceId ? 'private-group' : 'comment',
					visible: true,
					pinned: false,
				})
			}
		},
		[
			resolveNaddrToDataset,
			getDatasetKey,
			addMapStackEntry,
			setMapStackEntryVisible,
			mapStackEntries,
			resolvedCollectionResolver,
		],
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
