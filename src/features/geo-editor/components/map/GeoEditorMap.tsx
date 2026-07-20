import type maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
// Aliased so we don't shadow the JS built-in `Map` constructor in this module.
import { Map as McnMap, MapControls, useMap, type LocateCoords } from '@/components/ui/map'
import { resolveBasemapStyles, useBasemapStyle } from '@/lib/basemap'
import { config } from '@/config/env.client'
import { readStoredMapViewport, writeStoredMapViewport } from '@/lib/mapSession'
import { ensurePmtilesProtocolsRegistered } from './pmtilesProtocols'
import { DEFAULT_STYLE_URL, useBlossomOverlays, useMapSourceStyle } from './useMapSourceStyle'
import { useMapLayerStateSync } from './useMapLayerStateSync'
import { useDisplayIconImages } from './useDisplayIconImages'
import { useNostrMapLayerAnnouncements } from './useNostrMapLayerAnnouncements'
import { usePmtilesBoundsLock } from './usePmtilesBoundsLock'
import { useStyleImageMissingHandler } from './useStyleImageMissingHandler'
import type { MapSource } from './types'

// Register pmtiles + pmworld protocols once per module load. Both flags inside
// the module are idempotent against repeated calls; we run at import time so
// any code path that mounts a map gets working tile resolution.
ensurePmtilesProtocolsRegistered()

const DEFAULT_CENTER: [number, number] = [0, 0]
const DEFAULT_ZOOM = 2

/**
 * Subset of locate coordinates surfaced to consumers. We translate mapcn's
 * `{longitude, latitude, accuracy}` to the project's existing `{lon, lat,
 * accuracy}` shape so the existing `userLocation` state + `UserLocationMarker`
 * keep working unchanged.
 */
export type GeoEditorLocate = { lon: number; lat: number; accuracy?: number } | null

export interface GeoEditorMapProps {
	/** Initial style for the `default` map source. Ignored for pmtiles/blossom. */
	style?: string | maplibregl.StyleSpecification
	center?: [number, number]
	zoom?: number
	children?: ReactNode
	className?: string
	/** Fired exactly once when the map is fully loaded. */
	onLoad?: (map: maplibregl.Map) => void
	mapSource?: MapSource
	/**
	 * Whether to render mapcn's built-in MapControls (zoom + compass + locate +
	 * fullscreen + pitch + globe). Default: true. Set false to render your own
	 * controls inside `children`.
	 */
	showControls?: boolean
	/** Position of the controls group. Default: 'bottom-right'. */
	controlsPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
	/** Include the pitch (3D) toggle. Default: true when showControls is true. */
	showPitch?: boolean
	/** Include the mercator/globe projection toggle. Default: true when showControls is true. */
	showGlobe?: boolean
	/** Include the built-in locate control. Default: true. */
	showLocate?: boolean
	/** Collapse MapLibre attribution behind its info button. Default: true. */
	attributionCompact?: boolean
	/**
	 * Extra controls rendered inside the MapControls column, after the built-in
	 * groups. Use `ControlGroup` + `ControlButton` from `@/components/ui/map`
	 * to match the visual style.
	 */
	controlsChildren?: ReactNode
	/**
	 * Fired by the locate control with the user's tracked position, or `null`
	 * when tracking stops. Continuous tracking + accuracy preserved from the
	 * pre-swap LocateButton — see the `enableLocateTracking` flag in
	 * `@/components/ui/map`.
	 */
	onLocate?: (coords: GeoEditorLocate) => void
	/** Fired when the browser or operating system rejects a location request. */
	onLocateError?: (error: GeolocationPositionError | Error) => void
}

/**
 * Project's map component, layered on top of mapcn's `<Map>` primitive.
 *
 * mapcn gives us:
 *   - lifecycle (init/cleanup/setStyle/resize)
 *   - theme detection (system + document class)
 *   - controlled viewport
 *   - the `useMap()` context + hook
 *
 * We layer on:
 *   - three map source modes (default / pmtiles / blossom)
 *   - `pmtiles://` + `pmworld://` MapLibre protocols
 *   - Nostr kind 34444 layer-set discovery and layer-state UI sync
 *   - PMTiles bounds locking
 *   - missing-sprite fallback
 *
 * Public surface and consumer contract are identical to the pre-mapcn
 * implementation: same prop names, same `useMap()` hook shape.
 */
export function GeoEditorMap({
	style: initialStyle,
	center: centerProp,
	zoom: zoomProp,
	children,
	className = 'w-full h-full',
	onLoad,
	mapSource = { type: 'default', location: 'remote' },
	showControls = true,
	controlsPosition = 'bottom-right',
	showPitch = true,
	showGlobe = true,
	showLocate = true,
	attributionCompact = true,
	controlsChildren,
	onLocate,
	onLocateError,
}: GeoEditorMapProps) {
	const storedViewport = useMemo(() => readStoredMapViewport(), [])
	const center = centerProp ?? storedViewport?.center ?? DEFAULT_CENTER
	const zoom = zoomProp ?? storedViewport?.zoom ?? DEFAULT_ZOOM

	// Nostr layer-set discovery (kind 34444). Drives `useEditorStore.mapLayers`
	// and surfaces `tileSourceMaxZoom` once the announced PMTiles header is
	// probed.
	const tileSourceMaxZoom = useNostrMapLayerAnnouncements(mapSource)

	// Project mapLayers → overlay descriptors used for blossom style building.
	// `config.blossomServer` is the fallback when an announcement omits one.
	const overlays = useBlossomOverlays(mapSource, config.blossomServer)

	const resolvedStyle = useMapSourceStyle({
		mapSource,
		tileSourceMaxZoom,
		overlays,
		defaultStyle: initialStyle ?? DEFAULT_STYLE_URL,
	})

	// Basemap preference for the `default` source (Auto follows the theme).
	const [basemapStyle] = useBasemapStyle()

	// mapcn requires `styles={{light,dark}}`. For the `default` map source the
	// basemap follows the theme (Liberty in light, Dark in dark) or a pinned
	// OpenFreeMap style — see `@/lib/basemap`. mapcn's own theme switch then
	// picks the right slot, so toggling the app theme re-styles the map. For
	// non-default sources (blossom/pmtiles) the built style is theme-agnostic,
	// so we pass it under both slots.
	const styles = useMemo(() => {
		if (!resolvedStyle) {
			// Fall through to mapcn defaults while blossom is resolving.
			return undefined
		}
		if (mapSource.type === 'default') {
			return resolveBasemapStyles(basemapStyle)
		}
		return { light: resolvedStyle.style, dark: resolvedStyle.style }
	}, [resolvedStyle, mapSource.type, basemapStyle])

	// Initial viewport (uncontrolled — mapcn's controlled mode requires
	// onViewportChange, which we don't expose). Memoised so identity stays
	// stable across renders and mapcn's init reads it once.
	const initialViewport = useMemo(
		() => ({
			center,
			zoom,
			bearing: storedViewport?.bearing ?? 0,
			pitch: storedViewport?.pitch ?? 0,
		}),
		[center, zoom, storedViewport],
	)

	// Adapt mapcn's `{longitude, latitude, accuracy}` to our existing
	// `{lon, lat, accuracy}` shape so consumers don't need to change.
	const handleLocate = useMemo(() => {
		if (!onLocate) return undefined
		return (coords: LocateCoords | null) => {
			if (!coords) {
				onLocate(null)
				return
			}
			onLocate({
				lon: coords.longitude,
				lat: coords.latitude,
				accuracy: coords.accuracy,
			})
		}
	}, [onLocate])

	return (
		<McnMap
			styles={styles}
			viewport={initialViewport}
			className={className}
			renderWorldCopies={true}
			maxZoom={22}
			attributionControl={{ compact: attributionCompact }}
			// preserveDrawingBuffer moved into canvasContextAttributes in
			// maplibre-gl 5.x. Required for canvas snapshot export (share image).
			canvasContextAttributes={{ preserveDrawingBuffer: true }}
		>
			<MapInternals mapSource={mapSource} onLoad={onLoad} />
			{showControls ? (
				<MapControls
					position={controlsPosition}
					showZoom
					showCompass
					showLocate={showLocate}
					showFullscreen
					showPitch={showPitch}
					showProjection={showGlobe}
					// Preserves the pre-swap LocateButton behavior: continuous
					// watchPosition, accuracy surfaced, click-again-to-stop.
					enableLocateTracking
					onLocate={handleLocate}
					onLocateError={onLocateError}
				>
					{controlsChildren}
				</MapControls>
			) : null}
			{children}
		</McnMap>
	)
}

/**
 * Internal sentinel that runs effects depending on the live map instance.
 * Renders nothing. Lives inside `<Map>` so it can call `useMap()`.
 */
function MapInternals({
	mapSource,
	onLoad,
}: {
	mapSource: MapSource
	onLoad?: (map: maplibregl.Map) => void
}) {
	const { map, isLoaded } = useMap()

	useStyleImageMissingHandler(map)
	useDisplayIconImages(map, isLoaded)
	useMapLayerStateSync(map, isLoaded)
	usePmtilesBoundsLock(map, isLoaded, mapSource)

	useEffect(() => {
		if (!map || !isLoaded) return
		const persistViewport = () => {
			const center = map.getCenter().wrap()
			writeStoredMapViewport({
				version: 1,
				center: [center.lng, center.lat],
				zoom: map.getZoom(),
				bearing: map.getBearing(),
				pitch: map.getPitch(),
			})
		}
		persistViewport()
		map.on('moveend', persistViewport)
		return () => map.off('moveend', persistViewport)
	}, [map, isLoaded])

	// Fire onLoad exactly once when the map first becomes loaded.
	const onLoadFiredRef = useRef(false)
	const onLoadRef = useRef(onLoad)
	useEffect(() => {
		onLoadRef.current = onLoad
	}, [onLoad])
	useEffect(() => {
		if (!map || !isLoaded) return
		if (onLoadFiredRef.current) return
		onLoadFiredRef.current = true
		onLoadRef.current?.(map)
	}, [map, isLoaded])

	return null
}
