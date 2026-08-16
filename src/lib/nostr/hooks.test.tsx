import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { Filter, NostrEvent } from 'nostr-tools'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

interface Deferred<T> {
	promise: Promise<T>
	resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

const eventStoreAdd = mock((_event: NostrEvent) => true)
const queryCache = mock(async (_filters: Filter[]): Promise<NostrEvent[]> => [])
const stopSubscription = mock(() => {})
let relayDone: ((relay: string) => void) | undefined
const startLiveTimelineSubscription = mock((options: { onRelayDone?: (relay: string) => void }) => {
	relayDone = options.onRelayDone
	return stopSubscription
})

mock.module('applesauce-react/hooks', () => ({ use$: () => undefined }))
mock.module('@/lib/nostr/index', () => ({
	eventStore: { add: eventStoreAdd },
	pool: {},
	queryCache,
}))
mock.module('@/lib/nostr/liveTimeline', () => ({ startLiveTimelineSubscription }))
mock.module('@/lib/nostr/relay-router', () => ({
	bucketForKind: () => 'content',
	readRelaysFor: () => ['wss://relay.test'],
}))

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useTimelineWithEose: typeof import('./hooks').useTimelineWithEose
const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []
let cacheResponse: Deferred<NostrEvent[]>

const cachedEvent: NostrEvent = {
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	sig: 'c'.repeat(128),
	kind: 1,
	created_at: 1_900_000_000,
	content: 'cached',
	tags: [],
}

async function settleMicrotasks() {
	for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

async function flush(action?: () => void) {
	await act(async () => {
		action?.()
		await settleMicrotasks()
	})
}

async function mountTimeline() {
	let latest: ReturnType<typeof useTimelineWithEose> | null = null
	function Probe(): ReactNode {
		latest = useTimelineWithEose({ kinds: [1] }, ['wss://relay.test'])
		return null
	}
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mountedRoots.push({ root, container })
	await flush(() => root.render(createElement(Probe)))
	return () => {
		if (!latest) throw new Error('Timeline hook did not render')
		return latest
	}
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		MutationObserver: window.MutationObserver,
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true

	const react = await import('react')
	act = react.act
	createElement = react.createElement
	;({ createRoot } = await import('react-dom/client'))
	;({ useTimelineWithEose } = await import('./hooks'))
})

beforeEach(() => {
	cacheResponse = deferred<NostrEvent[]>()
	relayDone = undefined
	eventStoreAdd.mockClear()
	queryCache.mockClear()
	stopSubscription.mockClear()
	startLiveTimelineSubscription.mockClear()
	queryCache.mockImplementation(async () => cacheResponse.promise)
})

afterEach(async () => {
	await flush(() => {
		for (const { root } of mountedRoots.splice(0)) root.unmount()
	})
	for (const container of Array.from(document.body.children)) container.remove()
})

describe('useTimelineWithEose cache barrier', () => {
	test('waits for cache hydration after every relay has reported EOSE', async () => {
		const state = await mountTimeline()
		expect(state().eose).toBe(false)

		await flush(() => relayDone?.('wss://relay.test'))
		expect(state().eose).toBe(false)
		expect(eventStoreAdd).not.toHaveBeenCalled()

		await flush(() => cacheResponse.resolve([cachedEvent]))
		expect(eventStoreAdd).toHaveBeenCalledWith(cachedEvent)
		expect(state().eose).toBe(true)
	})
})
