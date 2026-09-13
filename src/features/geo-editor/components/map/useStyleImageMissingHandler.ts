import type { Map as MapLibreMap, MissingStyleImageResolver } from 'maplibre-gl'
import { useEffect } from 'react'
import { handleMissingDisplayIconImage } from '../../icons/registerDisplayIconImages'

/**
 * Resolve missing sprite icons before MapLibre builds their symbol layers.
 * Unavailable basemap icons receive a transparent 1×1 placeholder.
 *
 * EXCEPTION: displayIcon ids (`lucide:<name>` + the fallback marker) must never
 * receive the transparent pixel — that would make iconed points vanish
 * silently. Those ids get a VISIBLE fallback dot (and, when bundled, the real
 * glyph shortly after) via `handleMissingDisplayIconImage`.
 */
export function useStyleImageMissingHandler(map: MapLibreMap | null): void {
	useEffect(() => {
		if (!map) return

		const controller = new AbortController()
		const resolveMissingImage: MissingStyleImageResolver = (id) => {
			try {
				if (!id || controller.signal.aborted) return
				if (map.hasImage(id)) return
				if (handleMissingDisplayIconImage(map, id, controller.signal)) return

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

		map.setMissingStyleImageResolver(resolveMissingImage)
		return () => {
			controller.abort()
			try {
				map.setMissingStyleImageResolver(null)
			} catch {
				// ignore
			}
		}
	}, [map])
}
