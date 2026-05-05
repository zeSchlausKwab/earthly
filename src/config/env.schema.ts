/**
 * Environment Configuration Schema
 *
 * Single source of truth for all environment variables.
 * Used by both build-time injection and runtime validation.
 */

import { z } from 'zod'

/**
 * Zod schema defining all environment variables with their types and defaults.
 *
 * Defaults are used when:
 * - Building without a .env file (dev mode)
 * - A variable is not explicitly set
 */
export const envSchema = z.object({
	// ─────────────────────────────────────────────────────────────────────────
	// Relay Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** Primary relay WebSocket URL(s). Comma-separated for multiple. */
	RELAY_URL: z
		.string()
		.default(
			process.env.NODE_ENV === 'production' ? 'wss://relay.earthly.city' : 'ws://localhost:3334',
		),

	/**
	 * Optional comma-separated list of read-only relays.
	 *
	 *   - In dev these are the ONLY way to subscribe to anything beyond
	 *     `localhost:3334`. Useful for fetching public profiles, NIP-65 mailboxes,
	 *     etc. without ever publishing to public relays.
	 *   - Outbox/inbox routing in `publish()` is unaffected — writes always go
	 *     to RELAY_URL only in dev.
	 */
	EXTRA_READ_RELAYS: z.string().default(''),

	// ─────────────────────────────────────────────────────────────────────────
	// ContextVM / MCP Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** Server private key for ContextVM MCP server (backend only) */
	SERVER_KEY: z.string().length(64).optional(),

	/** Public key of the ContextVM geo server (derived from SERVER_KEY) */
	SERVER_PUBKEY: z
		.string()
		.length(64)
		.default('ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc'),

	/** Client private key for ContextVM communication */
	CLIENT_KEY: z
		.string()
		.length(64)
		.default('4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c'),

	// ─────────────────────────────────────────────────────────────────────────
	// App Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** App private key for signing (backend only) */
	APP_PRIVATE_KEY: z.string().length(64).optional(),

	/** Blossom base URL used by the server when publishing map layer set announcements (backend only) */
	BLOSSOM_SERVER: z
		.string()
		.default(
			process.env.NODE_ENV === 'production'
				? 'https://blossom.earthly.city'
				: 'http://localhost:3544',
		),

	// ─────────────────────────────────────────────────────────────────────────
	// Web Search Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** SearXNG instance base URL for web search tool (backend only) */
	SEARXNG_URL: z.string().url().optional(),

	/** Valhalla API base URL for routing/isochrone tools (backend only) */
	VALHALLA_URL: z.string().url().optional(),

	/** Runtime environment */
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

/** Inferred TypeScript type from the schema */
export type Env = z.infer<typeof envSchema>

/**
 * List of environment variables that should be injected into the frontend bundle.
 * Backend-only variables (like private keys) are excluded.
 */
export const FRONTEND_ENV_KEYS = [
	'RELAY_URL',
	'EXTRA_READ_RELAYS',
	'SERVER_PUBKEY',
	'CLIENT_KEY',
	'BLOSSOM_SERVER',
	'NODE_ENV',
] as const

export type FrontendEnvKey = (typeof FRONTEND_ENV_KEYS)[number]

/**
 * Parse and validate environment variables.
 * Returns validated config with defaults applied.
 *
 * @param env - Environment object (e.g., process.env)
 * @throws ZodError if validation fails
 */
export function parseEnv(env: Record<string, string | undefined>): Env {
	return envSchema.parse(env)
}

/**
 * Safely parse environment variables without throwing.
 * Returns success/error result.
 */
export function safeParseEnv(env: Record<string, string | undefined>) {
	return envSchema.safeParse(env)
}
