import type maplibregl from 'maplibre-gl'
import { useEffect } from 'react'

/**
 * MapLibre crashes on styles that reference missing sprite icons. We listen
 * for `styleimagemissing` and supply a transparent 1×1 placeholder so the
 * symbol layer still renders without errors.
 */
export function useStyleImageMissingHandler(map: maplibregl.Map | null): void {
	useEffect(() => {
		if (!map) return

		const onStyleImageMissing = (e: maplibregl.MapStyleImageMissingEvent) => {
			try {
				const id = e.id
				if (!id) return
				if (map.hasImage(id)) return

				const imageData:
					| ImageData
					| { width: number; height: number; data: Uint8Array | Uint8ClampedArray } =
					typeof ImageData !== 'undefined'
						? new ImageData(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
						: { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) }
				map.addImage(id, imageData)
			} catch {
				// ignore
			}
		}

		map.on('styleimagemissing', onStyleImageMissing)
		return () => {
			try {
				map.off('styleimagemissing', onStyleImageMissing)
			} catch {
				// ignore
			}
		}
	}, [map])
}
