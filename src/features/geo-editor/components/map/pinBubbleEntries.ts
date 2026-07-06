/**
 * Pure derivation of the pin-bubble list (SPEC §5.1/§6.1) — which sightings
 * and beacons get a DOM bubble above their map point. Import-light on purpose
 * (no React, no maplibre) so it stays unit-testable without dragging the map
 * stack into the test module graph.
 *
 * Rules: a sighting needs a primary image (first imeta), an unexpired NIP-40
 * timestamp, and resolvable coordinates; a beacon needs a content point and a
 * non-ended state. Entities that fail the gate keep their base circle marker.
 */

import { centroid } from '@turf/turf'
import { beaconState, type LiveBeacon } from '@/lib/nostr/live-beacon'
import { getTemporalSightingContent, type TemporalSighting } from '@/lib/nostr/temporal-sighting'

export type BubbleEntry = {
	key: string
	coordinates: [number, number]
	kind: 'sighting' | 'beacon'
	sighting?: TemporalSighting
	beacon?: LiveBeacon
	imageUrl?: string
	title: string
}

/** Resolve a representative [lon, lat] for a sighting (point, else centroid). */
function sightingCoordinates(sighting: TemporalSighting): [number, number] | undefined {
	const geometry = getTemporalSightingContent(sighting.event).geometry
	if (!geometry) return undefined
	try {
		if (geometry.type === 'Point') {
			const [lon, lat] = geometry.coordinates
			if (typeof lon === 'number' && typeof lat === 'number') return [lon, lat]
			return undefined
		}
		const coords = centroid(geometry).geometry.coordinates
		if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
			return [coords[0], coords[1]]
		}
	} catch {
		// invalid geometry — no bubble; the base layer skips it too
	}
	return undefined
}

/** Resolve a [lon, lat] for a beacon (content.geometry Point, D-09). */
function beaconCoordinates(beacon: LiveBeacon): [number, number] | undefined {
	const geometry = beacon.beacon?.geometry
	const lon = geometry?.coordinates?.[0]
	const lat = geometry?.coordinates?.[1]
	if (typeof lon === 'number' && typeof lat === 'number') return [lon, lat]
	return undefined
}

export function buildBubbleEntries(
	sightings: TemporalSighting[],
	beacons: LiveBeacon[],
	now: number,
): BubbleEntry[] {
	const result: BubbleEntry[] = []

	for (const sighting of sightings) {
		const imageUrl = sighting.primaryImage?.url
		if (!imageUrl) continue // no photo → the base marker is the whole visual
		const expiresAt = sighting.expiresAt
		if (expiresAt !== undefined && expiresAt <= now) continue
		const coordinates = sightingCoordinates(sighting)
		if (!coordinates) continue
		result.push({
			key: `sighting:${sighting.id}`,
			coordinates,
			kind: 'sighting',
			sighting,
			imageUrl,
			title: sighting.sighting.title ?? 'Sighting',
		})
	}

	for (const beacon of beacons) {
		if (beaconState(beacon, now) === 'ended') continue
		const coordinates = beaconCoordinates(beacon)
		if (!coordinates) continue
		result.push({
			key: `beacon:${beacon.pubkey}:${beacon.dTag ?? beacon.id}`,
			coordinates,
			kind: 'beacon',
			beacon,
			title: beacon.beacon.label ?? 'Live beacon',
		})
	}

	return result
}
