/**
 * EntityPinBubbles — DOM-marker overlay for Sighting photos and Beacon avatars
 * (SPEC §5.1/§6.1).
 *
 * Caller-side companion to the circle/glyph layers that useMapLayers renders
 * (which stay untouched — they remain the hit/hover surface and the fallback
 * visual). This component adds a floating "pin bubble" above the point:
 *
 *   - Sightings: the PRIMARY image (first imeta tag) as a clickable thumbnail.
 *     Sightings without images get no bubble — the base marker is enough.
 *   - Beacons: the author's avatar (BeaconAvatar below) with the app-standard
 *     fallback chain (picture → name initials → first two pubkey chars).
 *
 * Implementation: one maplibregl.Marker per entity (anchor bottom, offset above
 * the dot) whose element hosts a React portal — so avatars stay reactive to
 * profile loads. Clicking a bubble opens the entity in the right-sidebar
 * inspect view, exactly like clicking the base marker. Image load failures
 * hide the img and leave the base marker visible (rendering is never gated on
 * media, SPEC §5.1/§6.1).
 */

import { use$ } from 'applesauce-react/hooks'
import maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { eventStore } from '@/lib/nostr'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { buildBubbleEntries, type BubbleEntry } from './pinBubbleEntries'

interface EntityPinBubblesProps {
	mapRef: React.MutableRefObject<maplibregl.Map | null>
	mounted: boolean
	sightings: TemporalSighting[]
	beacons: LiveBeacon[]
	onInspectSighting?: (sighting: TemporalSighting) => void
	onInspectBeacon?: (beacon: LiveBeacon) => void
}

/**
 * Beacon pin avatar — the app-standard fallback chain (profile image → name
 * initials → first two pubkey characters), mirroring UserProfile's
 * ProfileAvatar but avatar-only for the map bubble.
 */
function BeaconAvatar({ pubkey }: { pubkey: string }) {
	const profile = use$(() => eventStore.profile(pubkey), [pubkey])
	const name = profile?.name ?? profile?.display_name
	const fallback = (name ? name.substring(0, 2) : pubkey.substring(0, 2)).toUpperCase()
	return (
		<Avatar className="size-12">
			<AvatarImage
				src={profile?.image || profile?.picture}
				alt={name ?? pubkey}
				className="object-cover"
			/>
			<AvatarFallback className="bg-gradient-to-br from-info to-ok text-sm text-white">
				{fallback}
			</AvatarFallback>
		</Avatar>
	)
}

export function EntityPinBubbles({
	mapRef,
	mounted,
	sightings,
	beacons,
	onInspectSighting,
	onInspectBeacon,
}: EntityPinBubblesProps) {
	// Marker DOM elements by bubble key — portals render into these.
	const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>())
	const [elements, setElements] = useState<Map<string, HTMLDivElement>>(new Map())

	const entries = useMemo<BubbleEntry[]>(
		() => buildBubbleEntries(sightings, beacons, Math.floor(Date.now() / 1000)),
		[sightings, beacons],
	)

	// Diff entries against live markers: create, move, and remove as needed.
	useEffect(() => {
		const map = mapRef.current
		if (!map || !mounted) return

		const markers = markersRef.current
		const seen = new Set<string>()
		let changed = false

		for (const entry of entries) {
			seen.add(entry.key)
			const existing = markers.get(entry.key)
			if (existing) {
				const current = existing.marker.getLngLat()
				if (current.lng !== entry.coordinates[0] || current.lat !== entry.coordinates[1]) {
					existing.marker.setLngLat(entry.coordinates)
				}
				continue
			}
			const el = document.createElement('div')
			el.className = 'earthly-pin-bubble-host'
			const marker = new maplibregl.Marker({
				element: el,
				anchor: 'bottom',
				// Float above the base circle marker (radius ~8px + breathing room).
				offset: [0, -12],
			})
				.setLngLat(entry.coordinates)
				.addTo(map)
			markers.set(entry.key, { marker, el })
			changed = true
		}

		for (const [key, value] of markers) {
			if (seen.has(key)) continue
			value.marker.remove()
			markers.delete(key)
			changed = true
		}

		if (changed) {
			setElements(new Map([...markers].map(([key, value]) => [key, value.el])))
		}
	}, [entries, mounted, mapRef])

	// Tear down every marker on unmount.
	useEffect(() => {
		const markers = markersRef.current
		return () => {
			for (const { marker } of markers.values()) marker.remove()
			markers.clear()
		}
	}, [])

	return (
		<>
			{entries.map((entry) => {
				const el = elements.get(entry.key)
				if (!el) return null
				return createPortal(
					entry.kind === 'sighting' && entry.sighting ? (
						<button
							type="button"
							title={entry.title}
							aria-label={`Open sighting: ${entry.title}`}
							className="block h-12 w-12 cursor-pointer overflow-hidden rounded-full border-2 border-background bg-card shadow-md transition-transform hover:scale-110"
							onClick={() => entry.sighting && onInspectSighting?.(entry.sighting)}
						>
							{/* biome-ignore lint/performance/noImgElement: map marker thumbnail */}
							<img
								src={entry.imageUrl}
								alt={entry.title}
								loading="lazy"
								className="h-full w-full object-cover"
								onError={(event) => {
									// Broken image → hide the bubble; the base marker stays.
									event.currentTarget.closest<HTMLElement>(
										'.earthly-pin-bubble-host',
									)!.style.display = 'none'
								}}
							/>
						</button>
					) : entry.beacon ? (
						<button
							type="button"
							title={entry.title}
							aria-label={`Open beacon: ${entry.title}`}
							className="block cursor-pointer overflow-hidden rounded-full border-2 border-background shadow-md transition-transform hover:scale-110"
							onClick={() => entry.beacon && onInspectBeacon?.(entry.beacon)}
						>
							<BeaconAvatar pubkey={entry.beacon.pubkey} />
						</button>
					) : null,
					el,
					entry.key,
				)
			})}
		</>
	)
}
