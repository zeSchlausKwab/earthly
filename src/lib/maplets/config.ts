/** NAP-CONFIG Core Subset. Validation is interpreted; schemas never execute code. */
export interface MapletConfigSchema {
	type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
	properties?: Record<string, MapletConfigSchema>
	required?: readonly string[]
	items?: MapletConfigSchema
	additionalProperties?: boolean
	default?: unknown
	title?: string
	description?: string
	enum?: readonly unknown[]
	minimum?: number
	maximum?: number
	minLength?: number
	maxLength?: number
	minItems?: number
	maxItems?: number
	[key: string]: unknown
}

export interface MapletIdentity {
	dTag: string
	aggregateHash: string
}

export class MapletConfigError extends Error {
	constructor(
		message: string,
		public code = 'invalid-schema',
	) {
		super(message)
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Reject non-JSON data, prototype keys, excessive depth, and oversized payloads. */
export function boundedJson(value: unknown, maxChars = 64 * 1024, maxDepth = 8): unknown {
	let nodes = 0
	function visit(item: unknown, depth: number): void {
		if (++nodes > 20_000 || depth > maxDepth) throw new Error('Data exceeds complexity limit')
		if (item === null || typeof item === 'boolean') return
		if (typeof item === 'string') {
			if (item.length > maxChars) throw new Error('Text exceeds size limit')
			return
		}
		if (typeof item === 'number' && Number.isFinite(item)) return
		if (Array.isArray(item)) {
			for (const child of item) visit(child, depth + 1)
			return
		}
		if (
			isRecord(item) &&
			(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
		) {
			for (const [key, child] of Object.entries(item)) {
				if (BAD_KEYS.has(key)) throw new Error('Unsafe property name')
				visit(child, depth + 1)
			}
			return
		}
		throw new Error('Data must contain only JSON values')
	}
	visit(value, 0)
	const json = JSON.stringify(value)
	if (json.length > maxChars) throw new Error('Data exceeds size limit')
	return JSON.parse(json)
}

const KEYWORDS = new Set([
	'type',
	'properties',
	'required',
	'items',
	'additionalProperties',
	'default',
	'title',
	'description',
	'enum',
	'enumDescriptions',
	'minimum',
	'maximum',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'$schema',
	'$version',
	'format',
	'markdownDescription',
	'deprecationMessage',
])

export function validateMapletConfigSchema(input: unknown): MapletConfigSchema {
	const schema = boundedJson(input) as MapletConfigSchema
	let fields = 0
	function check(node: MapletConfigSchema, depth: number): void {
		if (!isRecord(node) || depth > 4 || ++fields > 128)
			throw new MapletConfigError('Schema is too complex')
		if ('$ref' in node)
			throw new MapletConfigError('Schema references are forbidden', 'ref-not-allowed')
		if ('pattern' in node)
			throw new MapletConfigError('Schema patterns are forbidden', 'pattern-not-allowed')
		for (const key of Object.keys(node)) {
			if (!KEYWORDS.has(key) && !key.startsWith('x-napplet-'))
				throw new MapletConfigError(`Unsupported schema keyword: ${key}`)
		}
		if (!['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(node.type))
			throw new MapletConfigError('Unsupported schema type')
		for (const key of [
			'title',
			'description',
			'format',
			'markdownDescription',
			'deprecationMessage',
		]) {
			if (node[key] !== undefined && typeof node[key] !== 'string')
				throw new MapletConfigError(`${key} must be text`)
		}
		if (
			node.enumDescriptions !== undefined &&
			(!Array.isArray(node.enumDescriptions) ||
				node.enumDescriptions.some((value) => typeof value !== 'string'))
		)
			throw new MapletConfigError('Enum descriptions must be text')
		if (
			node.$version !== undefined &&
			(!Number.isSafeInteger(node.$version) || Number(node.$version) < 0)
		)
			throw new MapletConfigError('Schema version must be a non-negative integer')
		if (node['x-napplet-secret'] === true && 'default' in node)
			throw new MapletConfigError('Secrets cannot declare defaults', 'secret-with-default')
		if (
			node.$schema !== undefined &&
			![
				'http://json-schema.org/draft-07/schema#',
				'https://json-schema.org/draft/2019-09/schema',
				'https://json-schema.org/draft/2020-12/schema',
			].includes(String(node.$schema))
		)
			throw new MapletConfigError('Unsupported schema draft', 'unsupported-draft')
		for (const key of [
			'minimum',
			'maximum',
			'minLength',
			'maxLength',
			'minItems',
			'maxItems',
		] as const) {
			if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key])))
				throw new MapletConfigError(`Invalid ${key}`)
		}
		for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
			if (node[key] !== undefined && (!Number.isSafeInteger(node[key]) || Number(node[key]) < 0))
				throw new MapletConfigError(`Invalid ${key}`)
		}
		for (const [min, max] of [
			['minimum', 'maximum'],
			['minLength', 'maxLength'],
			['minItems', 'maxItems'],
		] as const) {
			if (
				node[min] !== undefined &&
				node[max] !== undefined &&
				Number(node[min]) > Number(node[max])
			)
				throw new MapletConfigError(`${min} exceeds ${max}`)
		}
		if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length > 100))
			throw new MapletConfigError('Invalid enum')
		if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean')
			throw new MapletConfigError('additionalProperties must be boolean')
		if (
			node.required !== undefined &&
			(!Array.isArray(node.required) || node.required.some((key) => typeof key !== 'string'))
		)
			throw new MapletConfigError('Invalid required fields')
		if (node.type === 'object') {
			if (!isRecord(node.properties))
				throw new MapletConfigError('Object schemas require properties')
			for (const child of Object.values(node.properties)) check(child, depth + 1)
			if (node.required?.some((key) => !Object.hasOwn(node.properties ?? {}, key)))
				throw new MapletConfigError('Required field is undeclared')
		}
		if (node.type === 'array') {
			if (!isRecord(node.items) || node.items.type === 'object' || node.items.type === 'array')
				throw new MapletConfigError('Arrays must have primitive items')
			check(node.items as MapletConfigSchema, depth + 1)
		}
		if ('default' in node && !validValue(node, node.default))
			throw new MapletConfigError('Default does not match schema')
	}
	if (schema?.type !== 'object') throw new MapletConfigError('Schema root must be an object')
	check(schema, 0)
	return schema
}

function validValue(schema: MapletConfigSchema, value: unknown): boolean {
	if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)))
		return false
	switch (schema.type) {
		case 'string':
			return (
				typeof value === 'string' &&
				value.length >= (schema.minLength ?? 0) &&
				value.length <= (schema.maxLength ?? 16_384)
			)
		case 'number':
		case 'integer':
			return (
				typeof value === 'number' &&
				Number.isFinite(value) &&
				(schema.type !== 'integer' || Number.isInteger(value)) &&
				value >= (schema.minimum ?? -Infinity) &&
				value <= (schema.maximum ?? Infinity)
			)
		case 'boolean':
			return typeof value === 'boolean'
		case 'array':
			return (
				Array.isArray(value) &&
				value.length >= (schema.minItems ?? 0) &&
				value.length <= Math.min(schema.maxItems ?? 1000, 1000) &&
				!!schema.items &&
				value.every((item) => validValue(schema.items as MapletConfigSchema, item))
			)
		case 'object':
			return (
				isRecord(value) &&
				(schema.required ?? []).every((key) => Object.hasOwn(value, key)) &&
				Object.entries(value).every(([key, item]) =>
					schema.properties?.[key]
						? validValue(schema.properties[key], item)
						: schema.additionalProperties === true,
				)
			)
	}
}

/** NAP precedence: valid persisted value, property default, ancestor default, then absent. */
export function normalizeMapletConfig(
	schema: MapletConfigSchema | undefined,
	input: unknown,
): Record<string, unknown> {
	if (!schema) return {}
	const values = isRecord(input) ? (boundedJson(input) as Record<string, unknown>) : {}
	function resolve(node: MapletConfigSchema, candidate: unknown, ancestor: unknown): unknown {
		if (node.type !== 'object') {
			for (const value of [candidate, node.default, ancestor])
				if (value !== undefined && validValue(node, value)) return value
			return undefined
		}
		const result: Record<string, unknown> = {}
		const source = isRecord(candidate) ? candidate : {}
		const defaults = {
			...(isRecord(ancestor) ? ancestor : {}),
			...(isRecord(node.default) ? node.default : {}),
		}
		for (const [key, child] of Object.entries(node.properties ?? {})) {
			const value = resolve(child, source[key], defaults[key])
			if (value !== undefined) result[key] = value
		}
		if (node.additionalProperties === true)
			for (const [key, value] of Object.entries(source))
				if (!Object.hasOwn(node.properties ?? {}, key)) result[key] = value
		return result
	}
	return resolve(schema, values, undefined) as Record<string, unknown>
}

export function getMapletConfigDefaults(schema: MapletConfigSchema | undefined) {
	return normalizeMapletConfig(schema, {})
}

export function mapletConfigKey(identity: MapletIdentity) {
	return `earthly:maplet-config:${JSON.stringify([identity.dTag, identity.aggregateHash])}`
}

export function loadMapletConfig(
	identity: MapletIdentity,
	schema?: MapletConfigSchema,
): Record<string, unknown> {
	try {
		const stored = JSON.parse(localStorage.getItem(mapletConfigKey(identity)) ?? '{}')
		return schema
			? normalizeMapletConfig(schema, stored)
			: isRecord(stored)
				? (boundedJson(stored) as Record<string, unknown>)
				: {}
	} catch {
		return getMapletConfigDefaults(schema)
	}
}

export function saveMapletConfig(
	identity: MapletIdentity,
	values: Record<string, unknown>,
	schema?: MapletConfigSchema,
): void {
	const clean = schema ? normalizeMapletConfig(schema, values) : boundedJson(values)
	localStorage.setItem(mapletConfigKey(identity), JSON.stringify(clean))
}
