import { getEventHash, verifyEvent, type NostrEvent } from 'nostr-tools'
import { Observable, type Subscription } from 'rxjs'

export interface PublicationRelayObservation {
	relay: string
	status: 'verified' | 'not_found' | 'timeout' | 'error'
}

export interface SignedPublicationObservation {
	eventId: string
	status: 'verified' | 'uncertain'
	relays: PublicationRelayObservation[]
}

type ExactEventRequest = (relay: string, eventIds: string[]) => Observable<NostrEvent>

/** Separate from the app pool, whose NIP-42 handler may sign authentication events. */
function requestExactEvents(relay: string, eventIds: string[]): Observable<NostrEvent> {
	return new Observable((subscriber) => {
		if (!/^wss?:\/\//u.test(relay)) {
			subscriber.error(new Error('Unsupported relay URL'))
			return
		}
		const socket = new WebSocket(relay)
		const subscriptionId = `receipt-${crypto.randomUUID()}`
		socket.onopen = () => socket.send(JSON.stringify(['REQ', subscriptionId, { ids: eventIds }]))
		socket.onmessage = (message) => {
			try {
				const frame: unknown = JSON.parse(String(message.data))
				if (!Array.isArray(frame) || frame[1] !== subscriptionId) return
				if (frame[0] === 'EVENT' && frame[2] && typeof frame[2] === 'object')
					subscriber.next(frame[2] as NostrEvent)
				else if (frame[0] === 'EOSE') subscriber.complete()
				else if (frame[0] === 'CLOSED') subscriber.error(new Error('Relay closed the request'))
			} catch {
				// Unrelated or malformed relay frames do not prove delivery.
			}
		}
		socket.onerror = () => subscriber.error(new Error('Relay request failed'))
		socket.onclose = () => subscriber.error(new Error('Relay disconnected before EOSE'))
		return () => {
			socket.onopen = null
			socket.onmessage = null
			socket.onerror = null
			socket.onclose = null
			if (socket.readyState === WebSocket.OPEN)
				socket.send(JSON.stringify(['CLOSE', subscriptionId]))
			socket.close()
		}
	})
}

/** A matching coordinate or an event ID assertion is insufficient: compare the signed bytes. */
export function matchesSignedPublication(candidate: NostrEvent, signed: NostrEvent): boolean {
	try {
		if (candidate.id !== signed.id || candidate.sig !== signed.sig) return false
		const exact = (event: NostrEvent) =>
			JSON.stringify([
				event.pubkey,
				event.created_at,
				event.kind,
				event.tags,
				event.content,
				event.sig,
			])
		return (
			exact(candidate) === exact(signed) &&
			getEventHash(candidate) === signed.id &&
			verifyEvent(structuredClone(candidate))
		)
	} catch {
		return false
	}
}

/** Queries only exact signed IDs, without cached-event shortcuts or Nostr writes. */
export async function observeSignedPublications(
	events: readonly NostrEvent[],
	relayUrls: readonly string[],
	signal: AbortSignal,
	options: { timeoutMs?: number; request?: ExactEventRequest } = {},
): Promise<SignedPublicationObservation[]> {
	signal.throwIfAborted()
	const relays = [...new Set(relayUrls)]
	const expected = new Map(events.map((event) => [event.id, event]))
	if (expected.size === 0) return []
	const request = options.request ?? requestExactEvents
	const results = await Promise.all(
		relays.map(
			(relay) =>
				new Promise<Map<string, PublicationRelayObservation>>((resolve, reject) => {
					if (signal.aborted) {
						reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
						return
					}
					const verified = new Set<string>()
					let settled = false
					let subscription: Subscription | undefined
					let timer: ReturnType<typeof setTimeout> | undefined
					const cleanup = () => {
						if (timer) clearTimeout(timer)
						subscription?.unsubscribe()
						signal.removeEventListener('abort', abort)
					}
					const finish = (status: 'not_found' | 'timeout' | 'error') => {
						if (settled) return
						settled = true
						cleanup()
						resolve(
							new Map(
								[...expected.keys()].map((eventId) => [
									eventId,
									{ relay, status: verified.has(eventId) ? 'verified' : status },
								]),
							),
						)
					}
					const abort = () => {
						if (settled) return
						settled = true
						cleanup()
						reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
					}
					signal.addEventListener('abort', abort, { once: true })
					try {
						subscription = request(relay, [...expected.keys()]).subscribe({
							next: (candidate) => {
								const signed = expected.get(candidate.id)
								if (signed && matchesSignedPublication(candidate, signed))
									verified.add(candidate.id)
								if (verified.size === expected.size) finish('not_found')
							},
							complete: () => finish('not_found'),
							error: () => finish('error'),
						})
						if (settled) subscription.unsubscribe()
						else timer = setTimeout(() => finish('timeout'), options.timeoutMs ?? 8_000)
					} catch {
						finish('error')
					}
					if (signal.aborted) abort()
				}),
		),
	)
	signal.throwIfAborted()
	return [...expected.keys()].map((eventId) => {
		const observations = results.flatMap((result) => {
			const observation = result.get(eventId)
			return observation ? [observation] : []
		})
		return {
			eventId,
			status: observations.some((observation) => observation.status === 'verified')
				? 'verified'
				: 'uncertain',
			relays: observations,
		}
	})
}
