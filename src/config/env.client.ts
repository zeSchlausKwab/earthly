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
	RELAY_URL: 'wss://relay.wavefunc.live',
	SERVER_PUBKEY: 'ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc',
	CLIENT_KEY: '4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c',
} as const

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

/**
 * Frontend configuration object.
 * Production: baked in at build time via bundler's define.
 * Development: uses localhost defaults.
 *
 * IMPORTANT: Each process.env.X must be a static access for bundler replacement to work.
 */
export const config = {
	/** Primary relay WebSocket URL */
	relayUrl: safeEnv(() => process.env.RELAY_URL as string, DEV_DEFAULTS.RELAY_URL),

	/** Public key of the ContextVM geo server */
	serverPubkey: safeEnv(() => process.env.SERVER_PUBKEY as string, DEV_DEFAULTS.SERVER_PUBKEY),

	/** Client private key for ContextVM communication */
	clientKey: safeEnv(() => process.env.CLIENT_KEY as string, DEV_DEFAULTS.CLIENT_KEY),

	/** Whether running in production mode */
	isProduction: safeEnv(() => process.env.NODE_ENV === 'production', false),

	/** Whether running in development mode */
	isDevelopment: safeEnv(() => process.env.NODE_ENV !== 'production', true),
} as const

/** Type for the frontend config object */
export type ClientConfig = typeof config
