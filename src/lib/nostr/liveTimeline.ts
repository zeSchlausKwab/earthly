import type {
	RelayAuthOptions,
	RelaySubscriptionOptions,
	RelaySubscriptionResponse,
} from 'applesauce-relay'
import type { Filter, NostrEvent } from 'nostr-tools'
import { Subscription, type Observable } from 'rxjs'

export interface LiveTimelineEnvironment {
	isVisible(): boolean
	onVisibilityChange(callback: () => void): () => void
	onOnline(callback: () => void): () => void
}

export type RelayReadState = 'loading' | 'ready' | 'failed' | 'skipped'
export interface RelayReadOutcome {
	state: RelayReadState
	error?: unknown
}

export interface LiveTimelinePool {
	relay(url: string): {
		connected$?: Observable<boolean>
		subscription(
			filters: Filter | Filter[],
			options?: RelaySubscriptionOptions,
		): Observable<RelaySubscriptionResponse>
	}
}

export interface TimelineLiveness {
	unhealthy$: Observable<string[]>
	filter(relays: string[]): string[]
}

export const LIVE_TIMELINE_OPTIONS = {
	reconnect: true,
	resubscribe: true,
} satisfies RelaySubscriptionOptions

function browserEnvironment(): LiveTimelineEnvironment {
	return {
		isVisible: () => document.visibilityState !== 'hidden',
		onVisibilityChange: (callback) => {
			document.addEventListener('visibilitychange', callback)
			return () => document.removeEventListener('visibilitychange', callback)
		},
		onOnline: (callback) => {
			window.addEventListener('online', callback)
			return () => window.removeEventListener('online', callback)
		},
	}
}

/** Upstream owns auth/retry; Earthly owns per-relay readiness, provenance,
 * visibility recovery, and eligibility. Share this module at the timeline seam. */
export function startLiveTimelineSubscription({
	pool,
	store,
	relays,
	filters,
	onRelayDone,
	onRelayState,
	onEvent,
	liveness,
	auth,
	environment = browserEnvironment(),
}: {
	pool: LiveTimelinePool
	store: { add(event: NostrEvent): unknown }
	relays: string[]
	filters: Filter | Filter[]
	onRelayDone?: (relay: string) => void
	onRelayState?: (relay: string, outcome: RelayReadOutcome) => void
	onEvent?: (event: NostrEvent, relay: string) => void
	liveness?: TimelineLiveness
	auth?: () => RelayAuthOptions
	environment?: LiveTimelineEnvironment
}): () => void {
	const candidates = [...new Set(relays)]
	const active = new Map<string, Subscription>()
	let stopped = false
	let reconciling = false
	let reconcileAgain = false

	const reconcile = () => {
		if (stopped) return
		if (reconciling) {
			reconcileAgain = true
			return
		}
		reconciling = true
		do {
			reconcileAgain = false
			const eligible = new Set(liveness ? liveness.filter(candidates) : candidates)
			for (const url of candidates) {
				if (!eligible.has(url)) {
					active.get(url)?.unsubscribe()
					active.delete(url)
					onRelayState?.(url, { state: 'skipped' })
					continue
				}
				if (active.has(url)) continue
				onRelayState?.(url, { state: 'loading' })
				const relay = pool.relay(url)
				const subscription = new Subscription()
				active.set(url, subscription)
				subscription.add(
					relay.connected$?.subscribe((connected) => {
						if (!connected) onRelayState?.(url, { state: 'loading' })
					}),
				)
				subscription.add(
					relay
						.subscription(filters, {
							...LIVE_TIMELINE_OPTIONS,
							...auth?.(),
						})
						.subscribe({
							next: (event) => {
								if (event === 'EOSE') {
									onRelayState?.(url, { state: 'ready' })
									onRelayDone?.(url)
								} else {
									try {
										store.add(event)
										onEvent?.(event, url)
									} catch {
										/* An invalid event must not end a live reader. */
									}
								}
							},
							error: (error: unknown) => onRelayState?.(url, { state: 'failed', error }),
						}),
				)
			}
		} while (reconcileAgain && !stopped)
		reconciling = false
	}
	const refreshIfVisible = () => {
		if (!environment.isVisible() || stopped) return
		for (const subscription of active.values()) subscription.unsubscribe()
		active.clear()
		reconcile()
	}
	const unsubscribeVisibility = environment.onVisibilityChange(refreshIfVisible)
	const unsubscribeOnline = environment.onOnline(refreshIfVisible)
	const healthSubscription = liveness?.unhealthy$.subscribe(reconcile)
	reconcile()

	return () => {
		stopped = true
		healthSubscription?.unsubscribe()
		for (const subscription of active.values()) subscription.unsubscribe()
		active.clear()
		unsubscribeVisibility()
		unsubscribeOnline()
	}
}
