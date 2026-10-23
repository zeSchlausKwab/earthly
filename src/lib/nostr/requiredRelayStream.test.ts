import { expect, test } from 'bun:test'
import type { RelaySubscriptionOptions, RelaySubscriptionResponse } from 'applesauce-relay'
import type { Filter, NostrEvent } from 'nostr-tools'
import { Subject } from 'rxjs'
import { requiredRelayStream } from './requiredRelayStream'

test('required reads attempt every relay, preserve EOSE provenance, and stay live', () => {
	const sources = new Map<string, Subject<RelaySubscriptionResponse>>()
	const options: RelaySubscriptionOptions[] = []
	const pool = {
		relay(url: string) {
			const source = new Subject<RelaySubscriptionResponse>()
			sources.set(url, source)
			return {
				subscription(_filters: Filter | Filter[], config?: RelaySubscriptionOptions) {
					options.push(config ?? {})
					return source
				},
			}
		},
	}
	const messages: unknown[] = []
	const onAuthRequired = async () => {}
	const subscription = requiredRelayStream(
		pool,
		['wss://one', 'wss://two', 'wss://one'],
		[{ kinds: [5] }],
		{
			waitForAuth: 'account-pubkey',
			onAuthRequired,
		},
	).subscribe((message) => messages.push(message))
	for (const config of options)
		expect(config).toEqual({
			waitForAuth: 'account-pubkey',
			onAuthRequired,
			reconnect: false,
			resubscribe: false,
		})
	expect(sources.size).toBe(2)
	sources.get('wss://one')?.next('EOSE')
	expect(messages).toEqual([{ type: 'EOSE', from: 'wss://one', id: 'required-read' }])
	const event = { id: 'live-deletion' } as NostrEvent
	sources.get('wss://two')?.next('EOSE')
	sources.get('wss://one')?.next(event)
	expect(messages.at(-1)).toEqual({ type: 'EVENT', from: 'wss://one', id: 'required-read', event })
	expect(subscription.closed).toBe(false)
	subscription.unsubscribe()
	for (const source of sources.values()) expect(source.observed).toBe(false)
})

test('interruption after EOSE is reported as failure rather than successful completion', () => {
	const source = new Subject<RelaySubscriptionResponse>()
	const messages: { type: string }[] = []
	requiredRelayStream({ relay: () => ({ subscription: () => source }) }, ['wss://one'], [], {
		waitForAuth: false,
	}).subscribe((message) => messages.push(message))
	source.next('EOSE')
	source.complete()
	expect(messages.map((message) => message.type)).toEqual(['EOSE', 'CLOSED'])
})

test('a failed relay is not represented as an empty successful read', () => {
	const source = new Subject<RelaySubscriptionResponse>()
	const messages: unknown[] = []
	requiredRelayStream({ relay: () => ({ subscription: () => source }) }, ['wss://one'], [], {
		waitForAuth: false,
	}).subscribe((message) => messages.push(message))
	const error = new Error('auth refused')
	source.error(error)
	expect(messages).toEqual([{ type: 'ERROR', from: 'wss://one', error }])
})
