/**
 * Backend Environment Configuration
 *
 * Validates and provides access to environment variables at runtime.
 * Use this in server-side code (src/index.ts, contextvm/server.ts, etc.)
 */

import { type Env, parseEnv } from './env.schema'

/**
 * Validated server environment configuration.
 * Throws on startup if required variables are missing or invalid.
 */
export const serverEnv: Env = parseEnv(process.env)

/**
 * Server configuration object with convenient property names.
 */
export const serverConfig = {
	/** Primary relay WebSocket URL */
	relayUrl: serverEnv.RELAY_URL,

	/** Server private key for ContextVM MCP server */
	serverKey: serverEnv.SERVER_KEY,

	/** Public key of the ContextVM geo server */
	serverPubkey: serverEnv.SERVER_PUBKEY,

	/** Public key of the Cordn-compatible private-map coordinator */
	cordnServerPubkey: serverEnv.CORDN_SERVER_PUBKEY,

	/** App private key for signing */
	appPrivateKey: serverEnv.APP_PRIVATE_KEY,

	/** Trusted public origin for canonical and Open Graph URLs */
	publicBaseUrl: serverEnv.PUBLIC_BASE_URL.replace(/\/+$/u, ''),

	/** Blossom base URL used by the server when publishing map layer set announcements */
	blossomServer: serverEnv.BLOSSOM_SERVER,

	/** Curated public authors whose maps are eligible for Discover. */
	discoveryFeaturedPubkeys: Array.from(
		new Set(
			serverEnv.DISCOVERY_FEATURED_PUBKEYS.split(',')
				.map((pubkey) => pubkey.trim())
				.filter(Boolean),
		),
	),

	/** SearXNG base URL for web search */
	searxngUrl: serverEnv.SEARXNG_URL,

	/** Valhalla API base URL for routing/isochrone tools */
	valhallaUrl: serverEnv.VALHALLA_URL,

	/** Read-only local geography catalog snapshot */
	geoCatalogPath: serverEnv.GEOCATALOG_PATH,

	/** Whether running in production mode */
	isProduction: serverEnv.NODE_ENV === 'production',

	/** Whether running in development mode */
	isDevelopment: serverEnv.NODE_ENV === 'development',

	/** Current environment name */
	nodeEnv: serverEnv.NODE_ENV,
} as const

export type ServerConfig = typeof serverConfig
