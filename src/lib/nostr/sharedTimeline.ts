import type { Filter, NostrEvent } from 'nostr-tools'
import type { RelayReadOutcome } from './liveTimeline'

export interface TimelineStatus {
	state: 'loading' | 'ready' | 'partial' | 'unavailable'
	cache: 'loading' | 'ready' | 'failed'
	relays: Readonly<Record<string, RelayReadOutcome>>
	/** Initial loading settled or exceeded its presentation deadline. */
	settled: boolean
	/** Every requested relay reached EOSE; a deadline is never success. */
	complete: boolean
}

export const EMPTY_TIMELINE_STATUS: TimelineStatus = {
	state: 'ready',
	cache: 'ready',
	relays: {},
	settled: true,
	complete: true,
}

interface TimelineDependencies {
	start(options: {
		filters: Filter | Filter[]
		relays: string[]
		onRelayState(relay: string, outcome: RelayReadOutcome): void
	}): () => void
	hydrate(filters: Filter[]): Promise<NostrEvent[]>
	add(event: NostrEvent): unknown
	timeoutMs?: number
}

/** Status stays live after the deadline so recovery can complete a partial read. */
export function createSharedTimelines({
	start,
	hydrate,
	add,
	timeoutMs = 4000,
}: TimelineDependencies) {
	type Entry = {
		listeners: Set<(status: TimelineStatus) => void>
		status: TimelineStatus
		stop(): void
	}
	const entries = new Map<string, Entry>()
	const subscribe = (
		filters: Filter | Filter[],
		relays: string[],
		onStatus: (status: TimelineStatus) => void = () => {},
		scope = '',
	) => {
		const uniqueRelays = [...new Set(relays)].sort()
		const key = JSON.stringify([filters, uniqueRelays, scope])
		let entry = entries.get(key)
		if (!entry) {
			let cancelled = false
			let deadlinePassed = false
			let initiallySettled = false
			let cachedEvents = 0
			let cache: TimelineStatus['cache'] = 'loading'
			const outcomes: Record<string, RelayReadOutcome> = Object.fromEntries(
				uniqueRelays.map((url) => [url, { state: 'loading' }]),
			)
			let stopLive = () => {}
			const current: Entry = {
				listeners: new Set(),
				status: {
					state: 'loading',
					cache,
					relays: { ...outcomes },
					settled: false,
					complete: false,
				},
				stop: () => {
					cancelled = true
					clearTimeout(deadline)
					stopLive()
				},
			}
			const report = () => {
				if (cancelled) return
				const values = Object.values(outcomes)
				const complete =
					values.length > 0 &&
					values.every((value) => value.state === 'ready') &&
					cache !== 'loading'
				const settled =
					initiallySettled ||
					deadlinePassed ||
					(cache !== 'loading' && values.every((value) => value.state !== 'loading'))
				initiallySettled = settled
				const usable = cachedEvents > 0 || values.some((value) => value.state === 'ready')
				current.status = {
					state: complete ? 'ready' : !settled ? 'loading' : usable ? 'partial' : 'unavailable',
					cache,
					relays: { ...outcomes },
					complete,
					settled,
				}
				if (complete) clearTimeout(deadline)
				for (const listener of current.listeners) listener(current.status)
			}
			const deadline = setTimeout(() => {
				deadlinePassed = true
				report()
			}, timeoutMs)
			entries.set(key, current)
			entry = current
			void hydrate(Array.isArray(filters) ? filters : [filters]).then(
				(events) => {
					if (cancelled) return
					for (const event of events) {
						try {
							add(event)
							cachedEvents++
						} catch {
							/* Ignore invalid cached events. */
						}
					}
					cache = 'ready'
					report()
				},
				() => {
					cache = 'failed'
					report()
				},
			)
			if (uniqueRelays.length)
				stopLive = start({
					filters,
					relays: uniqueRelays,
					onRelayState: (url, outcome) => {
						if (uniqueRelays.includes(url)) {
							outcomes[url] = outcome
							report()
						}
					},
				})
		}
		entry.listeners.add(onStatus)
		onStatus(entry.status)
		const subscribed = entry
		let released = false
		return () => {
			if (released) return
			released = true
			subscribed.listeners.delete(onStatus)
			if (subscribed.listeners.size) return
			subscribed.stop()
			if (entries.get(key) === subscribed) entries.delete(key)
		}
	}
	return Object.assign(subscribe, {
		stop: () => {
			for (const entry of entries.values()) entry.stop()
			entries.clear()
		},
	})
}
