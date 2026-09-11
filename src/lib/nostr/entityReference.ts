import { decodeAddressPointer, naddrEncode, parseReplaceableAddress } from 'applesauce-core/helpers'
import { ARTICLE_KIND, GEO_EVENT_KIND, LIVE_BEACON_KIND, MAP_CONTEXT_KIND, TEMPORAL_SIGHTING_KIND } from './kinds'

/** One read-side boundary for raw `a` references and encoded links. No wire-format changes. */
export function resolveEntityReference(value: string) {
	try {
	const input = value.trim().replace(/^nostr:/, '')
	const pointer = input.startsWith('naddr1') ? decodeAddressPointer(input) : /^\d+:/.test(input) ? parseReplaceableAddress(input, true) : null
	if (!pointer || !Number.isSafeInteger(pointer.kind) || !/^[a-f0-9]{64}$/i.test(pointer.pubkey) || !pointer.identifier) return null
	const kind = ({ [GEO_EVENT_KIND]: 'map', [ARTICLE_KIND]: 'story', [MAP_CONTEXT_KIND]: 'atlas', [TEMPORAL_SIGHTING_KIND]: 'sighting', [LIVE_BEACON_KIND]: 'live' } as const)[pointer.kind]
	if (!kind) return null
	const naddr = naddrEncode(pointer)
	return { ...pointer, naddr, coordinate: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`, path: `/${kind}/${naddr}`, entityKind: kind }
	} catch {
		// An invalid foreign reference must not take down the inspecting surface.
		return null
	}
}
