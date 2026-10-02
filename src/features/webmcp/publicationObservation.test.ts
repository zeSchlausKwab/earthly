import { expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { EMPTY, NEVER, Observable, of, throwError } from 'rxjs'
import { matchesSignedPublication, observeSignedPublications } from './publicationObservation'

const secret = generateSecretKey()
const event = (identifier: string) =>
	finalizeEvent(
		{
			kind: 37515,
			created_at: 100,
			tags: [['d', identifier]],
			content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
		},
		secret,
	)

test('exact receipt proof checks the ID, full event bytes, and the signature', () => {
	const signed = event('exact')
	expect(matchesSignedPublication(structuredClone(signed), signed)).toBe(true)
	for (const candidate of [
		{ ...signed, content: 'tampered' },
		{ ...signed, tags: [['d', 'different-source']] },
		{ ...signed, sig: '0'.repeat(128) },
		{ ...signed, id: '0'.repeat(64) },
		event('another-source'),
	])
		expect(matchesSignedPublication(candidate, signed)).toBe(false)
})

test('requests only retained exact IDs and separates positive observation from missing events', async () => {
	const first = event('first'),
		second = event('second')
	const requests: Array<{ relay: string; ids: string[] }> = []
	const result = await observeSignedPublications(
		[first, second],
		['ws://one', 'ws://one', 'ws://two'],
		new AbortController().signal,
		{
			request: (relay, ids) => {
				requests.push({ relay, ids })
				return relay === 'ws://one' ? of(first) : of(event('unrelated'))
			},
		},
	)
	expect(requests).toEqual([
		{ relay: 'ws://one', ids: [first.id, second.id] },
		{ relay: 'ws://two', ids: [first.id, second.id] },
	])
	expect(result).toEqual([
		{
			eventId: first.id,
			status: 'verified',
			relays: [
				{ relay: 'ws://one', status: 'verified' },
				{ relay: 'ws://two', status: 'not_found' },
			],
		},
		{
			eventId: second.id,
			status: 'uncertain',
			relays: [
				{ relay: 'ws://one', status: 'not_found' },
				{ relay: 'ws://two', status: 'not_found' },
			],
		},
	])
})

test('EOSE absence, relay errors, no configured relays, and timeout remain uncertain', async () => {
	const signed = event('uncertain')
	const result = await observeSignedPublications(
		[signed],
		['ws://empty', 'ws://failed', 'ws://silent'],
		new AbortController().signal,
		{
			timeoutMs: 2,
			request: (relay) =>
				relay === 'ws://empty'
					? EMPTY
					: relay === 'ws://failed'
						? throwError(() => new Error('offline'))
						: NEVER,
		},
	)
	expect(result).toEqual([
		{
			eventId: signed.id,
			status: 'uncertain',
			relays: [
				{ relay: 'ws://empty', status: 'not_found' },
				{ relay: 'ws://failed', status: 'error' },
				{ relay: 'ws://silent', status: 'timeout' },
			],
		},
	])
	expect(await observeSignedPublications([signed], [], new AbortController().signal)).toEqual([
		{ eventId: signed.id, status: 'uncertain', relays: [] },
	])
	let requests = 0
	expect(
		await observeSignedPublications([], ['ws://one'], new AbortController().signal, {
			request: () => {
				requests++
				return EMPTY
			},
		}),
	).toEqual([])
	expect(requests).toBe(0)
})

test('cancellation unsubscribes every relay request and returns no evidence', async () => {
	const controller = new AbortController()
	let unsubscribed = 0
	const pending = observeSignedPublications(
		[event('cancel')],
		['ws://one', 'ws://two'],
		controller.signal,
		{
			request: () =>
				new Observable(() => () => {
					unsubscribed++
				}),
		},
	)
	controller.abort(new Error('cancelled'))
	await expect(pending).rejects.toThrow('cancelled')
	expect(unsubscribed).toBe(2)
})

test('cancellation at one synchronous relay boundary does not start further relay requests', async () => {
	const controller = new AbortController()
	const requests: string[] = []
	const pending = observeSignedPublications(
		[event('cancel-at-request')],
		['ws://one', 'ws://two'],
		controller.signal,
		{
			request: (relay) => {
				requests.push(relay)
				controller.abort(new Error('cancelled before second relay'))
				return NEVER
			},
		},
	)
	await expect(pending).rejects.toThrow('cancelled before second relay')
	expect(requests).toEqual(['ws://one'])
})

test('the native transport sends only REQ/CLOSE and never answers signing-dependent AUTH', async () => {
	const original = globalThis.WebSocket
	const sockets: ReadOnlySocket[] = []
	class ReadOnlySocket {
		static OPEN = 1
		readyState = 1
		onopen: (() => void) | null = null
		onmessage: ((message: { data: string }) => void) | null = null
		onerror: (() => void) | null = null
		onclose: (() => void) | null = null
		frames: unknown[][] = []
		constructor(readonly url: string) {
			sockets.push(this)
		}
		send(frame: string) {
			this.frames.push(JSON.parse(frame))
		}
		close() {
			this.readyState = 3
		}
		receive(frame: unknown[]) {
			this.onmessage?.({ data: JSON.stringify(frame) })
		}
	}
	Object.assign(globalThis, { WebSocket: ReadOnlySocket })
	try {
		const signed = event('no-auth-signing')
		const pending = observeSignedPublications(
			[signed],
			['ws://configured'],
			new AbortController().signal,
		)
		const socket = sockets[0]
		if (!socket) throw new Error('No relay request was opened')
		socket.onopen?.()
		const subscriptionId = socket.frames[0]?.[1]
		socket.receive(['AUTH', 'challenge'])
		expect(socket.frames.map((frame) => frame[0])).toEqual(['REQ'])
		socket.receive(['EVENT', subscriptionId, signed])
		expect((await pending)[0]?.status).toBe('verified')
		expect(socket.frames).toEqual([
			['REQ', subscriptionId, { ids: [signed.id] }],
			['CLOSE', subscriptionId],
		])
		expect(socket.readyState).toBe(3)
	} finally {
		Object.assign(globalThis, { WebSocket: original })
	}
})
