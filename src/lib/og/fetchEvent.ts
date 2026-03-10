import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '../ndk/kinds'

export interface GeoEventOGData {
	title: string
	description: string
	image?: string
	featureCount?: number
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

/**
 * Fetch a Nostr event from a relay using WebSocket
 */
async function fetchEventFromRelay(
	relayUrl: string,
	filter: { kinds: number[]; authors: string[]; '#d': string[] },
	timeoutMs = 5000,
): Promise<NostrEvent | null> {
	// Convert ws:// to http:// for comparison, handle both protocols
	const wsUrl = relayUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			ws.close()
			resolve(null)
		}, timeoutMs)

		const ws = new WebSocket(wsUrl)
		const subId = crypto.randomUUID().slice(0, 8)

		ws.onopen = () => {
			ws.send(JSON.stringify(['REQ', subId, filter]))
		}

		ws.onmessage = (msg) => {
			try {
				const data = JSON.parse(msg.data as string)
				if (data[0] === 'EVENT' && data[1] === subId) {
					clearTimeout(timeout)
					ws.send(JSON.stringify(['CLOSE', subId]))
					ws.close()
					resolve(data[2] as NostrEvent)
				} else if (data[0] === 'EOSE' && data[1] === subId) {
					clearTimeout(timeout)
					ws.close()
					resolve(null)
				}
			} catch {
				// Ignore parse errors
			}
		}

		ws.onerror = () => {
			clearTimeout(timeout)
			resolve(null)
		}
	})
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
