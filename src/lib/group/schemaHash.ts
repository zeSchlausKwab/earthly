/**
 * Canonical schema-hash compute + verify (O-03 / Pitfall 3).
 *
 * A published Group schema is hashed so author and viewer validate against the
 * IDENTICAL schema. `JSON.stringify` is key-order-dependent, so two semantically
 * equal schemas with different key insertion order would otherwise hash differently
 * and silently diverge. We canonicalize (deep recursive key-sort) BEFORE digesting,
 * then reuse the existing SHA-256 `computeChecksum` (no new crypto, no validator).
 *
 * A `verifySchemaHash` mismatch returns `false` — the caller MUST treat false as
 * "do not validate, show a warning", never as a licence to silently validate against
 * a different schema.
 */

import { computeChecksum } from '@/lib/nostr/geo-event/helpers'

/** The `sha256:` prefix every Group schema-hash carries. */
const SCHEMA_HASH_PREFIX = 'sha256:'

/**
 * Deep, recursive, key-order-independent canonicalization. Arrays preserve order
 * (order is semantically meaningful in JSON Schema, e.g. `required`/`enum`) but every
 * object is rebuilt from its sorted keys so author and viewer serialize identically.
 */
export function canonicalizeSchema(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => canonicalizeSchema(item))
	}
	if (value && typeof value === 'object') {
		const source = value as Record<string, unknown>
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(source).sort()) {
			sorted[key] = canonicalizeSchema(source[key])
		}
		return sorted
	}
	return value
}

/**
 * Canonical SHA-256 of a schema, prefixed `sha256:`. Returns `undefined` when
 * `computeChecksum` is unavailable (no `crypto.subtle`) so callers can guard.
 */
export async function computeSchemaHash(schema: unknown): Promise<string | undefined> {
	const checksum = await computeChecksum(JSON.stringify(canonicalizeSchema(schema)))
	if (checksum === undefined) return undefined
	return `${SCHEMA_HASH_PREFIX}${checksum}`
}

/**
 * Recompute the canonical hash of `schema` and compare to `expected`. A mismatch (or an
 * unavailable digest) returns `false` — the caller treats false as "do not validate,
 * show a warning", never as "silently validate against a different schema" (Pitfall 3).
 */
export async function verifySchemaHash(schema: unknown, expected: string): Promise<boolean> {
	const actual = await computeSchemaHash(schema)
	if (actual === undefined) return false
	return actual === expected
}
