import { describe, expect, test } from 'bun:test'
import { EventStore } from 'applesauce-core/event-store'
import { Subject } from 'rxjs'
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type Filter,
	type NostrEvent,
} from 'nostr-tools'
import type { GroupReqMessage, GroupReqOptions } from 'applesauce-relay'
import {
	LIVE_TIMELINE_REQ_OPTIONS,
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
		expect(LIVE_TIMELINE_REQ_OPTIONS).toEqual({ reconnect: true, resubscribe: true })

		const streams: Subject<GroupReqMessage>[] = []
		const calls: Array<{
			relays: string[]
			filters: Filter | Filter[]
			options: GroupReqOptions | undefined
		}> = []
		const pool = {
			req(relays: string[], filters: Filter | Filter[], options?: GroupReqOptions) {
				calls.push({ relays, filters, options })
				const stream = new Subject<GroupReqMessage>()
				streams.push(stream)
				return stream
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
		expect(calls[0]?.options).toEqual(LIVE_TIMELINE_REQ_OPTIONS)

		streams[0]?.next({ type: 'EOSE', from: 'wss://relay.example', id: 'req-1' })
		streams[0]?.next({
			type: 'EVENT',
			from: 'wss://relay.example',
			id: 'req-1',
			event: event('a'.repeat(64)),
		})
		expect(done).toEqual(['wss://relay.example'])
		expect(ingested.map((next) => next.id)).toEqual(['a'.repeat(64)])

		stop()
	})

	test('reopens the REQ on foreground resume and network return', () => {
		const streams: Subject<GroupReqMessage>[] = []
		const pool = {
			req() {
				const stream = new Subject<GroupReqMessage>()
				streams.push(stream)
				return stream
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

		const stream = new Subject<GroupReqMessage>()
		const stop = startLiveTimelineSubscription({
			pool: { req: () => stream },
			store,
			relays: ['wss://relay.example'],
			filters: { kinds: [37_515] },
			environment: makeEnvironment().value,
		})
		stream.next({ type: 'EOSE', from: 'wss://relay.example', id: 'req-1' })
		stream.next({
			type: 'EVENT',
			from: 'wss://relay.example',
			id: 'req-1',
			event: replaceable(1_900_000_001, 'after'),
		})

		expect(store.getReplaceable(37_515, pubkey, 'live-update-test')?.content).toBe('after')
		stop()
	})
})
