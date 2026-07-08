import type { NostrEvent } from 'nostr-tools'
import { firstValueFrom, timeout, toArray } from 'rxjs'
import { pool, readRelaysFor } from '@/lib/nostr'
import { isExpired } from '@/lib/nostr/expiry'
import { buildSearchString } from './grammar'
import type { SearchQuery } from './types'

/**
 * One-shot relay entity search (promise-based, for non-React callers: AI
 * tool handlers, the mention picker's suggestion source, scripts).
 *
 * Serializes the query through the grammar facade, requests once from the
 * content relays (completes on EOSE), dedupes by event id, and drops
 * NIP-40-expired events per SPEC §10.
 */
export async function searchEntityEvents(
	query: SearchQuery,
	opts: { kinds: number[]; limit?: number; timeoutMs?: number },
): Promise<NostrEvent[]> {
	const search = buildSearchString(query)
	if (!search) return []

	const filter = { kinds: opts.kinds, search, limit: opts.limit ?? 20 }
	const events = await firstValueFrom(
		pool
			.request(readRelaysFor('content'), filter)
			.pipe(toArray(), timeout(opts.timeoutMs ?? 10_000)),
	)

	const now = Math.floor(Date.now() / 1000)
	const seen = new Set<string>()
	const out: NostrEvent[] = []
	for (const event of events as NostrEvent[]) {
		if (seen.has(event.id)) continue
		seen.add(event.id)
		if (isExpired(event, now)) continue
		out.push(event)
	}
	return out
}
