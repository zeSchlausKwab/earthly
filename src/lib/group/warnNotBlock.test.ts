/**
 * Wave-0 Nyquist RED baseline — pins the GROUP-04 HARD INVARIANT: validation WARNS but
 * NEVER BLOCKS a valid standalone publish. A schema Group whose schema rejects a dataset's
 * properties yields a non-blocking verdict (warnings) with a clear "publish anyway" path;
 * the publish-decision function returns true regardless of the validation verdict.
 *
 * RED-BASELINE: the attach-validation entrypoint + `canPublishStandalone` do not exist yet
 * (land in a later Plan). Imported from `@/lib/group`.
 *
 *   - validateAttachment(...) on a non-conforming dataset returns { ok:false, errors:[...] }
 *     (warnings), NOT a thrown error or a block flag.
 *   - canPublishStandalone(verdict) === true even when verdict.ok === false (warn-not-block).
 *   - canPublishStandalone is true for a conforming verdict too.
 */

import { describe, expect, test } from 'bun:test'
import { canPublishStandalone, validateAttachment } from '@/lib/group'

const requireNameSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: { name: { type: 'string' } },
	required: ['name'],
}

describe('group — GROUP-04 warn-not-block invariant', () => {
	test('a non-conforming attachment yields a non-blocking warning verdict', async () => {
		const verdict = await validateAttachment(requireNameSchema, {}, { schemaHash: 'sha256:rn' })
		expect(verdict.ok).toBe(false)
		expect(Array.isArray(verdict.errors)).toBe(true)
		expect((verdict.errors ?? []).length).toBeGreaterThan(0)
	})

	test('canPublishStandalone is true even when the verdict fails (warn-not-block)', async () => {
		const verdict = await validateAttachment(requireNameSchema, {}, { schemaHash: 'sha256:rn' })
		expect(canPublishStandalone(verdict)).toBe(true)
	})

	test('canPublishStandalone is true for a conforming verdict too', async () => {
		const verdict = await validateAttachment(
			requireNameSchema,
			{ name: 'ok' },
			{ schemaHash: 'sha256:rn' },
		)
		expect(verdict.ok).toBe(true)
		expect(canPublishStandalone(verdict)).toBe(true)
	})
})
