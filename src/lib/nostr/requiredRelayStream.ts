import type { GroupReqMessage, RelayAuthOptions } from 'applesauce-relay'
import type { Filter } from 'nostr-tools'
import { merge, Observable } from 'rxjs'
import type { LiveTimelinePool } from './liveTimeline'

/** Required reads attempt every source and fail closed on interruption. Preserve
 * per-relay EOSE/provenance while v7 owns authentication for each operation. */
export function requiredRelayStream(
	pool: LiveTimelinePool,
	relays: string[],
	filters: Filter[],
	auth: RelayAuthOptions,
) {
	return merge(
		...[...new Set(relays)].map(
			(from) =>
				new Observable<GroupReqMessage>((observer) => {
					const id = 'required-read'
					return pool
						.relay(from)
						.subscription(filters, { ...auth, reconnect: false, resubscribe: false })
						.subscribe({
							next: (event) =>
								observer.next(
									event === 'EOSE'
										? { type: 'EOSE', from, id }
										: { type: 'EVENT', from, id, event },
								),
							error: (error) => {
								observer.next({ type: 'ERROR', from, error })
								observer.complete()
							},
							complete: () => {
								observer.next({
									type: 'CLOSED',
									from,
									id,
									reason: 'Relay ended a required live read',
								})
								observer.complete()
							},
						})
				}),
		),
	)
}
