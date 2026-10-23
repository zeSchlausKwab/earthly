import { describe, expect, test } from 'bun:test'
import { EventStore } from 'applesauce-core/event-store'
import { BehaviorSubject, Subject } from 'rxjs'
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type Filter,
	type NostrEvent,
} from 'nostr-tools'
import type { RelaySubscriptionResponse, RelaySubscriptionOptions } from 'applesauce-relay'
import {
	LIVE_TIMELINE_OPTIONS,
	startLiveTimelineSubscription,
	type LiveTimelineEnvironment,
} from './liveTimeline'

function makeEnvironment() {
	let visible = true
	let visibilityListener: (() => void) | null = null
	let onlineListener: (() => void) | null = null
	const value: LiveTimelineEnvironment = {
		isVisible: () => visible,
		onVisibilityChange: (callback) => {
			visibilityListener = callback
			return () => {
				visibilityListener = null
			}
		},
		onOnline: (callback) => {
			onlineListener = callback
			return () => {
				onlineListener = null
			}
		},
	}
	return {
		value,
		setVisible(next: boolean) {
			visible = next
			visibilityListener?.()
		},
		goOnline: () => onlineListener?.(),
		listeners: () => ({ visibilityListener, onlineListener }),
	}
}

function event(id: string): NostrEvent {
	return {
		id,
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
		kind: 1,
		created_at: 1_900_000_000,
		content: id,
		tags: [],
	}
}

describe('live Nostr timelines', () => {
	test('use a persistent REQ and keep accepting events after EOSE', () => {
		expect(LIVE_TIMELINE_OPTIONS).toEqual({ reconnect: true, resubscribe: true })

		const streams: Subject<RelaySubscriptionResponse>[] = []
		const calls: Array<{
			relays: string[]
			filters: Filter | Filter[]
			options: RelaySubscriptionOptions | undefined
		}> = []
		const pool = {
			relay(url: string) {
				return {
					subscription(filters: Filter | Filter[], options?: RelaySubscriptionOptions) {
						const relays = [url]
						calls.push({ relays, filters, options })
						const stream = new Subject<RelaySubscriptionResponse>()
						streams.push(stream)
						return stream
					},
				}
			},
		}
		const ingested: NostrEvent[] = []
		const done: string[] = []
		const environment = makeEnvironment()
		const stop = startLiveTimelineSubscription({
			pool,
			store: {
				add(next: NostrEvent) {
					ingested.push(next)
					return next
				},
			},
			relays: ['wss://relay.example'],
			filters: { kinds: [1] },
			onRelayDone: (relay) => done.push(relay),
			environment: environment.value,
		})

		expect(calls).toHaveLength(1)
		expect(calls[0]?.options).toEqual(LIVE_TIMELINE_OPTIONS)

		streams[0]?.next('EOSE')
		streams[0]?.next(event('a'.repeat(64)))
		expect(done).toEqual(['wss://relay.example'])
		expect(ingested.map((next) => next.id)).toEqual(['a'.repeat(64)])

		stop()
	})

	test('reopens the REQ on foreground resume and network return', () => {
		const streams: Subject<RelaySubscriptionResponse>[] = []
		const pool = {
			relay() {
				return {
					subscription() {
						const stream = new Subject<RelaySubscriptionResponse>()
						streams.push(stream)
						return stream
					},
				}
			},
		}
		const environment = makeEnvironment()
		const stop = startLiveTimelineSubscription({
			pool,
			store: { add: (next: NostrEvent) => next },
			relays: ['wss://relay.example'],
			filters: { kinds: [1] },
			environment: environment.value,
		})

		expect(streams).toHaveLength(1)
		environment.setVisible(false)
		expect(streams).toHaveLength(1)
		environment.setVisible(true)
		expect(streams).toHaveLength(2)
		expect(streams[0]?.observed).toBe(false)
		environment.goOnline()
		expect(streams).toHaveLength(3)
		expect(streams[1]?.observed).toBe(false)

		stop()
		expect(streams[2]?.observed).toBe(false)
		expect(environment.listeners()).toEqual({
			visibilityListener: null,
			onlineListener: null,
		})
	})

	test('applies a dataset-style addressable update received after EOSE', () => {
		const key = generateSecretKey()
		const pubkey = getPublicKey(key)
		const replaceable = (createdAt: number, content: string) =>
			finalizeEvent(
				{
					kind: 37_515,
					created_at: createdAt,
					content,
					tags: [['d', 'live-update-test']],
				},
				key,
			)
		const store = new EventStore()
		store.add(replaceable(1_900_000_000, 'before'))

		const stream = new Subject<RelaySubscriptionResponse>()
		const stop = startLiveTimelineSubscription({
			pool: { relay: () => ({ subscription: () => stream }) },
			store,
			relays: ['wss://relay.example'],
			filters: { kinds: [37_515] },
			environment: makeEnvironment().value,
		})
		stream.next('EOSE')
		stream.next(replaceable(1_900_000_001, 'after'))

		expect(store.getReplaceable(37_515, pubkey, 'live-update-test')?.content).toBe('after')
		stop()
	})
})

test('liveness releases failed optional sources and lets them rejoin without losing candidates', () => {
	const unhealthy$ = new BehaviorSubject<string[]>(['b'])
	const streams: Array<{ url: string; stream: Subject<RelaySubscriptionResponse> }> = []
	const states: Array<[string, string]> = []
	const stop = startLiveTimelineSubscription({
		pool: {
			relay: (url) => ({
				subscription: () => {
					const stream = new Subject<RelaySubscriptionResponse>()
					streams.push({ url, stream })
					return stream
				},
			}),
		},
		store: { add: () => {} },
		filters: { kinds: [1] },
		relays: ['a', 'b'],
		liveness: {
			unhealthy$,
			filter: (relays) => relays.filter((url) => !unhealthy$.value.includes(url)),
		},
		onRelayState: (url, state) => states.push([url, state.state]),
		environment: makeEnvironment().value,
	})
	expect(streams.map((entry) => entry.url)).toEqual(['a'])
	expect(states).toContainEqual(['b', 'skipped'])
	unhealthy$.next([])
	expect(streams.map((entry) => entry.url)).toEqual(['a', 'b'])
	unhealthy$.next(['a'])
	expect(streams[0]?.stream.observed).toBe(false)
	stop()
	expect(unhealthy$.observed).toBe(false)
	expect(streams[1]?.stream.observed).toBe(false)
})

test('disconnect invalidates successful synchronization before reconnect EOSE', () => {
	const connected$ = new BehaviorSubject(true)
	const stream = new Subject<RelaySubscriptionResponse>()
	const states: string[] = []
	const stop = startLiveTimelineSubscription({
		pool: { relay: () => ({ connected$, subscription: () => stream }) },
		store: { add: () => {} },
		filters: { kinds: [7375] },
		relays: ['a'],
		onRelayState: (_, state) => states.push(state.state),
		environment: makeEnvironment().value,
	})
	stream.next('EOSE')
	connected$.next(false)
	expect(states.at(-1)).toBe('loading')
	connected$.next(true)
	expect(states.at(-1)).toBe('loading')
	stream.next('EOSE')
	expect(states.at(-1)).toBe('ready')
	stop()
})
