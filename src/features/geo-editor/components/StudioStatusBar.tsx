import type maplibregl from 'maplibre-gl'
import { type RefObject, useEffect, useState } from 'react'
import { pool } from '@/lib/nostr'

interface StudioStatusBarProps {
	/** The live MapLibre instance ref (set once the map mounts). */
	mapRef: RefObject<maplibregl.Map | null>
	/** Flips true once the map has mounted, so we (re)attach the zoom listener. */
	mapReady: boolean
	sightingsCount: number
	beaconsCount: number
	/** Opens the relay settings (status-bar relay indicator is a shortcut). */
	onRelayClick?: () => void
}

/**
 * DS Studio bottom status bar — the thin instrument footer.
 * Shows relay health, projection, live zoom, and entity counts. All values are
 * JetBrains Mono (numbers are data). Part of the "framed instrument" shell.
 */
export function StudioStatusBar({
	mapRef,
	mapReady,
	sightingsCount,
	beaconsCount,
	onRelayClick,
}: StudioStatusBarProps) {
	const [zoom, setZoom] = useState<number | null>(null)
	const relayCount = pool.relays.size

	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		const update = () => setZoom(map.getZoom())
		update()
		map.on('move', update)
		return () => {
			map.off('move', update)
		}
	}, [mapRef, mapReady])

	return (
		<footer className="flex h-[23px] shrink-0 items-center gap-3.5 border-t border-border bg-[var(--surface-chrome)] px-2.5 font-mono text-[10.5px] text-muted-foreground">
			<button
				type="button"
				onClick={onRelayClick}
				className="flex items-center gap-1.5 rounded-[2px] px-1 -mx-1 transition-colors hover:text-foreground disabled:cursor-default"
				disabled={!onRelayClick}
				title="Relay settings"
				aria-label={`${relayCount} relays — open relay settings`}
			>
				<span className="size-[7px] rounded-full bg-ok" />
				{relayCount} {relayCount === 1 ? 'relay' : 'relays'}
			</button>
			<span>EPSG:4326</span>
			{zoom !== null ? <span>z{zoom.toFixed(1)}</span> : null}
			<span className="ml-auto">
				{sightingsCount} {sightingsCount === 1 ? 'sighting' : 'sightings'} · {beaconsCount}{' '}
				{beaconsCount === 1 ? 'beacon' : 'beacons'}
			</span>
		</footer>
	)
}
