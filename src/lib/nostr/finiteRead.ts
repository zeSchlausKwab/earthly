import type { RelayAuthOptions, RelayRequestOptions } from 'applesauce-relay'
import type { Filter, NostrEvent } from 'nostr-tools'
import {
	firstValueFrom,
	fromEvent,
	mergeMap,
	NEVER,
	takeUntil,
	tap,
	throwError,
	timeout,
	toArray,
	type Observable,
} from 'rxjs'

export type RelayReadResult =
	| { relay: string; ok: true; events: NostrEvent[] }
	| { relay: string; ok: false; error: unknown; events: NostrEvent[] }

/** Finite reads preserve each relay's success/failure and provenance. A refusal
 * is never an empty successful response. Callers choose their completeness policy. */
export async function readRelayEvents(
	pool: {
		relay(url: string): {
			request(filters: Filter | Filter[], options?: RelayRequestOptions): Observable<NostrEvent>
		}
	},
	relays: string[],
	filters: Filter | Filter[],
	options: {
		auth?: RelayAuthOptions
		timeoutMs?: number
		signal?: AbortSignal
		maxEvents?: number
	} = {},
): Promise<RelayReadResult[]> {
	options.signal?.throwIfAborted()
	const abort$ = options.signal
		? fromEvent(options.signal, 'abort').pipe(
				mergeMap(() => throwError(() => options.signal?.reason ?? new Error('Read cancelled'))),
			)
		: NEVER
	const results = await Promise.all(
		[...new Set(relays)].map(async (relay): Promise<RelayReadResult> => {
			const events: NostrEvent[] = []
			try {
				await firstValueFrom(
					pool
						.relay(relay)
						.request(filters, {
							...options.auth,
							reconnect: false,
							resubscribe: false,
							timeout: options.timeoutMs ?? 10_000,
						})
						.pipe(
							tap((event) => {
								if (events.length >= (options.maxEvents ?? 2000))
									throw new Error('Relay response exceeded the event limit')
								events.push(event)
							}),
							toArray(),
							timeout(options.timeoutMs ?? 10_000),
							takeUntil(abort$),
						),
				)
				return { relay, ok: true, events }
			} catch (error) {
				return { relay, ok: false, error, events }
			}
		}),
	)
	options.signal?.throwIfAborted()
	return results
}
