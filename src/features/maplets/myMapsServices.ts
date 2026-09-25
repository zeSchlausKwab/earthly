import type { Filter, NostrEvent } from 'nostr-tools'
import type { Subscription } from 'rxjs'
import {
	accounts,
	eventStore,
	isEventDeleted,
	pool,
	publish,
	queryCache,
	readRelaysFor,
} from '@/lib/nostr'
import { createMapletDataServices } from '@/lib/maplets/data'
import { myMapsDataPolicy } from './myMapsPolicy'
import type { MapletIdentity } from '@/lib/maplets/config'

/** Bounded EOSE query. A failed relay is never presented as a successful empty catalog. */
async function querySources(filters: Filter[], signal: AbortSignal): Promise<NostrEvent[]> {
	const cached = await queryCache(filters)
	signal.throwIfAborted()
	const relays = [...new Set([...readRelaysFor('content'), ...readRelaysFor('discovery')])]
	if (!relays.length) throw new Error('No source discovery relays are configured')
	return new Promise((resolve, reject) => {
		const events = new Map(
			cached.filter((event) => !isEventDeleted(event)).map((event) => [event.id, event]),
		)
		const done = new Set<string>()
		let failed = false
		let subscription: Subscription | undefined
		let finished = false
		const finish = (error?: Error) => {
			if (finished) return
			finished = true
			clearTimeout(timeout)
			signal.removeEventListener('abort', abort)
			subscription?.unsubscribe()
			if (error) reject(error)
			else
				resolve(
					[...events.values()]
						.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
						.slice(0, filters[0]?.limit ?? 100),
				)
		}
		const abort = () => finish(new Error('Source query cancelled'))
		const timeout = setTimeout(
			() => finish(new Error('Source relays did not finish responding. Try again.')),
			12_000,
		)
		signal.addEventListener('abort', abort, { once: true })
		subscription = pool.req(relays, filters, { reconnect: false, resubscribe: false }).subscribe({
			next(message) {
				if (
					message.type === 'EVENT' &&
					!isEventDeleted(message.event) &&
					events.size < 2000 &&
					message.event.content.length < 200_000
				)
					events.set(message.event.id, message.event)
				else if (message.type === 'EOSE' || message.type === 'ERROR' || message.type === 'CLOSED') {
					done.add(message.from)
					if (message.type !== 'EOSE') failed = true
					if (done.size >= relays.length)
						finish(
							failed
								? new Error('Some source relays could not be read. Try discovery again.')
								: undefined,
						)
				}
			},
			error: () => finish(new Error('Source relays could not be reached')),
		})
		if (finished) subscription.unsubscribe()
	})
}

/** Granted only to the reviewed bundled viewer; downloaded code gets no signing authority. */
export function createMyMapsServices(identity: MapletIdentity) {
	return createMapletDataServices(
		{ ...myMapsDataPolicy, namespace: `${identity.dTag}:${identity.aggregateHash}` },
		{
			pubkey: () => accounts.active?.pubkey ?? '',
			storage: localStorage,
			query: querySources,
			sign: async (template) => {
				if (!accounts.signer) throw new Error('Sign in first')
				return accounts.signer.signEvent(template)
			},
			encrypt: async (pubkey, content) => {
				if (!accounts.signer?.nip44)
					throw new Error(
						'Your signer needs NIP-44 to sync private sources. Your sources remain on this device.',
					)
				return accounts.signer.nip44.encrypt(pubkey, content)
			},
			decrypt: async (pubkey, content) => {
				if (!accounts.signer?.nip44)
					throw new Error('Your signer needs NIP-44 to restore private sources')
				return accounts.signer.nip44.decrypt(pubkey, content)
			},
			publish: async (event, signal, beforeCommit) => {
				await publish(event, { routing: 'outbox', signal, beforeCommit })
				eventStore.add(event)
			},
		},
	)
}
