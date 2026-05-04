/**
 * Frontend Environment Configuration
 *
 * In production: values are baked in at build time by the bundler (`define`
 * replaces `process.env.X` with literals).
 * In development (HMR): falls back to localhost defaults.
 *
 * Relay routing rules (enforced in `src/lib/nostr/index.ts`):
 *
 *   - `writeRelays`  is where every `publish()` lands. In dev this is locked
 *      to the local relay so seed scripts and test posts can never leak.
 *   - `readRelays`   is what subscriptions/lookups query. = writeRelays +
 *      configured `RELAY_URL` + any `EXTRA_READ_RELAYS`. In local dev this
 *      keeps writes local while still allowing public reads.
 *   - `seedRelays`   is what seed scripts target. Identical to writeRelays so
 *      seeds always stay local.
 *
 * Outbox routing in dev is downgraded to `writeRelays` regardless of NIP-65 —
 * we never publish to a user's outbox set in dev, even when subscribing
 * broadly via `readRelays`.
 */

const DEV_DEFAULTS = {
	RELAY_URL: 'wss://relay.earthly.city',
	SERVER_PUBKEY: 'ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc',
	CLIENT_KEY: '4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c',
	BLOSSOM_SERVER: 'https://blossom.earthly.city',
} as const

const LOCAL_DEV_RELAY_URL = 'ws://localhost:3334'
const LOCAL_DEV_BLOSSOM_URL = 'http://localhost:3544'

function safeEnv<T>(getValue: () => T, fallback: T): T {
	try {
		const value = getValue()
		return value ?? fallback
	} catch {
		return fallback
	}
}

function parseRelayList(value: string): string[] {
	return value
		.split(',')
		.map((url) => url.trim())
		.filter(Boolean)
}

function getBrowserLocation(): Pick<Location, 'hostname' | 'protocol'> | null {
	try {
		if (typeof location === 'undefined') return null
		return { hostname: location.hostname, protocol: location.protocol }
	} catch {
		return null
	}
}

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '0.0.0.0' ||
		hostname === '::1' ||
		hostname === '[::1]'
	)
}

function isLoopbackRelayUrl(relayUrl: string): boolean {
	try {
		return isLoopbackHostname(new URL(relayUrl).hostname)
	} catch {
		return false
	}
}

function dedupe(list: string[]): string[] {
	return list.filter((value, index, arr) => arr.indexOf(value) === index)
}

/**
 * Build the WRITE relay set.
 *
 *   - Dev (running on localhost): hard-locked to `LOCAL_DEV_RELAY_URL`. Even
 *     if `RELAY_URL` is set to a public relay, dev never writes to it.
 *   - Dev (e.g. preview deploy not on localhost): uses `RELAY_URL` parsed.
 *   - Prod: uses `RELAY_URL` parsed (comma-separated allowed).
 */
function buildWriteRelays({
	relayUrl,
	isDevelopment,
}: {
	relayUrl: string
	isDevelopment: boolean
}): string[] {
	const locationInfo = getBrowserLocation()
	const isLocalOrigin = locationInfo ? isLoopbackHostname(locationInfo.hostname) : false
	const isHttps = locationInfo ? locationInfo.protocol === 'https:' : false

	if (isDevelopment && isLocalOrigin) {
		// Hard lock: in local dev we ONLY write to the local relay.
		return [LOCAL_DEV_RELAY_URL]
	}

	const candidates = parseRelayList(relayUrl)
	const filtered = candidates.filter((url) => {
		// Don't try to publish to ws:// from an https:// page (browser blocks it).
		if (isHttps && url.startsWith('ws://')) return false
		// Don't try to publish to a loopback relay from a non-local origin.
		if (!isLocalOrigin && isLoopbackRelayUrl(url)) return false
		return true
	})

	const deduped = dedupe(filtered)
	return deduped.length > 0 ? deduped : [DEV_DEFAULTS.RELAY_URL]
}

/**
 * Build the READ relay set. Always a superset of writeRelays.
 *
 *   - In dev, writes stay local but reads also include the configured
 *     `RELAY_URL` and `EXTRA_READ_RELAYS`. This lets the app cold-start from a
 *     public relay even when the local seed relay is not running.
 *   - In prod, `EXTRA_READ_RELAYS` extends the configured `RELAY_URL` set.
 *
 * Loopback URLs are filtered out unless we're on a local origin.
 */
function buildReadRelays({
	writeRelays,
	relayUrl,
	extraReadRelays,
}: {
	writeRelays: string[]
	relayUrl: string
	extraReadRelays: string
}): string[] {
	const locationInfo = getBrowserLocation()
	const isLocalOrigin = locationInfo ? isLoopbackHostname(locationInfo.hostname) : false
	const isHttps = locationInfo ? locationInfo.protocol === 'https:' : false

	const canReadRelay = (url: string) => {
		if (isHttps && url.startsWith('ws://')) return false
		if (!isLocalOrigin && isLoopbackRelayUrl(url)) return false
		return true
	}

	const configuredReads = parseRelayList(relayUrl).filter(canReadRelay)
	const extras = parseRelayList(extraReadRelays).filter(canReadRelay)

	return dedupe([...writeRelays, ...configuredReads, ...extras])
}

function buildBlossomServer({
	blossomServer,
	isDevelopment,
}: {
	blossomServer: string
	isDevelopment: boolean
}): string {
	const locationInfo = getBrowserLocation()
	const isLocalOrigin = locationInfo ? isLoopbackHostname(locationInfo.hostname) : false
	if (isDevelopment && isLocalOrigin) {
		return LOCAL_DEV_BLOSSOM_URL
	}
	return blossomServer
}

const relayUrl = safeEnv(() => process.env.RELAY_URL as string, DEV_DEFAULTS.RELAY_URL)
const extraReadRelays = safeEnv(() => process.env.EXTRA_READ_RELAYS as string, '')
const blossomServer = safeEnv(
	() => process.env.BLOSSOM_SERVER as string,
	DEV_DEFAULTS.BLOSSOM_SERVER,
)
const isProduction = safeEnv(() => process.env.NODE_ENV === 'production', false)
const isDevelopment = safeEnv(() => process.env.NODE_ENV !== 'production', true)

const writeRelays = buildWriteRelays({ relayUrl, isDevelopment })
const readRelays = buildReadRelays({ writeRelays, relayUrl, extraReadRelays })
// Seed scripts always target the write set — never the broader reads.
const seedRelays = writeRelays

export const config = {
	/** The raw RELAY_URL value (comma-separated allowed). */
	relayUrl,

	/** Public key of the ContextVM geo server */
	serverPubkey: safeEnv(() => process.env.SERVER_PUBKEY as string, DEV_DEFAULTS.SERVER_PUBKEY),

	/** Client private key for ContextVM communication */
	clientKey: safeEnv(() => process.env.CLIENT_KEY as string, DEV_DEFAULTS.CLIENT_KEY),

	/**
	 * Relays this client publishes to. In dev: locked to the local relay.
	 * In prod: the parsed RELAY_URL set.
	 */
	writeRelays,

	/**
	 * Relays this client subscribes to. Always a superset of writeRelays.
	 * In dev, public reads only happen if `EXTRA_READ_RELAYS` is set.
	 */
	readRelays,

	/** Relay set seed scripts target. Always equal to writeRelays. */
	seedRelays,

	/**
	 * Back-compat alias for `writeRelays` — the old name. Prefer `writeRelays`
	 * (or `readRelays` for subscriptions) in new code.
	 *
	 * @deprecated use `writeRelays` or `readRelays`
	 */
	relayUrls: writeRelays,

	/** Blossom server URL for fetching PMTiles chunks */
	blossomServer: buildBlossomServer({ blossomServer, isDevelopment }),

	/** Whether running in production mode */
	isProduction,

	/** Whether running in development mode */
	isDevelopment,
} as const

/** Type for the frontend config object */
export type ClientConfig = typeof config
