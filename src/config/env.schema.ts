/**
 * Environment Configuration Schema
 *
 * Single source of truth for all environment variables.
 * Used by both build-time injection and runtime validation.
 */

import { z } from 'zod'

export const DEFAULT_MAPNOLIA_TRUSTED_PUBKEY =
	'58f35635deac8768c0412484baab3462963053cf67384495bae29b114dec083f'

const publicKeyListSchema = z.string().refine(
	(value) => {
		const keys = value
			.split(',')
			.map((key) => key.trim())
			.filter(Boolean)
		return keys.length > 0 && keys.every((key) => /^[0-9a-f]{64}$/u.test(key))
	},
	{ message: 'must contain one or more comma-separated lowercase hexadecimal public keys' },
)

const optionalPublicKeyListSchema = z.string().refine(
	(value) =>
		value
			.split(',')
			.map((key) => key.trim())
			.filter(Boolean)
			.every((key) => /^[0-9a-f]{64}$/u.test(key)),
	{ message: 'must contain comma-separated lowercase hexadecimal public keys' },
)

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

	/** Public key of the Cordn-compatible private-map coordinator */
	CORDN_SERVER_PUBKEY: z.union([z.string().length(64), z.literal('')]).default(''),

	// ─────────────────────────────────────────────────────────────────────────
	// App Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** App private key for signing (backend only) */
	APP_PRIVATE_KEY: z.string().length(64).optional(),

	/**
	 * Trusted public origin for server-rendered canonical and Open Graph URLs.
	 * This is intentionally backend-only: it prevents reverse-proxy Host/protocol
	 * details from leaking into public share metadata.
	 */
	PUBLIC_BASE_URL: z
		.string()
		.url()
		.refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
			message: 'must use http or https',
		})
		.default('https://earthly.city'),

	/** Blossom base URL used by the server when publishing map layer set announcements (backend only) */
	BLOSSOM_SERVER: z
		.string()
		.default(
			process.env.NODE_ENV === 'production'
				? 'https://blossom.earthly.city'
				: 'http://localhost:3544',
		),

	/** Trusted kind-34444 Mapnolia announcement authors, never signing credentials. */
	MAPNOLIA_TRUSTED_PUBKEYS: publicKeyListSchema.default(DEFAULT_MAPNOLIA_TRUSTED_PUBKEY),

	/**
	 * Curated authors whose public maps appear in Discover. Empty is intentional
	 * for local development, where the UI may fall back to local relay content.
	 * In production, an empty list fails closed and promotes no public content.
	 */
	DISCOVERY_FEATURED_PUBKEYS: optionalPublicKeyListSchema.default(''),

	// ─────────────────────────────────────────────────────────────────────────
	// Web Search Configuration
	// ─────────────────────────────────────────────────────────────────────────

	/** SearXNG instance base URL for web search tool (backend only) */
	SEARXNG_URL: z.string().url().optional(),

	/** Valhalla API base URL for routing/isochrone tools (backend only) */
	VALHALLA_URL: z.string().url().optional(),

	/** Read-only GeoCatalog SQLite snapshot used by the ContextVM server (backend only) */
	GEOCATALOG_PATH: z.string().min(1).default('./data/geocatalog/current.sqlite'),

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
	'CORDN_SERVER_PUBKEY',
	'BLOSSOM_SERVER',
	'MAPNOLIA_TRUSTED_PUBKEYS',
	'DISCOVERY_FEATURED_PUBKEYS',
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
