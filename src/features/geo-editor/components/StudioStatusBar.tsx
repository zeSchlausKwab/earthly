import type maplibregl from 'maplibre-gl'
import { type RefObject, useEffect, useState } from 'react'
import { useBasemapStyle } from '@/lib/basemap'
import { pool } from '@/lib/nostr'
import { useTheme } from '@/lib/theme'
import { useEditorStore } from '../store'

interface StudioStatusBarProps {
	/** The live MapLibre instance ref (set once the map mounts). */
	mapRef: RefObject<maplibregl.Map | null>
	/** Flips true once the map has mounted, so we (re)attach the listeners. */
	mapReady: boolean
	sightingsCount: number
	beaconsCount: number
	/** Opens the relay settings (status-bar relay indicator is a shortcut). */
	onRelayClick?: () => void
}

const MAP_SOURCE_LABELS: Record<string, string> = {
	default: 'OpenFreeMap',
	pmtiles: 'PMTiles',
	blossom: 'Blossom',
}

/**
 * DS Studio bottom status bar — the thin instrument footer.
 * Left: relay health, projection, live zoom, cursor coordinates.
 * Right: map source · basemap style · entity counts. All values are JetBrains
 * Mono (numbers/coordinates are data). Part of the "framed instrument" shell.
 */
export function StudioStatusBar({
	mapRef,
	mapReady,
	sightingsCount,
	beaconsCount,
	onRelayClick,
}: StudioStatusBarProps) {
	const [zoom, setZoom] = useState<number | null>(null)
	const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null)
	const relayCount = pool.relays.size
	const mapSourceType = useEditorStore((state) => state.mapSource.type)
	const [basemapStyle] = useBasemapStyle()
	const [theme] = useTheme()

	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		const onMove = () => setZoom(map.getZoom())
		const onMouseMove = (e: maplibregl.MapMouseEvent) => {
			setCursor({ lng: e.lngLat.lng, lat: e.lngLat.lat })
		}
		const onMouseOut = () => setCursor(null)
		onMove()
		map.on('move', onMove)
		map.on('mousemove', onMouseMove)
		map.on('mouseout', onMouseOut)
		return () => {
			map.off('move', onMove)
			map.off('mousemove', onMouseMove)
			map.off('mouseout', onMouseOut)
		}
	}, [mapRef, mapReady])

	const sourceLabel = MAP_SOURCE_LABELS[mapSourceType] ?? mapSourceType
	const styleLabel =
		basemapStyle === 'auto' ? `auto·${theme === 'dark' ? 'dark' : 'positron'}` : basemapStyle

	return (
		<footer className="flex h-[var(--shell-statusbar-h)] shrink-0 items-center gap-3.5 border-t border-border bg-[var(--surface-chrome)] px-2.5 font-mono text-[10.5px] text-muted-foreground">
			<button
				type="button"
				onClick={onRelayClick}
				className="-mx-1 flex items-center gap-1.5 rounded-[2px] px-1 transition-colors hover:text-foreground disabled:cursor-default"
				disabled={!onRelayClick}
				title="Relay settings"
				aria-label={`${relayCount} relays — open relay settings`}
			>
				<span className="size-[7px] rounded-full bg-ok" />
				{relayCount} {relayCount === 1 ? 'relay' : 'relays'}
			</button>
			<span>EPSG:4326</span>
			{zoom !== null ? <span>z{zoom.toFixed(1)}</span> : null}
			{cursor ? (
				<span className="hidden text-[var(--text-faint)] sm:inline">
					{cursor.lat.toFixed(4)}, {cursor.lng.toFixed(4)}
				</span>
			) : null}
			<span className="ml-auto flex items-center gap-3.5">
				<span className="hidden md:inline">{sourceLabel}</span>
				<span className="hidden capitalize md:inline">{styleLabel}</span>
				<span>
					{sightingsCount} {sightingsCount === 1 ? 'sighting' : 'sightings'} · {beaconsCount}{' '}
					{beaconsCount === 1 ? 'beacon' : 'beacons'}
				</span>
			</span>
		</footer>
	)
}
