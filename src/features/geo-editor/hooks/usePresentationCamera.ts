import { bbox as turfBbox } from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type * as maplibregl from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { MapPresentationCameraV1 } from '@/lib/map-presentation'

export interface PresentationCameraIntent {
	/** Stable carrier identity (Story/Atlas address, not replaceable event id). */
	readonly carrierId: string
	/**
	 * Stable intent identity. Use `opening` for initial state and a new activation
	 * token for each explicit view action that should be replayable.
	 */
	readonly intentId: string
	readonly camera?: MapPresentationCameraV1
	/** Exact, already-selected render collection; never a whole-source fallback. */
	readonly fitFeatureCollection?: FeatureCollection
	readonly animated?: boolean
	readonly duration?: number
	readonly padding?: number
	readonly fitMaxZoom?: number
}

export interface PresentationCameraMap {
	easeTo(options: maplibregl.EaseToOptions): unknown
	jumpTo(options: maplibregl.JumpToOptions): unknown
	fitBounds(bounds: maplibregl.LngLatBoundsLike, options?: maplibregl.FitBoundsOptions): unknown
}

export function presentationCameraIntentKey(
	intent: Pick<PresentationCameraIntent, 'carrierId' | 'intentId'>,
): string {
	return JSON.stringify([intent.carrierId, intent.intentId])
}

export function exactPresentationBounds(
	collection: FeatureCollection | undefined,
): [number, number, number, number] | null {
	if (!collection || collection.features.length === 0) return null
	try {
		const bounds = turfBbox(collection)
		if (
			bounds.length !== 4 ||
			!bounds.every((value) => typeof value === 'number' && Number.isFinite(value))
		) {
			return null
		}
		const [west, south, east, north] = bounds
		if (west === undefined || south === undefined || east === undefined || north === undefined) {
			return null
		}
		return [west, south, east, north]
	} catch {
		return null
	}
}

/**
 * Apply a camera action at most once for its carrier/intent pair. Failed or
 * not-yet-resolved fit targets are not consumed, so resolution can retry.
 */
export function applyPresentationCameraIntent(
	map: PresentationCameraMap,
	intent: PresentationCameraIntent,
	appliedIntentKeys: Set<string>,
): boolean {
	const key = presentationCameraIntentKey(intent)
	if (appliedIntentKeys.has(key)) return false

	if (intent.camera) {
		const cameraOptions = {
			center: [...intent.camera.center] as [number, number],
			zoom: intent.camera.zoom,
			// Sparse views still reset these axes rather than inheriting stale tilt.
			bearing: intent.camera.bearing ?? 0,
			pitch: intent.camera.pitch ?? 0,
		}
		if (intent.animated === false) map.jumpTo(cameraOptions)
		else map.easeTo({ ...cameraOptions, duration: intent.duration ?? 500 })
		appliedIntentKeys.add(key)
		return true
	}

	const bounds = exactPresentationBounds(intent.fitFeatureCollection)
	if (!bounds) return false
	map.fitBounds(
		[
			[bounds[0], bounds[1]],
			[bounds[2], bounds[3]],
		],
		{
			padding: intent.padding ?? 40,
			duration: intent.animated === false ? 0 : (intent.duration ?? 500),
			maxZoom: intent.fitMaxZoom ?? 16,
			bearing: 0,
			pitch: 0,
		},
	)
	appliedIntentKeys.add(key)
	return true
}

export interface UsePresentationCameraOptions {
	readonly mapRef: React.RefObject<MapLibreMap | null>
	readonly mounted: boolean
	readonly intent: PresentationCameraIntent | null
}

export function usePresentationCamera({
	mapRef,
	mounted,
	intent,
}: UsePresentationCameraOptions): void {
	const appliedIntentKeysRef = useRef(new Set<string>())
	const mapInstanceRef = useRef<MapLibreMap | null>(null)

	useEffect(() => {
		const map = mapRef.current
		if (!map || !mounted || !intent) return
		if (mapInstanceRef.current !== map) {
			mapInstanceRef.current = map
			appliedIntentKeysRef.current.clear()
		}
		applyPresentationCameraIntent(map, intent, appliedIntentKeysRef.current)
	}, [intent, mapRef, mounted])
}
