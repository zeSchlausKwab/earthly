import type maplibregl from 'maplibre-gl'
import { useEffect } from 'react'
import { PMTiles } from 'pmtiles'
import { pmtilesCache } from './pmtilesProtocols'
import type { MapSource } from './types'

/**
 * For `pmtiles` map sources with `boundsLocked` (default: true), read the
 * PMTiles header and constrain `maxBounds` to the dataset's natural extent
 * (with 50% padding so users can zoom out a bit). Also `fitBounds()` once on
 * apply.
 *
 * Clears any bounds constraint when the source changes type or when locking
 * is disabled.
 */
export function usePmtilesBoundsLock(
	map: maplibregl.Map | null,
	isLoaded: boolean,
	mapSource: MapSource,
): void {
	useEffect(() => {
		if (!map || !isLoaded) return

		const shouldLock = mapSource.type === 'pmtiles' && (mapSource.boundsLocked ?? true)

		if (!shouldLock) {
			try {
				map.setMaxBounds(null)
				map.setMinZoom(0)
			} catch {
				// ignore
			}
			return
		}

		let pmtilesUrl = mapSource.url
		if (mapSource.location === 'local' && mapSource.file) {
			pmtilesUrl = URL.createObjectURL(mapSource.file)
		}
		if (!pmtilesUrl) return

		let cancelled = false
		;(async () => {
			try {
				let pm = pmtilesCache[pmtilesUrl as string]
				if (!pm) {
					pm = new PMTiles(pmtilesUrl as string)
					pmtilesCache[pmtilesUrl as string] = pm
				}

				const header = await pm.getHeader()
				if (cancelled) return

				const { minLon, minLat, maxLon, maxLat } = header

				if (
					!Number.isFinite(minLon) ||
					!Number.isFinite(minLat) ||
					!Number.isFinite(maxLon) ||
					!Number.isFinite(maxLat)
				) {
					return
				}

				// 50% padding so users can zoom out beyond the bbox.
				const lonRange = maxLon - minLon
				const latRange = maxLat - minLat
				const lonPadding = lonRange * 0.5
				const latPadding = latRange * 0.5
				const bounds: maplibregl.LngLatBoundsLike = [
					[minLon - lonPadding, minLat - latPadding],
					[maxLon + lonPadding, maxLat + latPadding],
				]

				try {
					map.setMaxBounds(bounds)
					// Fit to the actual extent (not the padded one).
					map.fitBounds(
						[
							[minLon, minLat],
							[maxLon, maxLat],
						],
						{ padding: 40, duration: 500 },
					)
				} catch (err) {
					console.warn('Failed to set map bounds:', err)
				}
			} catch (err) {
				console.warn('Failed to read PMTiles header for bounds:', err)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [
		map,
		isLoaded,
		mapSource.type,
		mapSource.url,
		mapSource.file,
		mapSource.location,
		mapSource.boundsLocked,
	])
}
