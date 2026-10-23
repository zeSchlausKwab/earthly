import {
	createCountService,
	type CountMetric,
	type CountService,
	type CountTarget,
} from 'applesauce-loaders/loaders/count-service'
import type { RelayAuthOptions } from 'applesauce-relay'
import type { CountRelayPool } from 'applesauce-loaders/loaders/count-scheduler'
import type { NostrEvent } from 'nostr-tools'
import {
	combineLatest,
	concatWith,
	NEVER,
	distinctUntilChanged,
	finalize,
	map,
	type Observable,
	shareReplay,
	Subject,
	switchMap,
	takeUntil,
} from 'rxjs'
import { GEO_COMMENT_KIND } from './kinds'

/** Stable addresses deliberately keep totals across revisions. Never combine #a and #e counts. */
export function socialCountTarget(event: NostrEvent): CountTarget {
	const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
	return {
		id: event.id,
		kind: event.kind,
		created_at: event.created_at,
		...(event.kind >= 30000 && event.kind < 40000 && identifier !== undefined
			? { address: `${event.kind}:${event.pubkey}:${identifier}` }
			: {}),
	}
}

export const earthlyReactionMetric: CountMetric = {
	id: 'earthly.reactions.v1',
	filters: (target) => [
		{ kinds: [7], ...(target.address ? { '#a': [target.address] } : { '#e': [target.id] }) },
	],
}
export const earthlyCommentMetric: CountMetric = {
	id: 'earthly.geo-root-comments.v1',
	filters: (target) =>
		target.address ? [{ kinds: [GEO_COMMENT_KIND], '#A': [target.address] }] : undefined,
}

/** One count service per account/relay policy, shared by all visible readers.
 * Last-reader cleanup releases work; each service bounds its inactive cache. */
export function createSocialCounts({
	pool,
	relays$,
	scope$,
	auth,
}: {
	pool: CountRelayPool
	relays$: Observable<string[]>
	scope$: Observable<unknown>
	auth(): RelayAuthOptions
}) {
	let current: CountService | undefined
	const stop$ = new Subject<void>()
	const services$ = combineLatest([relays$, scope$]).pipe(
		distinctUntilChanged(
			([oldRelays, oldScope], [relays, scope]) =>
				oldScope === scope && JSON.stringify(oldRelays) === JSON.stringify(relays),
		),
		map(([relays]) => {
			current?.stop()
			const authOptions = auth()
			current = createCountService(
				{
					relay: (url) => ({
						count: (filters, id, options) =>
							pool.relay(url).count(filters, id, { ...options, ...authOptions }),
					}),
				},
				{
					relays,
					concurrency: 4,
					cacheCapacity: 500,
					attemptTimeout: 4000,
				},
			)
			return current
		}),
		concatWith(NEVER),
		takeUntil(stop$),
		finalize(() => {
			current?.stop()
			current = undefined
		}),
		shareReplay({ bufferSize: 1, refCount: true }),
	)
	return {
		observe: (target: CountTarget, metric: CountMetric) =>
			services$.pipe(switchMap((service) => service.event(target).metric(metric))),
		/** Acknowledged social writes can affect several targets, especially deletions. */
		invalidate: () => {
			void current
				?.invalidate()
				.catch((error) => console.warn('[nostr] count invalidation failed', error))
		},
		stop: () => {
			stop$.next()
			stop$.complete()
			current?.stop()
		},
	}
}
