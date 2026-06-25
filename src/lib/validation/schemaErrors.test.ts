/**
 * Wave-0 Nyquist RED baseline — pins the D-06 / A3 decision: the OFF-THREAD worker
 * verdict is EXTENDED to carry structured per-rule errors (option a), rather than an
 * in-thread display-only re-validate.
 *
 * The Phase-8 worker (`schema.worker.ts`) currently returns only `{ ok, error? }` and
 * discards `validate.errors`. Phase 9's validation-warning UX (D-06) must list exactly
 * which rules failed ("property `name` required") with a "Publish anyway" path. To keep
 * the DoS-safe gating off-thread (Pitfall 1 — no in-thread `ajv.compile`), the worker
 * verdict must itself carry an `errors: SchemaRuleError[]` array on failure.
 *
 * RED-BASELINE: `SchemaRuleError` and the `errors` field do not exist on the verdict yet.
 * This file imports the not-yet-exported `SchemaRuleError` type and asserts the extended
 * shape — it is EXPECTED to fail RED until the worker is extended.
 *
 *   - On FAIL the verdict carries a non-empty `errors[]`, each item exposing a human
 *     `message` plus `instancePath`/`keyword` so the UI can render per-rule reasons.
 *   - The "required `name`" failure surfaces a `required` keyword error mentioning `name`.
 *   - On PASS, `ok === true` and `errors` is absent or empty.
 */

import { describe, expect, test } from 'bun:test'
import { type SchemaRuleError, runSchemaValidation } from '@/lib/validation/schema.worker'

const requireNameSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: { name: { type: 'string' } },
	required: ['name'],
}

describe('schema.worker — D-06 structured errors on failure (EXTEND-worker)', () => {
	test('a failing validation carries a non-empty errors[] of SchemaRuleError', async () => {
		const verdict = await runSchemaValidation({
			schema: requireNameSchema,
			data: {}, // missing required `name`
			schemaHash: 'sha256:require-name',
		})
		expect(verdict.ok).toBe(false)
		const errors = verdict.errors as SchemaRuleError[] | undefined
		expect(Array.isArray(errors)).toBe(true)
		expect((errors ?? []).length).toBeGreaterThan(0)
	})

	test('each error exposes message + instancePath + keyword for per-rule UI', async () => {
		const verdict = await runSchemaValidation({
			schema: requireNameSchema,
			data: {},
			schemaHash: 'sha256:require-name',
		})
		const errors = (verdict.errors ?? []) as SchemaRuleError[]
		const first = errors[0]
		expect(typeof first?.message).toBe('string')
		expect(first?.message.length).toBeGreaterThan(0)
		expect(typeof first?.instancePath).toBe('string')
		expect(typeof first?.keyword).toBe('string')
	})

	test('the required-name failure mentions name and the required keyword', async () => {
		const verdict = await runSchemaValidation({
			schema: requireNameSchema,
			data: {},
			schemaHash: 'sha256:require-name',
		})
		const errors = (verdict.errors ?? []) as SchemaRuleError[]
		const blob = JSON.stringify(errors)
		expect(blob).toContain('name')
		expect(errors.some((e) => e.keyword === 'required')).toBe(true)
	})
})

describe('schema.worker — D-06 clean verdict on pass', () => {
	test('a passing validation reports ok with no errors', async () => {
		const verdict = await runSchemaValidation({
			schema: requireNameSchema,
			data: { name: 'ok' },
			schemaHash: 'sha256:require-name',
		})
		expect(verdict.ok).toBe(true)
		expect(verdict.errors === undefined || verdict.errors.length === 0).toBe(true)
	})
})
