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

	/** Client private key for ContextVM communication */
	clientKey: serverEnv.CLIENT_KEY,

	/** App private key for signing */
	appPrivateKey: serverEnv.APP_PRIVATE_KEY,

	/** Blossom base URL used by the server when publishing map layer set announcements */
	blossomServer: serverEnv.BLOSSOM_SERVER,

	/** Whether running in production mode */
	isProduction: serverEnv.NODE_ENV === 'production',

	/** Whether running in development mode */
	isDevelopment: serverEnv.NODE_ENV === 'development',

	/** Current environment name */
	nodeEnv: serverEnv.NODE_ENV,
} as const

export type ServerConfig = typeof serverConfig
