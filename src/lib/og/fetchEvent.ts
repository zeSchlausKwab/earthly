import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND, GEO_EVENT_KIND, TEMPORAL_SIGHTING_KIND } from '../nostr/kinds'
import { fetchEventFromRelay } from './relayFetch'

export interface GeoEventOGData {
	title: string
	description: string
	image?: string
	featureCount?: number
}

export interface StoryOGData {
	title: string
	description: string
	image?: string
}

export interface SightingOGData {
	title: string
	description: string
	/**
	 * WR-02: the Sighting's NIP-40 `expiration` in epoch MILLISECONDS (or null when
	 * the Sighting never expires). The OG cache carries this so a record cached
	 * while the Sighting was live can be treated as a hard miss once wall-clock
	 * passes the expiry — independent of the cache's stale-while-revalidate window.
	 */
	contentExpiresAt: number | null
}

/**
 * SIGHT-03 / Pitfall P-1 — the OG server fetch is its OWN read path (raw WS REQ,
 * no applesauce cast, no `dropExpired` subscription filter), so it must check the
 * NIP-40 `expiration` tag itself. Returns true when the event carries an
 * `expiration` STRICTLY in the past relative to `now` (epoch seconds, UTC). No
 * tag, or a malformed/non-numeric tag, ⇒ never expired (defensive; mirrors
 * `isExpired` semantics in `@/lib/nostr/expiry`). `now` is injected so the
 * predicate is deterministic and uses epoch seconds, never `Date.now()` ms.
 */
export function isOGEventExpired(event: { tags: string[][] }, now: number): boolean {
	const expiration = readOGExpirationSeconds(event)
	if (expiration === null) return false
	return expiration < now
}

/**
 * Read the NIP-40 `expiration` timestamp (epoch SECONDS, UTC) from an event, or
 * null when there is no tag or the tag is malformed/non-numeric. Uses the same
 * strict `Number(raw)` parse as `isOGEventExpired` (IN-02): trailing garbage ⇒
 * null (treated as "never expires").
 */
export function readOGExpirationSeconds(event: { tags: string[][] }): number | null {
	const expirationTag = event.tags.find((t) => t[0] === 'expiration')
	const raw = expirationTag?.[1]
	if (raw === undefined) return null
	const expiration = Number(raw)
	if (!Number.isFinite(expiration)) return null
	return expiration
}

/**
 * Decode an naddr into its components
 */
export function decodeNaddr(naddr: string): {
	kind: number
	pubkey: string
	identifier: string
	relays?: string[]
} | null {
	try {
		const decoded = nip19.decode(naddr)
		if (decoded.type !== 'naddr') return null
		return {
			kind: decoded.data.kind,
			pubkey: decoded.data.pubkey,
			identifier: decoded.data.identifier,
			relays: decoded.data.relays,
		}
	} catch {
		return null
	}
}

interface NostrEvent {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

/**
 * Fetch geo event data for OG tags
 */
export async function fetchGeoEventOGData(
	naddr: string,
	relayUrl: string,
): Promise<GeoEventOGData | null> {
	const decoded = decodeNaddr(naddr)
	if (!decoded) return null
	if (decoded.kind !== GEO_EVENT_KIND) return null

	const event = await fetchEventFromRelay(relayUrl, {
		kinds: [decoded.kind],
		authors: [decoded.pubkey],
		'#d': [decoded.identifier],
	})

	if (!event) return null

	// Parse the FeatureCollection to get feature count
	let featureCount = 0
	let title = ''
	let description = ''

	try {
		const fc = JSON.parse(event.content)
		if (fc.type === 'FeatureCollection' && Array.isArray(fc.features)) {
			featureCount = fc.features.length

			// Try to extract title/description from first feature or collection properties
			if (fc.name) title = fc.name
			if (fc.description) description = fc.description

			// Check for title in the first feature
			if (!title && fc.features[0]?.properties?.name) {
				title = fc.features[0].properties.name
			}
		}
	} catch {
		// Invalid JSON content
	}

	// Look for title tag
	const titleTag = event.tags.find((t) => t[0] === 'title')
	if (titleTag?.[1]) title = titleTag[1]

	// Look for summary/description tag
	const summaryTag = event.tags.find((t) => t[0] === 'summary' || t[0] === 'description')
	if (summaryTag?.[1]) description = summaryTag[1]

	// Use d tag as fallback title
	if (!title) {
		const dTag = event.tags.find((t) => t[0] === 'd')
		if (dTag?.[1]) title = dTag[1]
	}

	// Generate description if not found
	if (!description && featureCount > 0) {
		description = `Geographic dataset with ${featureCount} feature${featureCount !== 1 ? 's' : ''}`
	}

	return {
		title: title || 'Geographic Dataset',
		description: description || 'View this geographic dataset on Earthly',
		featureCount,
	}
}

/**
 * Fetch Story (kind 37520) data for OG tags. Reads the NIP-23-style Article
 * content (`title`/`summary`/`image`) out of the event content JSON, falling
 * back to NIP-23 `title`/`summary` tags and the `d` tag.
 */
export async function fetchStoryOGData(
	naddr: string,
	relayUrl: string,
): Promise<StoryOGData | null> {
	const decoded = decodeNaddr(naddr)
	if (!decoded) return null
	if (decoded.kind !== ARTICLE_KIND) return null

	const event = await fetchEventFromRelay(relayUrl, {
		kinds: [decoded.kind],
		authors: [decoded.pubkey],
		'#d': [decoded.identifier],
	})

	if (!event) return null

	let title = ''
	let description = ''
	let image: string | undefined

	try {
		const content = JSON.parse(event.content) as {
			title?: string
			summary?: string
			image?: string
		}
		title = content.title ?? ''
		description = content.summary ?? ''
		image = content.image
	} catch {
		// Invalid JSON content — fall back to tags below.
	}

	if (!title) {
		const titleTag = event.tags.find((t) => t[0] === 'title')
		if (titleTag?.[1]) title = titleTag[1]
	}
	if (!description) {
		const summaryTag = event.tags.find((t) => t[0] === 'summary')
		if (summaryTag?.[1]) description = summaryTag[1]
	}
	if (!image) {
		const imageTag = event.tags.find((t) => t[0] === 'image')
		if (imageTag?.[1]) image = imageTag[1]
	}

	if (!title) {
		const dTag = event.tags.find((t) => t[0] === 'd')
		if (dTag?.[1]) title = dTag[1]
	}

	return {
		title: title || 'Story',
		description: description || 'Read this story on Earthly',
		image,
	}
}

/**
 * Fetch Temporal Sighting (kind 37522) data for OG tags. Reads `title`/
 * `description` out of the event content JSON (a Sighting has `description`, not
 * the Story's `summary`), falling back to `title`/`description` tags and the `d`
 * tag.
 *
 * SIGHT-03 (Pitfall P-1, the easy-miss read path): this is a separate raw-WS read
 * path with no cast/filter, so it INDEPENDENTLY checks the NIP-40 `expiration`
 * tag and returns null for an expired sighting.
 *
 * WR-01 — deletion suppression boundary: unlike the in-app read paths (which run
 * through the applesauce `eventStore` and its `DeleteManager`), this raw fetch does
 * NOT issue a kind-5 companion query, so it cannot independently honor a NIP-09
 * deletion. Deletion suppression for the OG card is DELEGATED TO THE RELAY: a
 * conformant relay stops serving a deleted addressable event, in which case the
 * REQ returns nothing and this function returns null. If the relay has not yet
 * honored an (advisory, best-effort) delete, a not-yet-expired deleted sighting
 * could still render. Expiry is covered here; deletion is the relay's job.
 */
export async function fetchSightingOGData(
	naddr: string,
	relayUrl: string,
): Promise<SightingOGData | null> {
	const decoded = decodeNaddr(naddr)
	if (!decoded) return null
	if (decoded.kind !== TEMPORAL_SIGHTING_KIND) return null

	const event = await fetchEventFromRelay(relayUrl, {
		kinds: [decoded.kind],
		authors: [decoded.pubkey],
		'#d': [decoded.identifier],
	})

	if (!event) return null

	// SIGHT-03 / Pitfall P-1: never render an expired sighting into the OG card.
	if (isOGEventExpired(event, Math.floor(Date.now() / 1000))) return null

	let title = ''
	let description = ''

	try {
		const content = JSON.parse(event.content) as {
			title?: string
			description?: string
		}
		title = content.title ?? ''
		description = content.description ?? ''
	} catch {
		// Invalid JSON content — fall back to tags below.
	}

	if (!title) {
		const titleTag = event.tags.find((t) => t[0] === 'title')
		if (titleTag?.[1]) title = titleTag[1]
	}
	if (!description) {
		const descriptionTag = event.tags.find((t) => t[0] === 'description')
		if (descriptionTag?.[1]) description = descriptionTag[1]
	}

	if (!title) {
		const dTag = event.tags.find((t) => t[0] === 'd')
		if (dTag?.[1]) title = dTag[1]
	}

	// WR-02: carry the NIP-40 expiry (seconds → ms) so the cache can hard-miss an
	// expired record regardless of its SWR window. null ⇒ never expires.
	const expirationSeconds = readOGExpirationSeconds(event)
	const contentExpiresAt = expirationSeconds === null ? null : expirationSeconds * 1000

	return {
		title: title || 'Sighting',
		description: description || 'See this sighting on Earthly',
		contentExpiresAt,
	}
}
