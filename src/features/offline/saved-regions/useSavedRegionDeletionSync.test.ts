import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { GroupReqMessage } from 'applesauce-relay'
import { parseHTML } from 'linkedom'
import { finalizeEvent, type Filter, type NostrEvent } from 'nostr-tools'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

type IngestResult = 'applied' | 'invalid' | 'cache-error'

interface RelayObserver {
	next(message: GroupReqMessage): void
	error(error: unknown): void
}

interface Deferred<T> {
	promise: Promise<T>
	resolve(value: T): void
	reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

const eventStoreAdd = mock((_event: NostrEvent) => true)
const ingestDeletionEvent = mock(async (event: NostrEvent): Promise<IngestResult> => {
	eventStoreAdd(event)
	return 'applied'
})
const queryCacheStrict = mock(async (_filters: Filter[]): Promise<NostrEvent[]> => [])
const relayObservers: RelayObserver[] = []
const unsubscribe = mock(() => {})
const relayRequest = mock((_relays: string[], _filters: Filter[]) => ({
	subscribe(observer: RelayObserver) {
		relayObservers.push(observer)
		return { unsubscribe }
	},
}))

mock.module('@/lib/nostr', () => ({
	eventStore: { add: eventStoreAdd },
	ingestDeletionEvent,
	pool: { req: relayRequest },
	queryCacheStrict,
}))
mock.module('@/lib/nostr/relay-router', () => ({
	readRelaysFor: () => ['wss://relay.test'],
}))

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let boundedDeletionSyncTimeoutMs: typeof import('./useSavedRegionDeletionSync').boundedDeletionSyncTimeoutMs
let useSavedRegionDeletionSync: typeof import('./useSavedRegionDeletionSync').useSavedRegionDeletionSync

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []
let cacheResponse: Deferred<NostrEvent[]>

const SECRET = new Uint8Array(32).fill(7)
const candidate = finalizeEvent(
	{
		kind: 30_001,
		created_at: 100,
		tags: [['d', 'saved-region-target']],
		content: '',
	},
	SECRET,
)
const candidateAddress = `${candidate.kind}:${candidate.pubkey}:saved-region-target`

function deletion(createdAt: number, content: string): NostrEvent {
	return finalizeEvent(
		{
			kind: 5,
			created_at: createdAt,
			tags: [
				['e', candidate.id],
				['a', candidateAddress],
			],
			content,
		},
		SECRET,
	)
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

async function mountSync() {
	let latest: ReturnType<typeof useSavedRegionDeletionSync> | null = null
	const candidates = [candidate]
	function Probe(): ReactNode {
		latest = useSavedRegionDeletionSync(candidates, true)
		return null
	}
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mountedRoots.push({ root, container })
	await flush(() => root.render(createElement(Probe)))
	return {
		state: () => {
			if (!latest) throw new Error('Deletion-sync hook did not render')
			return latest
		},
	}
}

function relayObserver(): RelayObserver {
	const observer = relayObservers.at(-1)
	if (!observer) throw new Error('Deletion-sync relay subscription was not created')
	return observer
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
	;({ boundedDeletionSyncTimeoutMs, useSavedRegionDeletionSync } = await import(
		'./useSavedRegionDeletionSync'
	))
})

beforeEach(() => {
	cacheResponse = deferred<NostrEvent[]>()
	relayObservers.length = 0
	eventStoreAdd.mockClear()
	ingestDeletionEvent.mockClear()
	queryCacheStrict.mockClear()
	relayRequest.mockClear()
	unsubscribe.mockClear()
	ingestDeletionEvent.mockImplementation(async (event: NostrEvent) => {
		eventStoreAdd(event)
		return 'applied'
	})
	queryCacheStrict.mockImplementation(async () => cacheResponse.promise)
})

afterEach(async () => {
	await flush(() => {
		for (const { root } of mountedRoots.splice(0)) root.unmount()
	})
	for (const container of Array.from(document.body.children)) container.remove()
})

describe('saved-region deletion sync bounds', () => {
	test('scales the initial EOSE window for sequential request batches with a hard ceiling', () => {
		expect(boundedDeletionSyncTimeoutMs(1)).toBe(4_000)
		expect(boundedDeletionSyncTimeoutMs(64)).toBe(4_000)
		expect(boundedDeletionSyncTimeoutMs(65)).toBe(8_000)
		expect(boundedDeletionSyncTimeoutMs(512)).toBe(30_000)
	})
})

describe('saved-region deletion sync lifecycle', () => {
	test('applies a relay deletion after local flush without waiting for EOSE and preserves newest address state', async () => {
		const newerCached = deletion(200, 'newer cached tombstone')
		const olderRelay = deletion(150, 'older relay tombstone')
		const mounted = await mountSync()

		await flush(() => cacheResponse.resolve([newerCached]))
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(false)
		expect(ingestDeletionEvent.mock.calls.map(([event]) => event.id)).toEqual([newerCached.id])

		await flush(() => {
			relayObserver().next({
				type: 'EVENT',
				from: 'wss://relay.test',
				event: olderRelay,
			} as GroupReqMessage)
		})
		expect(ingestDeletionEvent.mock.calls.map(([event]) => event.id)).toEqual([
			newerCached.id,
			olderRelay.id,
		])
		expect(mounted.state().deletions.map((event) => event.id)).toEqual([
			olderRelay.id,
			newerCached.id,
		])
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(false)
		expect(eventStoreAdd.mock.calls.slice(-2).map(([event]) => event.id)).toEqual([
			olderRelay.id,
			newerCached.id,
		])

		await flush(() => {
			relayObserver().next({ type: 'EOSE', from: 'wss://relay.test' } as GroupReqMessage)
		})
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(true)
	})

	test('keeps locally restored state usable while surfacing a relay failure', async () => {
		const mounted = await mountSync()
		await flush(() => cacheResponse.resolve([]))
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(false)

		await flush(() => {
			relayObserver().next({ type: 'ERROR' } as GroupReqMessage)
		})
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(false)
		expect(mounted.state().error).toBe('A relay failed while checking deleted Earthly records')
	})

	test('drops readiness only while a post-EOSE live deletion is being persisted', async () => {
		const liveDeletion = deletion(250, 'live tombstone')
		const liveIngest = deferred<IngestResult>()
		ingestDeletionEvent.mockImplementation(async (event: NostrEvent) => {
			eventStoreAdd(event)
			if (event.id === liveDeletion.id) return liveIngest.promise
			return 'applied'
		})
		const mounted = await mountSync()
		await flush(() => cacheResponse.resolve([]))
		await flush(() => {
			relayObserver().next({ type: 'EOSE', from: 'wss://relay.test' } as GroupReqMessage)
		})
		expect(mounted.state().ready).toBe(true)

		await flush(() => {
			relayObserver().next({
				type: 'EVENT',
				from: 'wss://relay.test',
				event: liveDeletion,
			} as GroupReqMessage)
		})
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(false)
		expect(mounted.state().deletions).toEqual([])

		await flush(() => liveIngest.resolve('applied'))
		expect(mounted.state().localReady).toBe(true)
		expect(mounted.state().ready).toBe(true)
		expect(mounted.state().deletions.map((event) => event.id)).toEqual([liveDeletion.id])
	})
})
