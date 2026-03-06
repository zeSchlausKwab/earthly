import { useCallback, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'

export function useProposalGeometry(mapRef: React.RefObject<maplibregl.Map | null>) {
	const proposalGeometryLayers = useRef<Map<string, { sourceId: string; layerIds: string[] }>>(
		new Map(),
	)
	const [visibleProposalIds, setVisibleProposalIds] = useState<Set<string>>(new Set())

	const handleToggleProposalOverlay = useCallback(
		(proposal: NDKGeoEditProposalEvent, visible: boolean) => {
			if (!mapRef.current) return

			const proposalId = proposal.id ?? proposal.proposalId ?? ''
			const mapInstance = mapRef.current
			const existing = proposalGeometryLayers.current.get(proposalId)

			// Remove existing layers for this proposal
			if (existing) {
				for (const layerId of existing.layerIds) {
					if (mapInstance.getLayer(layerId)) {
						mapInstance.removeLayer(layerId)
					}
				}
				if (mapInstance.getSource(existing.sourceId)) {
					mapInstance.removeSource(existing.sourceId)
				}
				proposalGeometryLayers.current.delete(proposalId)
			}

			// Update visible set
			setVisibleProposalIds((prev) => {
				const next = new Set(prev)
				if (visible) {
					next.add(proposalId)
				} else {
					next.delete(proposalId)
				}
				return next
			})

			// If hiding, we're done
			if (!visible) return

			const geojson = proposal.featureCollection
			if (!geojson || geojson.features.length === 0) return

			// Add new layers with blue styling
			const sourceId = `proposal-geo-${proposalId}`
			const fillLayerId = `proposal-fill-${proposalId}`
			const lineLayerId = `proposal-line-${proposalId}`
			const pointLayerId = `proposal-point-${proposalId}`

			mapInstance.addSource(sourceId, {
				type: 'geojson',
				data: geojson,
			})

			// Fill layer for polygons
			mapInstance.addLayer({
				id: fillLayerId,
				type: 'fill',
				source: sourceId,
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: {
					'fill-color': '#3b82f6',
					'fill-opacity': 0.25,
				},
			})

			// Line layer
			mapInstance.addLayer({
				id: lineLayerId,
				type: 'line',
				source: sourceId,
				filter: [
					'any',
					['==', ['geometry-type'], 'LineString'],
					['==', ['geometry-type'], 'Polygon'],
				],
				paint: {
					'line-color': '#3b82f6',
					'line-width': 2,
					'line-dasharray': [4, 3],
				},
			})

			// Point layer
			mapInstance.addLayer({
				id: pointLayerId,
				type: 'circle',
				source: sourceId,
				filter: ['==', ['geometry-type'], 'Point'],
				paint: {
					'circle-color': '#3b82f6',
					'circle-radius': 6,
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
				},
			})

			proposalGeometryLayers.current.set(proposalId, {
				sourceId,
				layerIds: [fillLayerId, lineLayerId, pointLayerId],
			})
		},
		[mapRef],
	)

	return {
		visibleProposalIds,
		handleToggleProposalOverlay,
	}
}
