/**
 * Wave-0 Nyquist RED baseline — pins the builder→draft-2020-12 compile contract (GROUP-03).
 * The visual field-rule builder (D-04) and the raw-JSON advanced tab both compile to the
 * SAME draft-2020-12 schema, fed to the Phase-8 hardened worker.
 *
 * RED-BASELINE: `@/features/groups/schemaBuilder` does not exist yet (extracted + extended
 * from `MapContextEditorPanel`'s SchemaBuilderField block — adds `enum` + geometry arg +
 * the `$schema` draft-2020-12 declaration the existing builder lacked).
 *
 *   - a builder row set + allowed geometry [Point] compiles to a draft-2020-12 object with
 *     properties.name + required:['name'].
 *   - an `enum` row with allowed values compiles to enum:['a','b'].
 *   - the compiled schema is accepted by the Phase-8 worker (does not fail-closed on a valid
 *     conforming instance).
 */

import { describe, expect, test } from 'bun:test'
import {
	type SchemaBuilderRow,
	type SchemaFieldType,
	compileBuilderSchema,
} from '@/features/groups/schemaBuilder'
import { runSchemaValidation } from '@/lib/validation/schema.worker'

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

describe('schemaBuilder — GROUP-03 builder→draft-2020-12 compile', () => {
	test('a row set + allowed geometry compiles to draft-2020-12 with required', () => {
		const rows: SchemaBuilderRow[] = [
			{ name: 'name', type: 'text' as SchemaFieldType, required: true },
			{ name: 'count', type: 'number' as SchemaFieldType },
		]
		const schema = compileBuilderSchema(rows, ['Point']) as Record<string, unknown>
		expect(schema.$schema).toBe(DRAFT_2020_12)
		const properties = schema.properties as Record<string, unknown>
		expect(properties.name).toBeDefined()
		expect(schema.required).toEqual(['name'])
	})

	test('an enum row compiles to enum:[...]', () => {
		const rows: SchemaBuilderRow[] = [
			{ name: 'tier', type: 'enum' as SchemaFieldType, allowedValues: ['a', 'b'] },
		]
		const schema = compileBuilderSchema(rows, ['Point']) as Record<string, unknown>
		const properties = schema.properties as Record<string, Record<string, unknown>>
		expect(properties.tier?.enum).toEqual(['a', 'b'])
	})
})

describe('schemaBuilder — GROUP-03 accepted by the Phase-8 worker', () => {
	test('the compiled schema validates a conforming instance (no fail-closed)', async () => {
		const rows: SchemaBuilderRow[] = [
			{ name: 'name', type: 'text' as SchemaFieldType, required: true },
		]
		const schema = compileBuilderSchema(rows, ['Point'])
		const verdict = await runSchemaValidation({
			schema,
			data: { name: 'ok' },
			schemaHash: 'sha256:builder',
		})
		expect(verdict.ok).toBe(true)
	})
})
