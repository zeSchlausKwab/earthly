/**
 * Wave-0 Nyquist RED baseline — pins the canonical schema-hash contract (O-03 / Pitfall 9).
 *
 * A published Group schema is hashed so author and viewer validate against the IDENTICAL
 * schema. `JSON.stringify` is key-order-dependent, so two semantically equal schemas with
 * different key insertion order would otherwise hash differently and silently diverge. The
 * hash MUST canonicalize (deep key-sort) before digesting.
 *
 * RED-BASELINE: `@/lib/group/schemaHash` does not exist yet (lands in a later Plan).
 *
 *   - canonicalizeSchema deep-sorts object keys so equal-but-reordered schemas canonicalize
 *     to the same structure.
 *   - computeSchemaHash returns a `sha256:`-prefixed digest; key order does NOT change it.
 *   - verifySchemaHash accepts the correct hash and rejects a mismatched one (never silently
 *     validate against a different schema).
 */

import { describe, expect, test } from 'bun:test'
import {
	canonicalizeSchema,
	computeSchemaHash,
	resolveSchemaCacheKey,
	verifySchemaHash,
} from '@/lib/group/schemaHash'

const schemaA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: {
		name: { type: 'string' },
		count: { type: 'number' },
	},
	required: ['name'],
}

// Identical content, DIFFERENT key insertion order at every object level.
const schemaB = {
	type: 'object',
	required: ['name'],
	properties: {
		count: { type: 'number' },
		name: { type: 'string' },
	},
	$schema: 'https://json-schema.org/draft/2020-12/schema',
}

describe('schemaHash — O-03 canonicalization (Pitfall 3)', () => {
	test('canonicalizeSchema deep-sorts keys so reordered-equal schemas match', () => {
		expect(JSON.stringify(canonicalizeSchema(schemaA))).toBe(
			JSON.stringify(canonicalizeSchema(schemaB)),
		)
	})

	test('key insertion order does NOT change the hash', async () => {
		const hashA = await computeSchemaHash(schemaA)
		const hashB = await computeSchemaHash(schemaB)
		expect(hashA).toBe(hashB)
	})

	test('the hash is prefixed sha256:', async () => {
		const hash = await computeSchemaHash(schemaA)
		expect(hash.startsWith('sha256:')).toBe(true)
	})
})

describe('schemaHash — O-03 verify (mismatch rejected)', () => {
	test('verifySchemaHash accepts the correct hash', async () => {
		const hash = await computeSchemaHash(schemaA)
		expect(await verifySchemaHash(schemaA, hash)).toBe(true)
	})

	test('verifySchemaHash rejects a mismatched hash', async () => {
		expect(await verifySchemaHash(schemaA, 'sha256:deadbeef')).toBe(false)
	})

	test('verifySchemaHash accepts a reordered-equal schema against the same hash', async () => {
		const hash = await computeSchemaHash(schemaA)
		expect(await verifySchemaHash(schemaB, hash)).toBe(true)
	})
})

describe('schemaHash — CR-02 cache key never collides on the no-hash path', () => {
	const schemaRequireName = {
		type: 'object',
		properties: { name: { type: 'string' } },
		required: ['name'],
	}
	const schemaRequireAge = {
		type: 'object',
		properties: { age: { type: 'number' } },
		required: ['age'],
	}

	test('prefers the published hash when present', async () => {
		expect(await resolveSchemaCacheKey(schemaRequireName, 'sha256:published')).toBe(
			'sha256:published',
		)
	})

	test('two DISTINCT unhashed schemas resolve to DIFFERENT keys', async () => {
		const keyA = await resolveSchemaCacheKey(schemaRequireName)
		const keyB = await resolveSchemaCacheKey(schemaRequireAge)
		expect(keyA).not.toBe(keyB)
	})

	test('never returns the shared `sha256:unhashed` sentinel', async () => {
		const key = await resolveSchemaCacheKey(schemaRequireName)
		expect(key).not.toBe('sha256:unhashed')
	})

	test('equal-but-reordered unhashed schemas resolve to the SAME key (content-derived)', async () => {
		const keyA = await resolveSchemaCacheKey(schemaA)
		const keyB = await resolveSchemaCacheKey(schemaB)
		expect(keyA).toBe(keyB)
	})
})
