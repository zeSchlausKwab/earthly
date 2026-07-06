import { useCallback, useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import { earthlyGeoServer } from '@/ctxcn'
import { createAuthoring } from '../api'
import type { EditorFeature } from '../core'
import { useEditorStore } from '../store'

export function useOsmQuery(
	mapRef: React.RefObject<maplibregl.Map | null>,
	editor: { addFeature: (f: EditorFeature) => void } | null,
) {
	const osmQueryMode = useEditorStore((state) => state.osmQueryMode)
	const osmQueryFilter = useEditorStore((state) => state.osmQueryFilter)
	const setOsmQueryMode = useEditorStore((state) => state.setOsmQueryMode)
	const setOsmQueryPosition = useEditorStore((state) => state.setOsmQueryPosition)
	const setOsmQueryResults = useEditorStore((state) => state.setOsmQueryResults)
	const setOsmQueryError = useEditorStore((state) => state.setOsmQueryError)
	const clearOsmQuery = useEditorStore((state) => state.clearOsmQuery)

	const handleOsmQueryClick = useCallback(() => {
		setOsmQueryMode('click')
	}, [setOsmQueryMode])

	const executeOsmQuery = useCallback(
		async (lat: number, lon: number, screenX: number, screenY: number) => {
			setOsmQueryMode('loading')
			setOsmQueryPosition({ x: screenX, y: screenY, lat, lon })
			setOsmQueryError(null)
			setOsmQueryResults([])

			try {
				const filters = osmQueryFilter === 'all' ? undefined : { [osmQueryFilter]: '*' }
				const response = await earthlyGeoServer.QueryOsmNearby(lat, lon, 200, filters, 30)

				if (!response?.result) {
					setOsmQueryError('Failed to query OSM - no response')
					setOsmQueryMode('idle')
					return
				}

				setOsmQueryResults((response.result.features ?? []) as GeoJSON.Feature[])
				setOsmQueryMode('idle')
			} catch (err: any) {
				setOsmQueryError(err.message || 'Failed to query OSM')
				setOsmQueryMode('idle')
			}
		},
		[osmQueryFilter, setOsmQueryMode, setOsmQueryPosition, setOsmQueryError, setOsmQueryResults],
	)

	const handleOsmQueryView = useCallback(async () => {
		if (!mapRef.current) return
		const bounds = mapRef.current.getBounds()
		const center = mapRef.current.getCenter()
		const container = mapRef.current.getContainer()

		setOsmQueryMode('loading')
		setOsmQueryPosition({
			x: container.clientWidth / 2,
			y: container.clientHeight / 2,
			lat: center.lat,
			lon: center.lng,
		})
		setOsmQueryError(null)
		setOsmQueryResults([])

		try {
			const filters = osmQueryFilter === 'all' ? undefined : { [osmQueryFilter]: '*' }
			const response = await earthlyGeoServer.QueryOsmBbox(
				bounds.getWest(),
				bounds.getSouth(),
				bounds.getEast(),
				bounds.getNorth(),
				filters,
				30,
			)

			if (!response?.result) {
				setOsmQueryError('Failed to query OSM - no response')
				setOsmQueryMode('idle')
				return
			}

			setOsmQueryResults((response.result.features ?? []) as GeoJSON.Feature[])
			setOsmQueryMode('idle')
		} catch (err: any) {
			setOsmQueryError(err.message || 'Failed to query OSM')
			setOsmQueryMode('idle')
		}
	}, [osmQueryFilter, setOsmQueryMode, setOsmQueryPosition, setOsmQueryError, setOsmQueryResults])

	const handleOsmImport = useCallback(
		(features: GeoJSON.Feature[]) => {
			if (!editor) return
			// INFRA-02: route OSM imports through the Authoring API (append, dedup-by-id).
			createAuthoring(editor).writeGeoJSON(features, { replace: false })
		},
		[editor],
	)

	// Map click handler for OSM query mode
	useEffect(() => {
		if (!mapRef.current || osmQueryMode !== 'click') return
		const mapInstance = mapRef.current

		const handleMapClick = (e: maplibregl.MapMouseEvent) => {
			const { lng, lat } = e.lngLat
			executeOsmQuery(lat, lng, e.point.x, e.point.y)
		}

		mapInstance.getCanvas().style.cursor = 'crosshair'
		mapInstance.once('click', handleMapClick)

		return () => {
			mapInstance.getCanvas().style.cursor = ''
			mapInstance.off('click', handleMapClick)
		}
	}, [osmQueryMode, executeOsmQuery])

	return {
		handleOsmQueryClick,
		handleOsmQueryView,
		handleOsmImport,
		clearOsmQuery,
	}
}
