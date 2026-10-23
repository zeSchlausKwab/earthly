import type { Filter, NostrEvent } from 'nostr-tools'
import { readRelayEvents } from '@/lib/nostr/finiteRead'
import {
	accounts,
	eventStore,
	isEventDeleted,
	pool,
	publish,
	queryCache,
	readRelaysFor,
	relayAuthOptions,
} from '@/lib/nostr'
import { createMapletDataServices } from '@/lib/maplets/data'
import { myMapsDataPolicy } from './myMapsPolicy'
import type { MapletIdentity } from '@/lib/maplets/config'
import { migrateMyMapsStorage } from './myMapsStorage'

/** Bounded EOSE query. A failed relay is never presented as a successful empty catalog. */
async function querySources(filters: Filter[], signal: AbortSignal): Promise<NostrEvent[]> {
	const cached = await queryCache(filters)
	signal.throwIfAborted()
	const relays = [...new Set([...readRelaysFor('content'), ...readRelaysFor('discovery')])]
	if (!relays.length) throw new Error('No source discovery relays are configured')
	const results = await readRelayEvents(pool, relays, filters, {
		signal,
		timeoutMs: 12_000,
		auth: relayAuthOptions(),
	})
	if (results.some((result) => !result.ok))
		throw new Error('Some source relays could not be read. Try discovery again.')
	const events = new Map(
		cached.filter((event) => !isEventDeleted(event)).map((event) => [event.id, event]),
	)
	for (const result of results)
		for (const event of result.events) {
			if (!isEventDeleted(event) && events.size < 2000 && event.content.length < 200_000)
				events.set(event.id, event)
		}
	return [...events.values()]
		.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
		.slice(0, filters[0]?.limit ?? 100)
}

/** Granted only to the reviewed bundled viewer; downloaded code gets no signing authority. */
export function createMyMapsServices(identity: MapletIdentity) {
	if (identity.dTag !== 'bundled:my-maps-viewer')
		throw new Error('GMapper data access is restricted to the reviewed bundled Maplet')
	const migratedAccounts = new Set<string>()
	const request = createMapletDataServices(
		{ ...myMapsDataPolicy, namespace: identity.dTag },
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
	return (type: string, data: Record<string, unknown>, signal: AbortSignal) => {
		if (type === 'storage.get' && data.key === 'saved') {
			signal.throwIfAborted()
			const pubkey = accounts.active?.pubkey ?? ''
			if (!migratedAccounts.has(pubkey)) {
				migrateMyMapsStorage(localStorage, identity, pubkey)
				migratedAccounts.add(pubkey)
			}
		}
		return request(type, data, signal)
	}
}
