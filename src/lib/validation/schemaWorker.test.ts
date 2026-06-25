/**
 * Wave-0 Nyquist baseline — pins the off-thread schema-validation seam (`schemaWorker.ts`).
 *
 * SPEC-04 (T-8-04, untrusted-schema DoS): user-authored JSON Schemas are hostile
 * input. The validator runs off the main thread (Ajv-2020) with a hard timeout-kill,
 * fails closed, rejects `$ref`/`$dynamicRef` before compile, caps size/depth, and
 * keeps `$data` OFF. Under `bun test` there is no live `Worker`, so `validateSchema`
 * drives the SYNCHRONOUS fallback (mirrors quickjsWorker.ts:131 `typeof Worker ===
 * 'undefined'`), keeping the hardening proofs automated.
 *
 *   (a) a ReDoS `pattern`, a `$ref`/`$dynamicRef` schema, and an oversized/deep
 *       schema each resolve to a fail-closed "could not validate" verdict within the
 *       timeout + slack wall-clock budget (≤100ms in-engine + 500ms slack — see
 *       quickjsWorker.ts:40 WATCHDOG_SLACK_MS).
 *   (b) `$ref` is rejected BEFORE compile.
 *   (c) a valid schema compiled twice with the same `schemaHash` reuses the cached
 *       validator (compile invoked exactly once — observed via the module counter).
 *   (d) the `$data` keyword is OFF.
 *
 * RED-BASELINE: `@/lib/validation/schemaWorker` does not exist yet (lands in Plan 04).
 */

import { describe, expect, test } from 'bun:test'
import { __compileCount, __resetCompileCount, validateSchema } from '@/lib/validation/schemaWorker'

/** In-engine deadline (≤100ms) + watchdog slack (500ms, per quickjsWorker.ts:40). */
const WALL_CLOCK_BUDGET_MS = 100 + 500

const REDOS_SCHEMA = { type: 'string', pattern: '^(a+)+$' }
const REDOS_INPUT = `${'a'.repeat(40)}!`
const REF_SCHEMA = { $ref: 'https://evil.example/schema.json' }
const DYNAMIC_REF_SCHEMA = { $dynamicRef: '#node' }
const OVERSIZED_SCHEMA = buildDeepSchema(2000)

function buildDeepSchema(depth: number): Record<string, unknown> {
	let node: Record<string, unknown> = { type: 'object' }
	for (let i = 0; i < depth; i++) {
		node = { type: 'object', properties: { nested: node } }
	}
	return node
}

describe('schemaWorker.ts — SPEC-04 fail-closed within timeout (sync fallback)', () => {
	test('ReDoS pattern schema fails closed within the wall-clock budget', async () => {
		const start = performance.now()
		const verdict = await validateSchema(REDOS_SCHEMA, REDOS_INPUT, { schemaHash: 'redos-1' })
		const elapsed = performance.now() - start
		expect(verdict.ok).toBe(false)
		expect(elapsed).toBeLessThanOrEqual(WALL_CLOCK_BUDGET_MS)
	})

	test('oversized/deep schema fails closed within the wall-clock budget', async () => {
		const start = performance.now()
		const verdict = await validateSchema(OVERSIZED_SCHEMA, {}, { schemaHash: 'deep-1' })
		const elapsed = performance.now() - start
		expect(verdict.ok).toBe(false)
		expect(elapsed).toBeLessThanOrEqual(WALL_CLOCK_BUDGET_MS)
	})
})

describe('schemaWorker.ts — SPEC-04 $ref rejected before compile', () => {
	test('$ref schema fails closed', async () => {
		const verdict = await validateSchema(REF_SCHEMA, {}, { schemaHash: 'ref-1' })
		expect(verdict.ok).toBe(false)
	})

	test('$dynamicRef schema fails closed', async () => {
		const verdict = await validateSchema(DYNAMIC_REF_SCHEMA, {}, { schemaHash: 'dynref-1' })
		expect(verdict.ok).toBe(false)
	})

	test('$ref is rejected BEFORE compile (compile counter stays zero)', async () => {
		__resetCompileCount()
		await validateSchema(REF_SCHEMA, {}, { schemaHash: 'ref-2' })
		expect(__compileCount()).toBe(0)
	})
})

describe('schemaWorker.ts — SPEC-04 compile-once-per-schemaHash', () => {
	test('same schemaHash reuses the cached validator (compile invoked once)', async () => {
		__resetCompileCount()
		const schema = { type: 'object', properties: { n: { type: 'number' } } }
		await validateSchema(schema, { n: 1 }, { schemaHash: 'cache-1' })
		await validateSchema(schema, { n: 2 }, { schemaHash: 'cache-1' })
		expect(__compileCount()).toBe(1)
	})
})

describe('schemaWorker.ts — SPEC-04 $data keyword off', () => {
	test('$data reference does not enable cross-field validation', async () => {
		const schema = {
			type: 'object',
			properties: { a: { type: 'number' }, b: { type: 'number', maximum: { $data: '1/a' } } },
		}
		// With $data OFF, `{ $data: '1/a' }` is an invalid `maximum` value, so the schema
		// fails closed rather than silently enabling cross-field validation.
		const verdict = await validateSchema(schema, { a: 1, b: 5 }, { schemaHash: 'data-1' })
		expect(verdict.ok).toBe(false)
	})
})
