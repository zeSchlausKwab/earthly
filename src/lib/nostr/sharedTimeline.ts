import type { Filter, NostrEvent } from 'nostr-tools'

interface TimelineDependencies {
	start(options: { filters: Filter | Filter[]; relays: string[]; onRelayDone(relay: string): void }): () => void
	hydrate(filters: Filter[]): Promise<NostrEvent[]>
	add(event: NostrEvent): unknown
	timeoutMs?: number
}

/** Identical readers share one cache hydration and live REQ until the last leaves. */
export function createSharedTimelines({ start, hydrate, add, timeoutMs = 4000 }: TimelineDependencies) {
	type Entry = { listeners: Set<(ready: boolean) => void>; ready: boolean; stop(): void }
	const entries = new Map<string, Entry>()
	return function subscribe(filters: Filter | Filter[], relays: string[], onReady: (ready: boolean) => void = () => {}) {
		const uniqueRelays = [...new Set(relays)].sort()
		// No widening/merging: private author filters and relay scopes remain isolated.
		const key = JSON.stringify([filters, uniqueRelays])
		let entry = entries.get(key)
		if (!entry) {
			let cancelled = false
			let cacheReady = false
			const done = new Set<string>()
			const listeners = new Set<(ready: boolean) => void>()
			let stopLive = () => {}
			const current: Entry = { listeners, ready: false, stop: () => {
				cancelled = true
				clearTimeout(deadline)
				stopLive()
			} }
			const report = () => {
				if (cancelled || current.ready) return
				current.ready = true
				clearTimeout(deadline)
				for (const listener of listeners) listener(true)
			}
			const settled = () => { if (cacheReady && done.size === uniqueRelays.length) report() }
			const deadline = setTimeout(report, timeoutMs)
			entries.set(key, current)
			entry = current
			void hydrate(Array.isArray(filters) ? filters : [filters]).then(events => {
				if (cancelled) return
				for (const event of events) {
					try { add(event) } catch { /* A bad cached event must not discard the rest. */ }
				}
				cacheReady = true
				settled()
			}, () => { cacheReady = true; settled() })
			if (uniqueRelays.length) stopLive = start({ filters, relays: uniqueRelays, onRelayDone: relay => {
				if (uniqueRelays.includes(relay)) done.add(relay)
				settled()
			} })
		}
		entry.listeners.add(onReady)
		onReady(entry.ready)
		const subscribed = entry
		let released = false
		return () => {
			if (released) return
			released = true
			subscribed.listeners.delete(onReady)
			if (subscribed.listeners.size) return
			subscribed.stop()
			if (entries.get(key) === subscribed) entries.delete(key)
		}
	}
}
