/**
 * Pure builder → draft-2020-12 JSON-Schema compiler (GROUP-03 / D-04).
 *
 * The visual field-rule builder (stacked property rows + a geometry-type
 * checkbox set) and the raw-JSON "Advanced" tab both compile to the SAME
 * draft-2020-12 schema that the Phase-8 hardened off-thread worker validates.
 * This module is the slimmed successor to `MapContextEditorPanel`'s inline
 * `SchemaBuilderField` block (`schemaFromBuilder`/`builderFromSchema`) extended
 * with:
 *   - an `enum` field type (`allowedValues`),
 *   - an `allowedGeometryTypes` argument (encoded as a non-required
 *     `properties.geometry.properties.type.enum` so a conforming feature is
 *     constrained without forcing a `geometry` key onto every instance), and
 *   - the explicit `$schema` draft-2020-12 declaration the legacy builder lacked
 *     (it must match the Ajv2020 dialect the Phase-8 worker pins).
 *
 * It is intentionally PURE (no React, no Ajv) so it is unit-testable and reusable
 * by the Advanced tab's validate affordance. The output never emits `$ref`/`$data`
 * and stays well within the worker's 64KB / depth-12 / 4096-keyword caps.
 */

import type { GroupGeometryType } from '@/lib/nostr/group'

/** The draft-2020-12 dialect URI the Phase-8 worker's Ajv2020 instance pins. */
export const DRAFT_2020_12_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** Builder property-row field types (adds `enum` over the legacy string/number/integer/boolean). */
export type SchemaFieldType = 'text' | 'number' | 'integer' | 'boolean' | 'enum'

/** One visual builder property row. */
export interface SchemaBuilderRow {
	/** The property key. Blank rows are skipped at compile time. */
	name: string
	type: SchemaFieldType
	required?: boolean
	/** Allowed values for an `enum` row (ignored for other types). */
	allowedValues?: string[]
}

/** Map a builder field type to its draft-2020-12 property definition. */
function definitionForRow(row: SchemaBuilderRow): Record<string, unknown> {
	switch (row.type) {
		case 'text':
			return { type: 'string' }
		case 'number':
			return { type: 'number' }
		case 'integer':
			return { type: 'integer' }
		case 'boolean':
			return { type: 'boolean' }
		case 'enum':
			return { enum: [...(row.allowedValues ?? [])] }
	}
}

/**
 * Compile builder rows + allowed geometry types into a draft-2020-12 JSON Schema.
 *
 * - `$schema` is the draft-2020-12 URI (matches the worker's Ajv2020 dialect).
 * - Each non-blank row becomes a `properties[name]` definition; `text→string`,
 *   `number→number`, `integer→integer`, `boolean→boolean`, `enum→{enum:[...]}`.
 * - `required` is built from rows flagged required (geometry is NEVER required, so
 *   a feature without a `geometry.type` still validates).
 * - `allowedGeometryTypes` (when non-empty) is encoded as a non-required
 *   `properties.geometry` whose nested `type` is constrained to the allowed enum.
 * - `additionalProperties: true` preserves the legacy builder's open-world posture.
 *
 * Never emits `$ref`/`$data`; stays within the Phase-8 caps.
 */
export function compileBuilderSchema(
	rows: SchemaBuilderRow[],
	allowedGeometryTypes: GroupGeometryType[],
): Record<string, unknown> {
	const properties: Record<string, Record<string, unknown>> = {}
	const required: string[] = []

	for (const row of rows) {
		if (!row.name.trim()) continue
		properties[row.name] = definitionForRow(row)
		if (row.required) required.push(row.name)
	}

	if (allowedGeometryTypes.length > 0) {
		// Geometry is constrained but NOT required — an instance that omits geometry
		// still validates; one that carries a geometry must use an allowed type.
		properties.geometry = {
			type: 'object',
			properties: {
				type: { enum: [...allowedGeometryTypes] },
			},
		}
	}

	return {
		$schema: DRAFT_2020_12_DIALECT,
		type: 'object',
		properties,
		required,
		additionalProperties: true,
	}
}

/**
 * Inverse of {@link compileBuilderSchema}: decode a saved/round-tripped schema back
 * into builder rows (mirrors the legacy `builderFromSchema`, extended for `enum`).
 * The geometry constraint is decoded separately by {@link decodeAllowedGeometryTypes}.
 */
export function decodeBuilderSchema(schema: unknown): SchemaBuilderRow[] {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
	const record = schema as Record<string, unknown>
	const props = record.properties
	if (!props || typeof props !== 'object' || Array.isArray(props)) return []
	const requiredList = Array.isArray(record.required)
		? record.required.filter((entry): entry is string => typeof entry === 'string')
		: []

	return Object.entries(props as Record<string, unknown>).flatMap(([name, def]) => {
		// The synthetic geometry constraint is decoded separately, not as a row.
		if (name === 'geometry') return []
		if (!def || typeof def !== 'object' || Array.isArray(def)) return []
		const asRecord = def as Record<string, unknown>

		if (Array.isArray(asRecord.enum)) {
			return [
				{
					name,
					type: 'enum' as SchemaFieldType,
					required: requiredList.includes(name),
					allowedValues: asRecord.enum.map((value) => String(value)),
				},
			]
		}

		const jsonType = String(asRecord.type)
		const fieldType: SchemaFieldType | null =
			jsonType === 'string'
				? 'text'
				: jsonType === 'number'
					? 'number'
					: jsonType === 'integer'
						? 'integer'
						: jsonType === 'boolean'
							? 'boolean'
							: null
		if (!fieldType) return []
		return [{ name, type: fieldType, required: requiredList.includes(name) }]
	})
}

/** Decode the synthetic geometry constraint from a compiled schema back into the type list. */
export function decodeAllowedGeometryTypes(schema: unknown): GroupGeometryType[] {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
	const props = (schema as Record<string, unknown>).properties
	if (!props || typeof props !== 'object' || Array.isArray(props)) return []
	const geometry = (props as Record<string, unknown>).geometry
	if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return []
	const geometryProps = (geometry as Record<string, unknown>).properties
	if (!geometryProps || typeof geometryProps !== 'object' || Array.isArray(geometryProps)) return []
	const typeDef = (geometryProps as Record<string, unknown>).type
	if (!typeDef || typeof typeDef !== 'object' || Array.isArray(typeDef)) return []
	const enumValues = (typeDef as Record<string, unknown>).enum
	if (!Array.isArray(enumValues)) return []
	return enumValues.map((value) => String(value) as GroupGeometryType)
}
