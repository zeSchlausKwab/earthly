import { nip19 } from 'nostr-tools'
import { MAP_CONTEXT_KIND } from '../nostr/kinds'
import { fetchEventFromRelay } from './relayFetch'

export interface ContextEventOGData {
	eventId: string
	createdAt: number
	title: string
	description: string
	image?: string
	bbox?: [number, number, number, number] // west, south, east, north
	referencedAddresses: string[]
}

function parseBbox(raw: string | undefined): [number, number, number, number] | undefined {
	if (!raw) return undefined
	const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()))
	if (parts.length !== 4 || parts.some(Number.isNaN)) return undefined
	return parts as [number, number, number, number]
}

/**
 * Fetch context event (kind 37518) data for OG tags
 */
export async function fetchContextEventOGData(
	naddr: string,
	relayUrl: string,
): Promise<ContextEventOGData | null> {
	try {
		const decoded = nip19.decode(naddr)
		if (decoded.type !== 'naddr') return null
		if (decoded.data.kind !== MAP_CONTEXT_KIND) return null

		const event = await fetchEventFromRelay(relayUrl, {
			kinds: [decoded.data.kind],
			authors: [decoded.data.pubkey],
			'#d': [decoded.data.identifier],
		})

		if (!event) return null

		let title = ''
		let description = ''
		let image: string | undefined
		let contentReferences: string[] = []

		try {
			const content = JSON.parse(event.content) as {
				name?: string
				description?: string
				image?: string
				references?: string[]
			}
			title = content.name ?? ''
			description = content.description ?? ''
			image = content.image
			contentReferences = Array.isArray(content.references)
				? content.references.filter((value): value is string => typeof value === 'string')
				: []
		} catch {
			// Invalid JSON
		}

		if (!title) {
			const dTag = event.tags.find((t) => t[0] === 'd')
			if (dTag?.[1]) title = dTag[1]
		}

		const bboxTag = event.tags.find((t) => t[0] === 'bbox')
		const bbox = parseBbox(bboxTag?.[1])

		return {
			eventId: event.id,
			createdAt: event.created_at,
			title: title || 'Map Context',
			description: description || 'A geographic context on Earthly',
			image,
			bbox,
			referencedAddresses: [
				...event.tags
					.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string')
					.map((tag) => tag[1] as string),
				...contentReferences,
			].filter((value, index, values) => values.indexOf(value) === index),
		}
	} catch {
		return null
	}
}
