/**
 * Environment Configuration Schema
 *
 * Single source of truth for all environment variables.
 * Used by both build-time injection and runtime validation.
 */

import { z } from "zod";

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

  /** Primary relay WebSocket URL */
  RELAY_URL: z.string().default("wss://relay.wavefunc.live"),

  // ─────────────────────────────────────────────────────────────────────────
  // ContextVM / MCP Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /** Server private key for ContextVM MCP server (backend only) */
  SERVER_KEY: z.string().length(64).optional(),

  /** Public key of the ContextVM geo server (derived from SERVER_KEY) */
  SERVER_PUBKEY: z
    .string()
    .length(64)
    .default(
      "ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc"
    ),

  /** Client private key for ContextVM communication */
  CLIENT_KEY: z
    .string()
    .length(64)
    .default(
      "4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c"
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // App Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /** App private key for signing (backend only) */
  APP_PRIVATE_KEY: z.string().length(64).optional(),

  /** Runtime environment */
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

/** Inferred TypeScript type from the schema */
export type Env = z.infer<typeof envSchema>;

/**
 * List of environment variables that should be injected into the frontend bundle.
 * Backend-only variables (like private keys) are excluded.
 */
export const FRONTEND_ENV_KEYS = [
  "RELAY_URL",
  "SERVER_PUBKEY",
  "CLIENT_KEY",
  "NODE_ENV",
] as const;

export type FrontendEnvKey = (typeof FRONTEND_ENV_KEYS)[number];

/**
 * Parse and validate environment variables.
 * Returns validated config with defaults applied.
 *
 * @param env - Environment object (e.g., process.env)
 * @throws ZodError if validation fails
 */
export function parseEnv(env: Record<string, string | undefined>): Env {
  return envSchema.parse(env);
}

/**
 * Safely parse environment variables without throwing.
 * Returns success/error result.
 */
export function safeParseEnv(env: Record<string, string | undefined>) {
  return envSchema.safeParse(env);
}
