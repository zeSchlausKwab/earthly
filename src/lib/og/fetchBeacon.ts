import { LIVE_BEACON_KIND } from '../nostr/kinds'
import { decodeNaddr, isOGEventExpired, readOGExpirationSeconds } from './fetchEvent'
import { fetchEventFromRelay } from './relayFetch'

export interface BeaconOGData {
	eventId: string
	createdAt: number
	title: string
	description: string
	/**
	 * The beacon's NIP-40 `expiration` in epoch MILLISECONDS (or null when it never
	 * expires). The OG cache carries this so a record cached while the beacon was
	 * live becomes a hard miss once wall-clock passes the expiry — independent of
	 * the cache's stale-while-revalidate window (mirrors the Sighting posture).
	 */
	contentExpiresAt: number | null
}

/**
 * Fetch Live Beacon (kind 37521) data for the OG card of a shared beacon link
 * (BEACON-04, D-11). A near-verbatim clone of `fetchSightingOGData`.
 *
 * The share naddr encodes a THROWAWAY pubkey (D-05: a beacon session signs with a
 * per-session key, NOT the user's account), so the fetch resolves by
 * `{ kinds:[37521], authors:[throwawayPubkey], '#d':[d] }` — the beacon is not
 * discoverable under the user's profile.
 *
 * SIGHT-03 / Pitfall P-1 (the easy-miss raw read path): this is a separate raw-WS
 * read path with no cast/`dropExpired` subscription filter, so it INDEPENDENTLY
 * checks the NIP-40 `expiration` tag and returns null for an expired beacon — the
 * OG card never renders a dead beacon's content (T-12-05-OGLEAK).
 *
 * WR-01 — deletion suppression boundary: like the Sighting OG path, this raw fetch
 * issues no kind-5 companion query; deletion suppression is delegated to the relay.
 * Expiry is covered here.
 */
export async function fetchBeaconOGData(
	naddr: string,
	relayUrl: string,
): Promise<BeaconOGData | null> {
	const decoded = decodeNaddr(naddr)
	if (!decoded) return null
	if (decoded.kind !== LIVE_BEACON_KIND) return null

	const event = await fetchEventFromRelay(relayUrl, {
		kinds: [decoded.kind],
		authors: [decoded.pubkey],
		'#d': [decoded.identifier],
	})

	if (!event) return null

	// SIGHT-03 / Pitfall P-1: never render an expired beacon into the OG card.
	if (isOGEventExpired(event, Math.floor(Date.now() / 1000))) return null

	let title = ''
	let description = ''

	try {
		const content = JSON.parse(event.content) as {
			label?: string
			description?: string
		}
		title = content.label ?? ''
		description = content.description ?? ''
	} catch {
		// Invalid JSON content — fall back to tags below.
	}

	if (!title) {
		const titleTag = event.tags.find((t) => t[0] === 'title')
		if (titleTag?.[1]) title = titleTag[1]
	}

	if (!title) {
		const dTag = event.tags.find((t) => t[0] === 'd')
		if (dTag?.[1]) title = dTag[1]
	}

	// Carry the NIP-40 expiry (seconds → ms) so the cache can hard-miss an expired
	// record regardless of its SWR window. null ⇒ never expires.
	const expirationSeconds = readOGExpirationSeconds(event)
	const contentExpiresAt = expirationSeconds === null ? null : expirationSeconds * 1000

	return {
		eventId: event.id,
		createdAt: event.created_at,
		title: title || 'Live location',
		description: description || 'Watch this live location on Earthly',
		contentExpiresAt,
	}
}
