import { namedFlavor, layers as protomapsLayers } from '@protomaps/basemaps'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol, TileType } from 'pmtiles'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSubscribe } from '@nostr-dev-kit/react'
import { config } from '@/config/env.client'
import { type BBox, lonLatToWorldGeohash, tileCenterLonLat } from '@/lib/worldGeohash'
import { type MapLayerSetAnnouncementPayload } from '@/lib/nostr/map-layer-set'
import { MAP_LAYER_SET_KIND } from '@/lib/ndk/kinds'
import { useEditorStore, type MapLayerState } from '../store'

const DEFAULT_CENTER: [number, number] = [0, 0]
const DEFAULT_ZOOM = 2

interface MapContextType {
	map: maplibregl.Map | null
	isLoaded: boolean
}

const MapContext = createContext<MapContextType>({
	map: null,
	isLoaded: false,
})

export const useMap = () => useContext(MapContext)

/**
 * Announcement record that maps geohashes to PMTiles chunk files.
 * This enables Blossom map discovery to find which PMTiles file
 * contains tiles for a given region.
 */
export type AnnouncementRecord = Record<
	string,
	{ bbox: BBox; file: string; maxZoom: number; size?: number }
>

export interface MapSource {
	type: 'default' | 'pmtiles' | 'blossom'
	location: 'remote' | 'local'
	url?: string
	file?: File
	/** Base URL for fetching PMTiles chunks (used with blossom map discovery) */
	blossomServer?: string
	/** Lock map zoom/pan to the bounds of the PMTiles source */
	boundsLocked?: boolean
}

interface MapProps {
	style?: string | maplibregl.StyleSpecification
	center?: [number, number]
	zoom?: number
	children?: React.ReactNode
	className?: string
	onLoad?: (map: maplibregl.Map) => void
	mapSource?: MapSource
}

type OverlayStyleDescriptor = {
	id: string
	fullUrl: string
	enabled: boolean
	opacity: number
}

function buildBlossomStyle(
	maxZoom: number,
	overlaysUiOrder: OverlayStyleDescriptor[],
): maplibregl.StyleSpecification {
	const baseLayers = protomapsLayers('protomaps', namedFlavor('light'), {
		lang: 'en',
	}) as maplibregl.LayerSpecification[]

	const firstSymbolIndex = baseLayers.findIndex((l) => l?.type === 'symbol')
	const insertAt = firstSymbolIndex >= 0 ? firstSymbolIndex : baseLayers.length

	const sources: maplibregl.StyleSpecification['sources'] = {
		protomaps: {
			type: 'vector',
			tiles: ['pmworld://world/{z}/{x}/{y}'],
			minzoom: 0,
			maxzoom: maxZoom,
			attribution:
				'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
		},
	}

	const overlayLayers = overlaysUiOrder
		.slice()
		.reverse() // UI order is top-to-bottom; style order is bottom-to-top.
		.map((layer): maplibregl.LayerSpecification => {
			const sourceId = `layer-${layer.id}-source`
			const mapLayerId = `layer-${layer.id}`
			sources[sourceId] = {
				type: 'raster',
				tiles: [`pmtiles://${layer.fullUrl}/{z}/{x}/{y}`],
				tileSize: 256,
			}
			return {
				id: mapLayerId,
				type: 'raster',
				source: sourceId,
				layout: { visibility: layer.enabled ? 'visible' : 'none' },
				paint: { 'raster-opacity': layer.opacity },
			}
		})

	const layers = baseLayers.slice()
	layers.splice(insertAt, 0, ...overlayLayers)

	return {
		version: 8,
		glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
		sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
		sources,
		layers,
	}
}

// Protocol registration flags (module-level to prevent re-registration)
let pmworldProtocolRegistered = false
let pmtilesProtocolRegistered = false
let pmtilesProtocolInstance: Protocol | null = null

// Cache for PMTiles instances (using object to avoid shadowing native Map with component name)
const pmtilesCache: Record<string, PMTiles> = {}

// Shared refs for pmworld protocol (accessible from protocol handler)
const pmworldState = {
	announcement: null as AnnouncementRecord | null,
	precision: 1,
	maxZoom: 8,
	blossomServer: config.blossomServer,
}

/**
 * Find the announcement record for a geohash using longest-prefix matching.
 * Tries progressively shorter prefixes until a match is found.
 *
 * This allows mixed-precision announcements where some geohashes are subdivided
 * (e.g., "u0", "u1", ..., "uz") and others are not (e.g., "v", "w").
 */
function findLongestPrefixMatch(
	announcement: AnnouncementRecord | null,
	geohash: string,
): AnnouncementRecord[string] | undefined {
	if (!announcement) return undefined

	// Try from longest (full geohash) to shortest (single char)
	for (let len = geohash.length; len >= 1; len--) {
		const prefix = geohash.slice(0, len)
		if (announcement[prefix]) {
			return announcement[prefix]
		}
	}

	return undefined
}

export const GeoEditorMap: React.FC<MapProps> = ({
	style: initialStyle = 'https://tiles.openfreemap.org/styles/liberty',
	center: centerProp,
	zoom: zoomProp,
	children,
	className = 'w-full h-full',
	onLoad,
	mapSource = { type: 'default', location: 'remote' },
}) => {
	const center = centerProp ?? DEFAULT_CENTER
	const zoom = zoomProp ?? DEFAULT_ZOOM
	const mapContainer = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const resizeObserverRef = useRef<ResizeObserver | null>(null)
	const [isLoaded, setIsLoaded] = useState(false)
	const [tileSourceMaxZoom, setTileSourceMaxZoom] = useState<number | null>(null)
	const currentStyleUrlRef = useRef<string | null>(null)
	const onLoadRef = useRef<MapProps['onLoad']>(onLoad)
	const protomapsLayerIdsRef = useRef<string[]>([])

	// Sync state shared with the MapSettingsPanel UI.
	const mapLayers = useEditorStore((state) => state.mapLayers)
	const mapLayersRef = useRef<MapLayerState[]>(mapLayers)
	const scheduleLayerSyncRef = useRef<(() => void) | null>(null)
	useEffect(() => {
		mapLayersRef.current = mapLayers
		scheduleLayerSyncRef.current?.()
	}, [mapLayers])

	const blossomOverlayStyle = useMemo(() => {
		if (mapSource.type !== 'blossom') {
			return { signature: '', overlays: [] as OverlayStyleDescriptor[] }
		}

		const overlays = mapLayers
			.filter((layer) => layer.kind === 'pmtiles' || layer.kind === 'file')
			.map<OverlayStyleDescriptor | null>((layer) => {
				if (!layer.file) return null
				// Skip vector-only layers; allow raster, webp, or unspecified
				if (layer.pmtilesType === 'vector') return null

				const server = layer.blossomServer?.trim() || pmworldState.blossomServer
				if (!server) return null

				const fullUrl = `${server.replace(/\/+$/, '')}/${layer.file.replace(/^\/+/, '')}`
				return { id: layer.id, fullUrl, enabled: layer.enabled, opacity: layer.opacity }
			})
			.filter((v): v is OverlayStyleDescriptor => v !== null)

		// Signature intentionally excludes enabled/opacity so toggling/slider changes don't force a style reload.
		const signature = overlays.map((o) => `${o.id}:${o.fullUrl}`).join('|')
		return { signature, overlays }
	}, [mapLayers, mapSource.type])

	useEffect(() => {
		onLoadRef.current = onLoad
	}, [onLoad])

	// Register protocols once
	useEffect(() => {
		// Keep a single global Protocol instance. MapLibre's protocol registration is global,
		// and we need the Protocol instance later (e.g. to add PMTiles) even across remounts.
		if (!pmtilesProtocolInstance) {
			pmtilesProtocolInstance = new Protocol()
		}
		const protocol = pmtilesProtocolInstance

		if (!pmtilesProtocolRegistered) {
			maplibregl.addProtocol('pmtiles', protocol.tile)
			pmtilesProtocolRegistered = true
		}

		if (!pmworldProtocolRegistered) {
			maplibregl.addProtocol('pmworld', async (params, abortController) => {
				if (params.type === 'json') {
					const maxzoom = pmworldState.maxZoom
					return {
						data: {
							tiles: [`${params.url}/{z}/{x}/{y}`],
							minzoom: 0,
							maxzoom,
							bounds: [-180, -90, 180, 90],
						},
					}
				}

				const m = params.url.match(/^pmworld:\/\/.+\/(\d+)\/(\d+)\/(\d+)$/)
				if (!m) throw new Error('Invalid pmworld URL')
				const z = Number(m[1])
				const x = Number(m[2])
				const y = Number(m[3])

				const center = tileCenterLonLat(z, x, y)
				const gh = lonLatToWorldGeohash(pmworldState.precision, center.lon, center.lat)
				// Use longest-prefix matching to support mixed-precision announcements
				const record = findLongestPrefixMatch(pmworldState.announcement, gh)
				if (!record) return { data: new Uint8Array() }

				const pmtilesUrl = `${pmworldState.blossomServer}/${record.file}`
				let pm = pmtilesCache[pmtilesUrl]
				if (!pm) {
					pm = new PMTiles(pmtilesUrl)
					pmtilesCache[pmtilesUrl] = pm
				}

				const header = await pm.getHeader()
				const resp = await pm.getZxy(z, x, y, abortController.signal)
				if (resp) {
					return {
						data: new Uint8Array(resp.data),
						cacheControl: resp.cacheControl,
						expires: resp.expires,
					}
				}
				if (header.tileType === TileType.Mvt) return { data: new Uint8Array() }
				return { data: null }
			})
			pmworldProtocolRegistered = true
		}
	}, [])

	// Subscribe to map layer set announcement (Nostr).
	// IMPORTANT: NDK requires at least one filter; passing [] will throw.
	// We always subscribe and only *use* the result when mapSource.type === 'blossom'.
	// No authors filter - discover announcements from any source on the relay.
	const { events: mapLayerSetEvents } = useSubscribe([
		// biome-ignore lint/suspicious/noExplicitAny: NDK's NDKKind enum doesn't include our custom 34444; cast to bypass nominal check
		{ kinds: [MAP_LAYER_SET_KIND] as any, limit: 50 },
	])

	// Derive a stable "latest event" so our effect doesn't re-trigger on every render.
	const latestLayerSetEvent = useMemo(() => {
		let best: (typeof mapLayerSetEvents)[number] | null = null
		for (const ev of mapLayerSetEvents) {
			if (!best) {
				best = ev
				continue
			}
			const a = ev.created_at ?? 0
			const b = best.created_at ?? 0
			if (a > b) {
				best = ev
			} else if (a === b) {
				// tie-breaker for stability
				const aid = ev.id ?? ''
				const bid = best.id ?? ''
				if (aid > bid) best = ev
			}
		}
		return best ?? null
	}, [mapLayerSetEvents])

	const latestLayerSetContent = latestLayerSetEvent?.content ?? null

	useEffect(() => {
		const { setMapLayers, setAnnouncementSource } = useEditorStore.getState()

		if (mapSource.type !== 'blossom') {
			pmworldState.announcement = null
			setTileSourceMaxZoom(null)
			setMapLayers([])
			setAnnouncementSource(null)
			return
		}

		// Extract source metadata from the event tags
		if (latestLayerSetEvent) {
			const getTag = (key: string) =>
				latestLayerSetEvent.tags?.find((t: string[]) => t[0] === key)?.[1] ?? null
			setAnnouncementSource({
				name: getTag('name'),
				about: getTag('about'),
				pubkey: latestLayerSetEvent.pubkey ?? null,
				createdAt: latestLayerSetEvent.created_at ?? null,
			})
		} else {
			setAnnouncementSource(null)
		}

		let payload: MapLayerSetAnnouncementPayload | null = null
		if (latestLayerSetContent) {
			try {
				const parsed = JSON.parse(latestLayerSetContent) as Partial<MapLayerSetAnnouncementPayload>
				if (parsed && Array.isArray(parsed.layers)) {
					payload = parsed as MapLayerSetAnnouncementPayload
				}
			} catch {
				payload = null
			}
		}
		const chunkedVectorLayer = payload?.layers.find((l) => l.kind === 'chunked-vector') ?? null

		const announcement = (
			chunkedVectorLayer && 'announcement' in chunkedVectorLayer
				? chunkedVectorLayer.announcement
				: null
		) as AnnouncementRecord | null

		const announcedServer =
			chunkedVectorLayer &&
			'blossomServer' in chunkedVectorLayer &&
			typeof chunkedVectorLayer.blossomServer === 'string'
				? chunkedVectorLayer.blossomServer.trim()
				: undefined

		// Prefer the server announced in the event, fall back to config default.
		const blossomServer = announcedServer || config.blossomServer

		pmworldState.blossomServer = blossomServer

		// Populate layer state for UI
		if (payload?.layers) {
			const layerStates: MapLayerState[] = payload.layers.map((layer) => ({
				id: layer.id,
				title: layer.title,
				kind: layer.kind,
				enabled: layer.defaultEnabled ?? true,
				opacity: layer.defaultOpacity ?? 1,
				// Include pmtiles-specific fields
				blossomServer: 'blossomServer' in layer ? layer.blossomServer : undefined,
				file: 'file' in layer ? layer.file : undefined,
				pmtilesType: 'pmtilesType' in layer ? layer.pmtilesType : undefined,
			}))
			setMapLayers(layerStates)
		} else {
			setMapLayers([])
		}

		pmworldState.announcement =
			announcement && Object.keys(announcement).length > 0 ? announcement : null

		let cancelled = false
		;(async () => {
			try {
				const data = announcement
				if (!data || Object.keys(data).length === 0) {
					setTileSourceMaxZoom(null)
					return
				}
				if (cancelled) return

				// For mixed-precision announcements, use the maximum precision.
				// This ensures we generate geohash lookups long enough to match
				// any entry, relying on longest-prefix matching for coarser entries.
				const geohashes = Object.keys(data)
				const firstKey = geohashes[0]
				if (geohashes.length > 0) {
					const maxPrecision = Math.max(...geohashes.map((gh) => gh.length))
					pmworldState.precision = maxPrecision
				}

				const announcedMaxZoom = Object.values(data).reduce((acc, v) => Math.max(acc, v.maxZoom), 0)

				const firstRecord = firstKey ? data[firstKey] : undefined
				if (!firstRecord) {
					if (Number.isFinite(announcedMaxZoom) && announcedMaxZoom > 0) {
						pmworldState.maxZoom = announcedMaxZoom
						setTileSourceMaxZoom(announcedMaxZoom)
					} else {
						setTileSourceMaxZoom(pmworldState.maxZoom)
					}
					return
				}

				// Probe first PMTiles file for actual maxZoom
				try {
					const pmtilesUrl = `${blossomServer}/${firstRecord.file}`
					let pm = pmtilesCache[pmtilesUrl]
					if (!pm) {
						pm = new PMTiles(pmtilesUrl)
						pmtilesCache[pmtilesUrl] = pm
					}
					const header = await pm.getHeader()
					if (cancelled) return

					const nativeMaxZoom = header.maxZoom
					const effectiveMaxZoom =
						Number.isFinite(nativeMaxZoom) && nativeMaxZoom >= 0
							? nativeMaxZoom
							: Number.isFinite(announcedMaxZoom) && announcedMaxZoom >= 0
								? announcedMaxZoom
								: pmworldState.maxZoom

					pmworldState.maxZoom = effectiveMaxZoom
					setTileSourceMaxZoom(effectiveMaxZoom)
				} catch {
					if (cancelled) return

					const fallback =
						Number.isFinite(announcedMaxZoom) && announcedMaxZoom > 0
							? announcedMaxZoom
							: pmworldState.maxZoom

					pmworldState.maxZoom = fallback
					setTileSourceMaxZoom(fallback)
				}
			} catch (error) {
				console.error('Failed to apply announcement:', error)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [mapSource.type, latestLayerSetContent, latestLayerSetEvent])

	// Initialize map (create once; style switches handled separately via setStyle).
	useEffect(() => {
		if (!mapContainer.current) return
		if (mapRef.current) return

		let mapStyle: string | maplibregl.StyleSpecification = initialStyle
		let initialStyleKey: string | null = null

		if (mapSource.type === 'blossom' && tileSourceMaxZoom !== null) {
			initialStyleKey = `pmworld:${tileSourceMaxZoom}:overlays:${blossomOverlayStyle.signature}`
			mapStyle = buildBlossomStyle(tileSourceMaxZoom, blossomOverlayStyle.overlays)
		} else if (mapSource.type === 'pmtiles') {
			let url = mapSource.url
			if (mapSource.location === 'local' && mapSource.file) {
				url = URL.createObjectURL(mapSource.file)
			}
			if (url) {
				const pmtilesUrl = url.startsWith('pmtiles://') ? url : `pmtiles://${url}`
				initialStyleKey = pmtilesUrl
				mapStyle = {
					version: 8,
					glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
					sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
					sources: {
						protomaps: {
							type: 'vector',
							url: pmtilesUrl,
							attribution:
								'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
						},
					},
					layers: protomapsLayers('protomaps', namedFlavor('light'), {
						lang: 'en',
					}),
				}
			}
		} else if (typeof initialStyle === 'string') {
			// Default remote style URL
			initialStyleKey = initialStyle
		} else {
			// Inline style object – we just want to avoid re-setting it immediately after init.
			initialStyleKey = '__inline_style__'
		}

		const map = new maplibregl.Map({
			container: mapContainer.current,
			style: mapStyle,
			center,
			zoom,
			maxZoom: 22,
			// Required for reliable canvas snapshot exports (share image preview/export).
			preserveDrawingBuffer: true,
		})

		mapRef.current = map
		currentStyleUrlRef.current = initialStyleKey

		// Prevent runtime crashes when styles reference missing sprite icons.
		// MapLibre emits "styleimagemissing"; we supply a transparent 1x1 placeholder.
		const onStyleImageMissing = (e: maplibregl.MapStyleImageMissingEvent) => {
			try {
				const id = e.id
				if (!id) return
				if (map.hasImage(id)) return
				// MapLibre accepts ImageData in browsers.
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

		map.on('load', () => {
			setIsLoaded(true)
			onLoadRef.current?.(map)
		})

		const resizeObserver = new ResizeObserver(() => {
			map.resize()
		})
		resizeObserver.observe(mapContainer.current)
		resizeObserverRef.current = resizeObserver
	}, [
		initialStyle,
		center,
		zoom,
		mapSource.type,
		mapSource.location,
		mapSource.url,
		mapSource.file,
		tileSourceMaxZoom,
		blossomOverlayStyle.signature,
		blossomOverlayStyle.overlays,
	])

	// Cleanup map on unmount only.
	useEffect(() => {
		return () => {
			try {
				resizeObserverRef.current?.disconnect()
			} catch {
				// ignore
			}
			resizeObserverRef.current = null

			try {
				mapRef.current?.remove()
			} catch {
				// ignore
			}
			mapRef.current = null
			setIsLoaded(false)
		}
	}, [])

	// Keep view in sync without destroying/recreating the map instance.
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		try {
			map.jumpTo({ center, zoom })
		} catch {
			// Map may have been removed
		}
	}, [center, zoom])

	// Handle map source updates (for switching sources after init)
	useEffect(() => {
		const map = mapRef.current
		if (!map) return

		const updateStyle = () => {
			if (mapSource.type === 'default') {
				const styleKey = typeof initialStyle === 'string' ? initialStyle : '__inline_style__'
				if (currentStyleUrlRef.current === styleKey) return
				map.setStyle(initialStyle, { diff: false })
				currentStyleUrlRef.current = styleKey
				return
			}

			if (mapSource.type === 'pmtiles') {
				let url = mapSource.url
				if (mapSource.location === 'local' && mapSource.file) {
					url = URL.createObjectURL(mapSource.file)
				}
				if (!url) return

				const pmtilesUrl = url.startsWith('pmtiles://') ? url : `pmtiles://${url}`
				if (currentStyleUrlRef.current === pmtilesUrl) return

				const style: maplibregl.StyleSpecification = {
					version: 8,
					glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
					sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
					sources: {
						protomaps: {
							type: 'vector',
							url: pmtilesUrl,
							attribution:
								'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
						},
					},
					layers: protomapsLayers('protomaps', namedFlavor('light'), { lang: 'en' }),
				}

				map.setStyle(style, { diff: false })
				currentStyleUrlRef.current = pmtilesUrl
				return
			}

			if (mapSource.type === 'blossom' && tileSourceMaxZoom !== null) {
				const styleKey = `pmworld:${tileSourceMaxZoom}:overlays:${blossomOverlayStyle.signature}`
				if (currentStyleUrlRef.current === styleKey) return

				const style = buildBlossomStyle(tileSourceMaxZoom, blossomOverlayStyle.overlays)
				map.setStyle(style, { diff: false })
				currentStyleUrlRef.current = styleKey
			}
		}

		updateStyle()
	}, [
		mapSource,
		initialStyle,
		tileSourceMaxZoom,
		blossomOverlayStyle.signature,
		blossomOverlayStyle.overlays,
	])

	// Sync mapLayers store state to MapLibre layers.
	// Avoid structural style mutations here (add/remove/move layers) to prevent MapLibre placement crashes.
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!isLoaded) return

		let disposed = false
		let rafId: number | null = null

		const getProtomapsLayerIds = (): string[] => {
			try {
				const style = map.getStyle()
				const layers = style?.layers ?? []
				return layers
					.filter((l) => (l as unknown as { source?: string }).source === 'protomaps')
					.map((l) => l.id)
			} catch {
				return []
			}
		}

		const applyLayerChanges = () => {
			if (disposed) return
			try {
				if (!map.getStyle?.()) return
			} catch {
				return
			}

			const allLayers = mapLayersRef.current

			// Sync chunked-vector basemap visibility/opacity by mutating protomaps style layers.
			const vectors = allLayers.find((l) => l.kind === 'chunked-vector') ?? null
			if (vectors) {
				if (protomapsLayerIdsRef.current.length === 0) {
					protomapsLayerIdsRef.current = getProtomapsLayerIds()
				}

				for (const layerId of protomapsLayerIdsRef.current) {
					try {
						if (!map.getLayer(layerId)) continue
						map.setLayoutProperty(layerId, 'visibility', vectors.enabled ? 'visible' : 'none')
					} catch {
						// ignore
					}
				}

				const opacity = vectors.opacity
				for (const layerId of protomapsLayerIdsRef.current) {
					const styleLayer = (() => {
						try {
							return map.getLayer(layerId)
						} catch {
							return undefined
						}
					})()
					if (!styleLayer) continue

					try {
						if (styleLayer.type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', opacity)
						if (styleLayer.type === 'line') map.setPaintProperty(layerId, 'line-opacity', opacity)
						if (styleLayer.type === 'circle')
							map.setPaintProperty(layerId, 'circle-opacity', opacity)
						if (styleLayer.type === 'symbol') {
							map.setPaintProperty(layerId, 'icon-opacity', opacity)
							map.setPaintProperty(layerId, 'text-opacity', opacity)
						}
						if (styleLayer.type === 'background')
							map.setPaintProperty(layerId, 'background-opacity', opacity)
					} catch {
						// ignore
					}
				}
			}

			// Sync PMTiles/file overlays (layers already exist in the Blossom style).
			for (const layer of allLayers) {
				if (layer.kind !== 'pmtiles' && layer.kind !== 'file') continue
				const mapLayerId = `layer-${layer.id}`
				try {
					if (!map.getLayer(mapLayerId)) continue
					map.setLayoutProperty(mapLayerId, 'visibility', layer.enabled ? 'visible' : 'none')
					map.setPaintProperty(mapLayerId, 'raster-opacity', layer.opacity)
				} catch {
					// ignore
				}
			}
		}

		const scheduleApply = () => {
			if (disposed) return
			if (rafId != null) return
			rafId = window.requestAnimationFrame(() => {
				rafId = null
				applyLayerChanges()
			})
		}

		scheduleLayerSyncRef.current = scheduleApply
		scheduleApply()

		const onStyleLoad = () => {
			protomapsLayerIdsRef.current = []
			scheduleApply()
		}
		map.on('style.load', onStyleLoad)

		return () => {
			disposed = true
			if (scheduleLayerSyncRef.current === scheduleApply) {
				scheduleLayerSyncRef.current = null
			}
			if (rafId != null) {
				try {
					window.cancelAnimationFrame(rafId)
				} catch {
					// ignore
				}
				rafId = null
			}
			try {
				map.off('style.load', onStyleLoad)
			} catch {
				// ignore
			}
		}
	}, [isLoaded])

	// Handle bounds locking for PMTiles sources
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!isLoaded) return

		// Only apply bounds lock for pmtiles type when enabled (default: true)
		const shouldLock = mapSource.type === 'pmtiles' && (mapSource.boundsLocked ?? true)

		if (!shouldLock) {
			// Clear any existing bounds constraint
			try {
				map.setMaxBounds(null)
				map.setMinZoom(0)
			} catch {
				// ignore
			}
			return
		}

		// Get the PMTiles URL
		let pmtilesUrl = mapSource.url
		if (mapSource.location === 'local' && mapSource.file) {
			pmtilesUrl = URL.createObjectURL(mapSource.file)
		}
		if (!pmtilesUrl) return

		let cancelled = false
		;(async () => {
			try {
				// Get or create PMTiles instance
				let pm = pmtilesCache[pmtilesUrl]
				if (!pm) {
					pm = new PMTiles(pmtilesUrl)
					pmtilesCache[pmtilesUrl] = pm
				}

				const header = await pm.getHeader()
				if (cancelled) return

				// Extract bounds from header
				const { minLon, minLat, maxLon, maxLat } = header

				// Validate bounds
				if (
					!Number.isFinite(minLon) ||
					!Number.isFinite(minLat) ||
					!Number.isFinite(maxLon) ||
					!Number.isFinite(maxLat)
				) {
					return
				}

				// Apply bounds constraint with generous padding (50% of bbox size) to allow zoom out
				const lonRange = maxLon - minLon
				const latRange = maxLat - minLat
				const lonPadding = lonRange * 0.5
				const latPadding = latRange * 0.5
				const bounds: maplibregl.LngLatBoundsLike = [
					[minLon - lonPadding, minLat - latPadding],
					[maxLon + lonPadding, maxLat + latPadding],
				]

				console.log(
					`🔒 Locking map to PMTiles bounds: [${minLon.toFixed(3)}, ${minLat.toFixed(3)}] - [${maxLon.toFixed(3)}, ${maxLat.toFixed(3)}] (with 50% padding)`,
				)

				try {
					map.setMaxBounds(bounds)
					// Don't set minZoom - let maxBounds naturally limit zoom-out
					// Fit to the actual PMTiles bounds (not the padded ones)
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
		isLoaded,
		mapSource.type,
		mapSource.url,
		mapSource.file,
		mapSource.location,
		mapSource.boundsLocked,
	])

	return (
		<MapContext.Provider value={{ map: mapRef.current, isLoaded }}>
			<div ref={mapContainer} className={className} />
			{children}
		</MapContext.Provider>
	)
}
