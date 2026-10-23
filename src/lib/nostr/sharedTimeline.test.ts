import { expect, test, mock } from 'bun:test'
import type { RelayReadOutcome } from './liveTimeline'
import type { NostrEvent } from 'nostr-tools'
import { createSharedTimelines } from './sharedTimeline'

function harness(timeoutMs = 4000) {
	let finishCache!: (events: NostrEvent[]) => void
	const hydrate = mock(
		() =>
			new Promise<NostrEvent[]>((resolve) => {
				finishCache = resolve
			}),
	)
	const stop = mock(() => {})
	let relayState!: (relay: string, outcome: RelayReadOutcome) => void
	const start = mock(
		(options: { onRelayState(relay: string, outcome: RelayReadOutcome): void }) => {
			relayState = options.onRelayState
			return stop
		},
	)
	const add = mock(() => {})
	const subscribe = createSharedTimelines({ hydrate, start, add, timeoutMs })
	return {
		subscribe,
		start,
		stop,
		hydrate,
		add,
		finishCache: (events: NostrEvent[] = []) => finishCache(events),
		relayDone: (relay: string) => relayState(relay, { state: 'ready' }),
		relayFailed: (relay: string) => relayState(relay, { state: 'failed' }),
	}
}

test('identical readers share cache and live requests; closing one retains the others', async () => {
	const h = harness()
	const first = mock(() => {})
	const second = mock(() => {})
	const leave = h.subscribe([{ kinds: [37518] }], ['b', 'a'], first)
	const leaveSecond = h.subscribe([{ kinds: [37518] }], ['a', 'b', 'a'], second)
	expect(h.start).toHaveBeenCalledTimes(1)
	expect(h.hydrate).toHaveBeenCalledTimes(1)
	h.relayDone('a')
	h.relayDone('b')
	expect(first).toHaveBeenLastCalledWith(
		expect.objectContaining({ settled: false, complete: false }),
	)
	h.finishCache()
	await Promise.resolve()
	expect(first).toHaveBeenLastCalledWith(expect.objectContaining({ settled: true, complete: true }))
	expect(second).toHaveBeenLastCalledWith(
		expect.objectContaining({ settled: true, complete: true }),
	)
	const late = mock(() => {})
	const leaveLate = h.subscribe([{ kinds: [37518] }], ['a', 'b'], late)
	expect(late).toHaveBeenLastCalledWith(expect.objectContaining({ settled: true, complete: true }))
	leave()
	leave()
	expect(h.stop).not.toHaveBeenCalled()
	leaveSecond()
	leaveLate()
	expect(h.stop).toHaveBeenCalledTimes(1)
})

test('account filters and relay scopes are never merged', () => {
	const h = harness()
	const leaves = [
		h.subscribe({ kinds: [1], authors: ['alice'] }, ['local']),
		h.subscribe({ kinds: [1], authors: ['bob'] }, ['local']),
		h.subscribe({ kinds: [1], authors: ['alice'] }, ['other']),
	]
	expect(h.start).toHaveBeenCalledTimes(3)
	for (const leave of leaves) leave()
	expect(h.stop).toHaveBeenCalledTimes(3)
})

test('released hydration cannot add events or notify a new subscription', async () => {
	const h = harness()
	const ready = mock(() => {})
	const leave = h.subscribe({ kinds: [1] }, ['local'], ready)
	leave()
	h.finishCache([{} as NostrEvent])
	await Promise.resolve()
	expect(h.add).not.toHaveBeenCalled()
	expect(ready).toHaveBeenCalledTimes(1)
})

test('offline readers still receive cached events and settle without relay EOSE', async () => {
	const h = harness()
	const ready = mock(() => {})
	const leave = h.subscribe({ kinds: [1] }, [], ready)
	h.finishCache([{} as NostrEvent])
	await Promise.resolve()
	expect(h.start).not.toHaveBeenCalled()
	expect(h.add).toHaveBeenCalledTimes(1)
	expect(ready).toHaveBeenLastCalledWith(
		expect.objectContaining({ settled: true, complete: false, state: 'partial' }),
	)
	leave()
})

test('a deadline settles the UI without making an incomplete wallet safe to spend', async () => {
	const h = harness(5)
	let reached!: () => void
	const settled = new Promise<void>((resolve) => {
		reached = resolve
	})
	const ready = mock((status: { settled: boolean }) => {
		if (status.settled) reached()
	})
	const leave = h.subscribe({ kinds: [7375] }, ['silent'], ready)
	h.finishCache()
	await settled
	expect(ready).toHaveBeenLastCalledWith(
		expect.objectContaining({ settled: true, complete: false, state: 'unavailable' }),
	)
	h.relayDone('silent')
	expect(ready).toHaveBeenLastCalledWith(
		expect.objectContaining({ complete: true, state: 'ready' }),
	)
	leave()
})

test('a failed source preserves partial results and later recovery', async () => {
	const h = harness()
	const status = mock(() => {})
	const leave = h.subscribe({ kinds: [1] }, ['a', 'b'], status)
	h.finishCache()
	await Promise.resolve()
	h.relayDone('a')
	h.relayFailed('b')
	expect(status).toHaveBeenLastCalledWith(
		expect.objectContaining({ state: 'partial', complete: false }),
	)
	h.relayDone('b')
	expect(status).toHaveBeenLastCalledWith(
		expect.objectContaining({ state: 'ready', complete: true }),
	)
	leave()
})

test('identical public filters are isolated by the authenticating account', () => {
	const h = harness()
	const leaves = ['alice', 'bob'].map((account) =>
		h.subscribe({ kinds: [1] }, ['a'], undefined, account),
	)
	expect(h.start).toHaveBeenCalledTimes(2)
	for (const leave of leaves) leave()
})
