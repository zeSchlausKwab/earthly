/**
 * Frontend Environment Configuration
 *
 * In production: Values are injected at build time by the bundler.
 * In development: Falls back to defaults (process.env doesn't exist in browser).
 *
 * Import this via `@/config` or `./config` in frontend code.
 */

// Development defaults (used when process.env is not available)
const DEV_DEFAULTS = {
	RELAY_URL: 'wss://relay.earthly.city',
	SERVER_PUBKEY: 'ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc',
	CLIENT_KEY: '4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c',
	BLOSSOM_SERVER: 'https://blossom.earthly.city',
} as const

const LOCAL_DEV_RELAY_URL = 'ws://localhost:3334'
const LOCAL_DEV_BLOSSOM_URL = 'http://localhost:3544'

/**
 * Safely access process.env with fallback.
 * The bundler replaces process.env.X with literal strings in production.
 * In dev mode (HMR), process doesn't exist, so we catch and use defaults.
 */
function safeEnv<T>(getValue: () => T, fallback: T): T {
	try {
		const value = getValue()
		// In production, bundler replaces with string literal, so value is defined
		// In dev, process.env doesn't exist, throws, caught below
		return value ?? fallback
	} catch {
		return fallback
	}
}

function parseRelayUrls(relayUrl: string): string[] {
	return relayUrl
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

function buildRelayUrls({
	relayUrl,
	isDevelopment,
}: {
	relayUrl: string
	isDevelopment: boolean
}): string[] {
	const locationInfo = getBrowserLocation()
	const isLocalOrigin = locationInfo ? isLoopbackHostname(locationInfo.hostname) : false
	const isHttps = locationInfo ? locationInfo.protocol === 'https:' : false

	const candidates = [
		...(isDevelopment && isLocalOrigin ? [LOCAL_DEV_RELAY_URL] : []),
		...parseRelayUrls(relayUrl),
	]

	const filtered = candidates.filter((url) => {
		if (isHttps && url.startsWith('ws://')) return false
		if (!isLocalOrigin && isLoopbackRelayUrl(url)) return false
		return true
	})

	const deduped = filtered.filter((url, index, self) => self.indexOf(url) === index)
	return deduped.length > 0 ? deduped : [DEV_DEFAULTS.RELAY_URL]
}

/**
 * Frontend configuration object.
 * Production: baked in at build time via bundler's define.
 * Development: uses localhost defaults.
 *
 * IMPORTANT: Each process.env.X must be a static access for bundler replacement to work.
 */
const relayUrl = safeEnv(() => process.env.RELAY_URL as string, DEV_DEFAULTS.RELAY_URL)
const blossomServer = safeEnv(
	() => process.env.BLOSSOM_SERVER as string,
	DEV_DEFAULTS.BLOSSOM_SERVER,
)
const isProduction = safeEnv(() => process.env.NODE_ENV === 'production', false)
const isDevelopment = safeEnv(() => process.env.NODE_ENV !== 'production', true)

function buildBlossomServer({
	blossomServer,
	isDevelopment,
}: {
	blossomServer: string
	isDevelopment: boolean
}): string {
	const locationInfo = getBrowserLocation()
	const isLocalOrigin = locationInfo ? isLoopbackHostname(locationInfo.hostname) : false
	// Use local blossom in development when running on localhost
	if (isDevelopment && isLocalOrigin) {
		return LOCAL_DEV_BLOSSOM_URL
	}
	return blossomServer
}

export const config = {
	/** Primary relay WebSocket URL */
	relayUrl,

	/** Public key of the ContextVM geo server */
	serverPubkey: safeEnv(() => process.env.SERVER_PUBKEY as string, DEV_DEFAULTS.SERVER_PUBKEY),

	/** Client private key for ContextVM communication */
	clientKey: safeEnv(() => process.env.CLIENT_KEY as string, DEV_DEFAULTS.CLIENT_KEY),

	/** Relay URLs to use (sanitized for the current runtime) */
	relayUrls: buildRelayUrls({ relayUrl, isDevelopment }),

	/** Blossom server URL for fetching PMTiles chunks */
	blossomServer: buildBlossomServer({ blossomServer, isDevelopment }),

	/** Whether running in production mode */
	isProduction,

	/** Whether running in development mode */
	isDevelopment,
} as const

/** Type for the frontend config object */
export type ClientConfig = typeof config
