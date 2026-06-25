/**
 * Wave-0 Nyquist RED baseline — pins the off/warn/strict foreign-lane filter (GROUP-05).
 * Drives the Phase-8 off-thread worker (synchronous pure-engine fallback under bun test).
 *
 * RED-BASELINE: `@/lib/group/filterModes` does not exist yet (rewrite of the deprecated
 * `context/validation.ts` mode resolvers).
 *
 *   - resolveGroupFilterDefault('schema') === 'strict', ('open') === 'off',
 *     ('closed') yields no foreign lane (null).
 *   - 'strict': a non-conforming attachment is HIDDEN and carries a legible reason.
 *   - 'warn': a non-conforming attachment is SHOWN WITH a reason/badge.
 *   - 'off': everything is shown.
 */

import { describe, expect, test } from 'bun:test'
import {
	type GroupFilterMode,
	filterForeignAttachment,
	resolveGroupFilterDefault,
} from '@/lib/group/filterModes'

const requireNameSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: { name: { type: 'string' } },
	required: ['name'],
}

const conforming = { name: 'ok' }
const nonConforming = {} // missing required `name`
const HASH = 'sha256:rn'

describe('filterModes — GROUP-05 default mode per governance', () => {
	test('schema defaults to strict', () => {
		expect(resolveGroupFilterDefault('schema')).toBe('strict')
	})

	test('open defaults to off', () => {
		expect(resolveGroupFilterDefault('open')).toBe('off')
	})

	test('closed yields no foreign lane', () => {
		expect(resolveGroupFilterDefault('closed')).toBeNull()
	})
})

describe('filterModes — GROUP-05 strict hides non-conforming with a reason', () => {
	test('strict hides a non-conforming attachment and carries a legible reason', async () => {
		const verdict = await filterForeignAttachment(
			'strict' as GroupFilterMode,
			requireNameSchema,
			nonConforming,
			{ schemaHash: HASH },
		)
		expect(verdict.show).toBe(false)
		expect(typeof verdict.reason).toBe('string')
		expect((verdict.reason ?? '').length).toBeGreaterThan(0)
	})

	test('strict shows a conforming attachment', async () => {
		const verdict = await filterForeignAttachment(
			'strict' as GroupFilterMode,
			requireNameSchema,
			conforming,
			{ schemaHash: HASH },
		)
		expect(verdict.show).toBe(true)
	})
})

describe('filterModes — GROUP-05 warn shows non-conforming with a reason/badge', () => {
	test('warn shows a non-conforming attachment WITH a reason', async () => {
		const verdict = await filterForeignAttachment(
			'warn' as GroupFilterMode,
			requireNameSchema,
			nonConforming,
			{ schemaHash: HASH },
		)
		expect(verdict.show).toBe(true)
		expect(typeof verdict.reason).toBe('string')
		expect((verdict.reason ?? '').length).toBeGreaterThan(0)
	})
})

describe('filterModes — GROUP-05 off shows everything', () => {
	test('off shows a non-conforming attachment without a blocking reason', async () => {
		const verdict = await filterForeignAttachment(
			'off' as GroupFilterMode,
			requireNameSchema,
			nonConforming,
			{ schemaHash: HASH },
		)
		expect(verdict.show).toBe(true)
	})
})

describe('filterModes — CR-02 unhashed schemas do not collide on the compile cache', () => {
	// Two DISTINCT schemas, NEITHER carrying an explicit `schemaHash`. Before the fix both
	// keyed the compile cache under `'sha256:unhashed'`, so the SECOND schema validated
	// against the FIRST's compiled validator. We prove each validates against its OWN schema.
	const requireAgeSchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		properties: { age: { type: 'number' } },
		required: ['age'],
	}

	test('a property valid under schema B but invalid under schema A is gated per-schema', async () => {
		// `{ age: 1 }` is missing `name` (fails requireNameSchema) but satisfies requireAgeSchema.
		const underNameSchema = await filterForeignAttachment(
			'strict' as GroupFilterMode,
			requireNameSchema,
			{ age: 1 },
		)
		const underAgeSchema = await filterForeignAttachment(
			'strict' as GroupFilterMode,
			requireAgeSchema,
			{ age: 1 },
		)
		// If the cache key collided, the second call would reuse the first compiled validator
		// (requireNameSchema) and HIDE `{ age: 1 }`. With content-derived keys it is shown.
		expect(underNameSchema.show).toBe(false)
		expect(underAgeSchema.show).toBe(true)
	})
})
