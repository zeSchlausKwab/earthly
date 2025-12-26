import { namedFlavor, layers as protomapsLayers } from '@protomaps/basemaps'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PMTiles, Protocol, TileType } from 'pmtiles'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSubscribe } from '@nostr-dev-kit/react'
import { config } from '@/config'
import { type BBox, lonLatToWorldGeohash, tileCenterLonLat } from '@/lib/worldGeohash'
import { NDKMapLayerSetEvent, type MapLayerSetAnnouncementPayload } from '@/lib/ndk/NDKMapLayerSetEvent'

const DEFAULT_CENTER: [number, number] = [-74.006, 40.7128]
const DEFAULT_ZOOM = 12

interface MapContextType {
	map: maplibregl.Map | null
	isLoaded: boolean
}

const MapContext = createContext<MapContextType>({
	map: null,
	isLoaded: false
})

export const useMap = () => useContext(MapContext)

/**
 * Announcement record that maps geohashes to PMTiles chunk files.
 * This enables Blossom map discovery to find which PMTiles file
 * contains tiles for a given region.
 */
export type AnnouncementRecord = Record<string, { bbox: BBox; file: string; maxZoom: number }>

export interface MapSource {
	type: 'default' | 'pmtiles' | 'blossom'
	location: 'remote' | 'local'
	url?: string
	file?: File
	/** Base URL for fetching PMTiles chunks (used with blossom map discovery) */
	blossomServer?: string
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

// Protocol registration flags (module-level to prevent re-registration)
let pmworldProtocolRegistered = false
let pmtilesProtocolRegistered = false

// Cache for PMTiles instances (using object to avoid shadowing native Map with component name)
const pmtilesCache: Record<string, PMTiles> = {}

// Shared refs for pmworld protocol (accessible from protocol handler)
const pmworldState = {
	announcement: null as AnnouncementRecord | null,
	precision: 1,
	maxZoom: 8,
	blossomServer: 'http://localhost:3001'
}

export const GeoEditorMap: React.FC<MapProps> = ({
	style: initialStyle = 'https://tiles.openfreemap.org/styles/liberty',
	center: centerProp,
	zoom: zoomProp,
	children,
	className = 'w-full h-full',
	onLoad,
	mapSource = { type: 'default', location: 'remote' }
}) => {
	const center = centerProp ?? DEFAULT_CENTER
	const zoom = zoomProp ?? DEFAULT_ZOOM
	const mapContainer = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const protocolRef = useRef<Protocol | null>(null)
	const [isLoaded, setIsLoaded] = useState(false)
	const [_announcement, setAnnouncement] = useState<AnnouncementRecord | null>(null)
	const [tileSourceMaxZoom, setTileSourceMaxZoom] = useState<number | null>(null)
	const currentStyleUrlRef = useRef<string | null>(null)
	const onLoadRef = useRef<MapProps['onLoad']>(onLoad)

	useEffect(() => {
		onLoadRef.current = onLoad
	}, [onLoad])

	// Register protocols once
	useEffect(() => {
		if (!pmtilesProtocolRegistered) {
			const protocol = new Protocol()
			maplibregl.addProtocol('pmtiles', protocol.tile)
			protocolRef.current = protocol
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
							bounds: [-180, -90, 180, 90]
						}
					}
				}

				const m = params.url.match(/^pmworld:\/\/.+\/(\d+)\/(\d+)\/(\d+)$/)
				if (!m) throw new Error('Invalid pmworld URL')
				const z = Number(m[1])
				const x = Number(m[2])
				const y = Number(m[3])

				const center = tileCenterLonLat(z, x, y)
				const gh = lonLatToWorldGeohash(pmworldState.precision, center.lon, center.lat)
				const record = pmworldState.announcement?.[gh]
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
						expires: resp.expires
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
	const { events: mapLayerSetEvents } = useSubscribe([
		{
			kinds: NDKMapLayerSetEvent.kinds,
			authors: [config.serverPubkey],
			limit: 10
		}
	])

	// Derive a stable "latest content" so our effect doesn't re-trigger on every render.
	const latestLayerSetContent = useMemo(() => {
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
		return best?.content ?? null
	}, [mapLayerSetEvents])

	useEffect(() => {
		if (mapSource.type !== 'blossom') {
			setAnnouncement(null)
			setTileSourceMaxZoom(null)
			return
		}

		let payload: MapLayerSetAnnouncementPayload | null = null
		if (latestLayerSetContent) {
			try {
				const parsed = JSON.parse(latestLayerSetContent) as Partial<MapLayerSetAnnouncementPayload>
				if (parsed && parsed.version === 1 && Array.isArray(parsed.layers)) {
					payload = parsed as MapLayerSetAnnouncementPayload
				}
			} catch {
				payload = null
			}
		}
		const chunkedVectorLayer =
			payload?.layers.find((l) => l.kind === 'chunked-vector') ?? null

		const announcement = (chunkedVectorLayer && 'announcement' in chunkedVectorLayer
			? chunkedVectorLayer.announcement
			: null) as AnnouncementRecord | null

		const blossomServer =
			(mapSource.blossomServer && mapSource.blossomServer.trim().length > 0
				? mapSource.blossomServer.trim()
				: chunkedVectorLayer && 'blossomServer' in chunkedVectorLayer
					? chunkedVectorLayer.blossomServer
					: 'http://localhost:3001') || 'http://localhost:3001'

		pmworldState.blossomServer = blossomServer

		let cancelled = false
		;(async () => {
			try {
				const data = announcement
				if (!data || Object.keys(data).length === 0) return
				if (cancelled) return

				setAnnouncement(data)
				pmworldState.announcement = data

				const firstKey = Object.keys(data)[0]
				if (firstKey && firstKey.length > 0) {
					pmworldState.precision = firstKey.length
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
	}, [mapSource.type, mapSource.blossomServer, latestLayerSetContent])

	// Initialize map
	useEffect(() => {
		if (!mapContainer.current) return
		if (mapRef.current) return

		// For blossom, wait until we have the announcement
		if (mapSource.type === 'blossom' && tileSourceMaxZoom === null) {
			return
		}

		let mapStyle: string | maplibregl.StyleSpecification = initialStyle
		let initialStyleKey: string | null = null

		if (mapSource.type === 'blossom' && tileSourceMaxZoom !== null) {
			initialStyleKey = `pmworld:${tileSourceMaxZoom}`
			mapStyle = {
				version: 8,
				glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
				sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
				sources: {
					protomaps: {
						type: 'vector',
						tiles: ['pmworld://world/{z}/{x}/{y}'],
						minzoom: 0,
						maxzoom: tileSourceMaxZoom,
						attribution:
							'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
					}
				},
				layers: protomapsLayers('protomaps', namedFlavor('light'), {
					lang: 'en'
				})
			}
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
								'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
						}
					},
					layers: protomapsLayers('protomaps', namedFlavor('light'), {
						lang: 'en'
					})
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
			maxZoom: 22
		})

		mapRef.current = map
		currentStyleUrlRef.current = initialStyleKey

		map.on('load', () => {
			setIsLoaded(true)
			onLoadRef.current?.(map)
		})

		const resizeObserver = new ResizeObserver(() => {
			map.resize()
		})
		resizeObserver.observe(mapContainer.current)

		return () => {
			resizeObserver.disconnect()
			map.remove()
			mapRef.current = null
			setIsLoaded(false)
		}
	}, [
		mapSource.type,
		tileSourceMaxZoom,
		mapSource.url,
		mapSource.file,
		mapSource.location,
		initialStyle,
		center,
		zoom
	])

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

		const updateStyle = async () => {
			if (mapSource.type === 'default') {
				if (currentStyleUrlRef.current === initialStyle) return
				map.setStyle(initialStyle)
				currentStyleUrlRef.current = initialStyle as string
			} else if (mapSource.type === 'pmtiles') {
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
								'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
						}
					},
					layers: protomapsLayers('protomaps', namedFlavor('light'), {
						lang: 'en'
					})
				}

				map.setStyle(style)
				currentStyleUrlRef.current = pmtilesUrl
			} else if (mapSource.type === 'blossom' && tileSourceMaxZoom !== null) {
				const styleKey = `pmworld:${tileSourceMaxZoom}`
				if (currentStyleUrlRef.current === styleKey) return

				const style: maplibregl.StyleSpecification = {
					version: 8,
					glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
					sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
					sources: {
						protomaps: {
							type: 'vector',
							tiles: ['pmworld://world/{z}/{x}/{y}'],
							minzoom: 0,
							maxzoom: tileSourceMaxZoom,
							attribution:
								'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
						}
					},
					layers: protomapsLayers('protomaps', namedFlavor('light'), {
						lang: 'en'
					})
				}

				map.setStyle(style)
				currentStyleUrlRef.current = styleKey
			}
		}

		updateStyle()
	}, [mapSource, initialStyle, tileSourceMaxZoom])

	return (
		<MapContext.Provider value={{ map: mapRef.current, isLoaded }}>
			<div ref={mapContainer} className={className} />
			{children}
		</MapContext.Provider>
	)
}
