import { expect, test, mock } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { createSharedTimelines } from './sharedTimeline'

function harness() {
	let finishCache!: (events: NostrEvent[]) => void
	const hydrate = mock(() => new Promise<NostrEvent[]>(resolve => { finishCache = resolve }))
	const stop = mock(() => {})
	let relayDone!: (relay: string) => void
	const start = mock((options: { onRelayDone(relay: string): void }) => { relayDone = options.onRelayDone; return stop })
	const add = mock(() => {})
	const subscribe = createSharedTimelines({ hydrate, start, add })
	return { subscribe, start, stop, hydrate, add, finishCache: (events: NostrEvent[] = []) => finishCache(events), relayDone: (relay: string) => relayDone(relay) }
}

test('identical readers share cache and live requests; closing one retains the others', async () => {
	const h = harness()
	const first = mock(() => {})
	const second = mock(() => {})
	const leave = h.subscribe([{ kinds: [37518] }], ['b', 'a'], first)
	const leaveSecond = h.subscribe([{ kinds: [37518] }], ['a', 'b', 'a'], second)
	expect(h.start).toHaveBeenCalledTimes(1)
	expect(h.hydrate).toHaveBeenCalledTimes(1)
	h.relayDone('a'); h.relayDone('b')
	expect(first).toHaveBeenLastCalledWith(false)
	h.finishCache(); await Promise.resolve()
	expect(first).toHaveBeenLastCalledWith(true)
	expect(second).toHaveBeenLastCalledWith(true)
	const late = mock(() => {})
	const leaveLate = h.subscribe([{ kinds: [37518] }], ['a', 'b'], late)
	expect(late).toHaveBeenLastCalledWith(true)
	leave(); leave()
	expect(h.stop).not.toHaveBeenCalled()
	leaveSecond(); leaveLate()
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
	h.finishCache([{} as NostrEvent]); await Promise.resolve()
	expect(h.add).not.toHaveBeenCalled()
	expect(ready).toHaveBeenCalledTimes(1)
})

test('offline readers still receive cached events and settle without relay EOSE', async () => {
	const h = harness()
	const ready = mock(() => {})
	const leave = h.subscribe({ kinds: [1] }, [], ready)
	h.finishCache([{} as NostrEvent]); await Promise.resolve()
	expect(h.start).not.toHaveBeenCalled()
	expect(h.add).toHaveBeenCalledTimes(1)
	expect(ready).toHaveBeenLastCalledWith(true)
	leave()
})
