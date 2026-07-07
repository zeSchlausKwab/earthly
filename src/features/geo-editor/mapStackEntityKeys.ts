import { nip19 } from 'nostr-tools'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { LIVE_BEACON_KIND, TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'

export function encodeSightingNaddrPure(sighting: TemporalSighting): string | null {
	const identifier = sighting.dTag
	if (!identifier || !sighting.pubkey) return null
	try {
		return nip19.naddrEncode({ kind: TEMPORAL_SIGHTING_KIND, pubkey: sighting.pubkey, identifier })
	} catch {
		return null
	}
}

export function getSightingMapStackKey(sighting: TemporalSighting): string | undefined {
	return encodeSightingNaddrPure(sighting) ?? sighting.dTag ?? sighting.id ?? undefined
}

export function encodeBeaconNaddrPure(beacon: LiveBeacon): string | null {
	const identifier = beacon.dTag
	if (!identifier || !beacon.pubkey) return null
	try {
		return nip19.naddrEncode({ kind: LIVE_BEACON_KIND, pubkey: beacon.pubkey, identifier })
	} catch {
		return null
	}
}

export function getBeaconMapStackKey(beacon: LiveBeacon): string | undefined {
	return encodeBeaconNaddrPure(beacon) ?? beacon.dTag ?? beacon.id ?? undefined
}
