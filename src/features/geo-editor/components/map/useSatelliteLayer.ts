import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { resolveSatelliteComposition, useSatelliteSettings } from '@/lib/satellite'
import { SatelliteLayerController } from './satelliteLayer'

export function useSatelliteLayer(
	map: MapLibreMap | null,
	isLoaded: boolean,
	isDefaultSource: boolean,
): void {
	const [settings] = useSatelliteSettings()
	const settingsRef = useRef(settings)
	const controllerRef = useRef<SatelliteLayerController | null>(null)

	useEffect(() => {
		settingsRef.current = settings
		controllerRef.current?.apply(resolveSatelliteComposition(settings))
	}, [settings])

	useEffect(() => {
		if (!map || !isLoaded || !isDefaultSource) return
		const controller = new SatelliteLayerController(map)
		controllerRef.current = controller
		const onStyleLoad = () => {
			controller.reset()
			controller.apply(resolveSatelliteComposition(settingsRef.current))
		}
		map.on('style.load', onStyleLoad)
		controller.apply(resolveSatelliteComposition(settingsRef.current))
		return () => {
			controllerRef.current = null
			map.off('style.load', onStyleLoad)
			controller.remove()
		}
	}, [map, isLoaded, isDefaultSource])
}
