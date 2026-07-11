import type maplibregl from 'maplibre-gl'
import { useEffect } from 'react'
import { registerDisplayIconImages } from '../../icons/registerDisplayIconImages'

/**
 * Keep the bundled `displayIcon` images (Lucide subset + fallback marker)
 * registered on the map. `setStyle` (theme flips, map-source switches) wipes
 * custom images, so registration re-runs on every `style.load`. Registration
 * itself is idempotent and cached — repeat calls are cheap.
 */
export function useDisplayIconImages(map: maplibregl.Map | null, isLoaded: boolean): void {
	useEffect(() => {
		if (!map || !isLoaded) return

		registerDisplayIconImages(map)

		const onStyleLoad = () => registerDisplayIconImages(map)
		map.on('style.load', onStyleLoad)
		return () => {
			try {
				map.off('style.load', onStyleLoad)
			} catch {
				// Map may have been removed
			}
		}
	}, [map, isLoaded])
}
