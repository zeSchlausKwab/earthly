import { SEARCH_GRAMMAR_VERSION, type SearchCapability } from './types'

/**
 * Feature detection for the Earthly search extension: the relay serves a
 * capability document at GET /earthly-search (same host as the websocket).
 * Consumers strip extension tokens for relays that don't support the grammar
 * (see grammar.ts stripExtensions).
 */

const cache = new Map<string, SearchCapability | null>()

/** ws(s)://host[/path] → http(s)://host/earthly-search */
export function capabilityUrl(relayUrl: string): string | null {
	try {
		const url = new URL(relayUrl)
		if (url.protocol === 'wss:') url.protocol = 'https:'
		else if (url.protocol === 'ws:') url.protocol = 'http:'
		else return null
		url.pathname = '/earthly-search'
		url.search = ''
		return url.toString()
	} catch {
		return null
	}
}

/**
 * Fetch (and cache) the relay's search capability. Resolves null for relays
 * without the extension — callers then downgrade to plain NIP-50 text.
 */
export async function fetchSearchCapability(relayUrl: string): Promise<SearchCapability | null> {
	if (cache.has(relayUrl)) return cache.get(relayUrl) ?? null

	const url = capabilityUrl(relayUrl)
	if (!url) {
		cache.set(relayUrl, null)
		return null
	}

	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)
		const res = await fetch(url, { signal: controller.signal })
		clearTimeout(timeout)
		if (!res.ok) throw new Error(`http ${res.status}`)

		const doc = (await res.json()) as SearchCapability
		const capability = typeof doc.version === 'number' && Array.isArray(doc.extensions) ? doc : null
		cache.set(relayUrl, capability)
		return capability
	} catch {
		cache.set(relayUrl, null)
		return null
	}
}

/** True when the relay speaks (at least) our grammar version. */
export function supportsSearchExtensions(capability: SearchCapability | null): boolean {
	return capability !== null && capability.version >= SEARCH_GRAMMAR_VERSION
}

/** Test seam. */
export function clearCapabilityCache(): void {
	cache.clear()
}
