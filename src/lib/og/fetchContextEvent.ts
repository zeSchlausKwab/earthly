import { nip19 } from 'nostr-tools'
import { MAP_CONTEXT_KIND } from '../nostr/kinds'

export interface ContextEventOGData {
	title: string
	description: string
	image?: string
	bbox?: [number, number, number, number] // west, south, east, north
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

async function fetchEventFromRelay(
	relayUrl: string,
	filter: { kinds: number[]; authors: string[]; '#d': string[] },
	timeoutMs = 5000,
): Promise<NostrEvent | null> {
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

		const event = await fetchEventFromRelay(
			relayUrl,
			{
				kinds: [decoded.data.kind],
				authors: [decoded.data.pubkey],
				'#d': [decoded.data.identifier],
			},
		)

		if (!event) return null

		let title = ''
		let description = ''
		let image: string | undefined

		try {
			const content = JSON.parse(event.content) as {
				name?: string
				description?: string
				image?: string
			}
			title = content.name ?? ''
			description = content.description ?? ''
			image = content.image
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
			title: title || 'Map Context',
			description: description || 'A geographic context on Earthly',
			image,
			bbox,
		}
	} catch {
		return null
	}
}

