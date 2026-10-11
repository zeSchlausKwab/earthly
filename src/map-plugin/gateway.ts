import { SimplePool } from 'nostr-tools/pool'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { DEFAULT_VIEW, validateMapData, type MapSnapshot } from '@/features/public-map/model'
import { decodeMapReference, mapUrl } from './references'
import type { MapGateway } from './service'

/** Only operator-configured relays are contacted, never arbitrary URLs from tool input. */
export class NostrMapGateway implements MapGateway {
	private pool = new SimplePool()
	constructor(readonly relays: string[]) {
		if (!relays.length || relays.length > 5) throw new Error('Configure one to five map relays')
		for (const relay of relays) {
			const url = new URL(relay)
			if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
				throw new Error('Invalid map relay URL')
		}
	}
	async read(reference: string): Promise<NostrEvent | null> {
		const { pubkey, identifier } = decodeMapReference(reference)
		const events = await this.pool.querySync(
			this.relays,
			{ kinds: [GEO_EVENT_KIND], authors: [pubkey], '#d': [identifier], limit: 1 },
			{ maxWait: 5000 },
		)
		return (
			events
				.filter(
					(event) =>
						event.kind === GEO_EVENT_KIND &&
						event.pubkey === pubkey &&
						event.tags.some((tag) => tag[0] === 'd' && tag[1] === identifier) &&
						verifyEvent(event),
				)
				.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null
		)
	}
	async publish(event: NostrEvent) {
		return Promise.all(
			this.pool.publish(this.relays, event, { maxWait: 5000 }).map(async (promise, i) => {
				try {
					const message = await promise
					return { from: this.relays[i]!, ok: true, message }
				} catch (error) {
					return {
						from: this.relays[i]!,
						ok: false,
						message: error instanceof Error ? error.message : 'Relay unavailable',
					}
				}
			}),
		)
	}
	close() {
		this.pool.destroy()
	}
}

export async function readPublicMap(
	gateway: MapGateway,
	baseUrl: string,
	reference: string,
): Promise<MapSnapshot> {
	decodeMapReference(reference)
	const event = await gateway.read(reference)
	if (!event) throw new Error('Map not found on the configured relays, or relays are unavailable')
	if (event.tags.some((tag) => tag[0] === 'blob'))
		throw new Error(
			'This initial viewer supports inline maps only. Open blob-backed maps in the full Earthly app.',
		)
	const tag = (name: string) => event.tags.find((entry) => entry[0] === name)?.[1]
	return {
		title: tag('title') ?? 'Earthly map',
		description: tag('description') ?? '',
		data: validateMapData(JSON.parse(event.content)),
		view: DEFAULT_VIEW,
		reference,
		eventId: event.id,
		shareUrl: mapUrl(baseUrl, reference).href,
	}
}
