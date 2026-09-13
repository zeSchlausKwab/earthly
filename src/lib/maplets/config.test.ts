import { describe, expect, test } from 'bun:test'
import {
	boundedJson,
	mapletConfigKey,
	normalizeMapletConfig,
	validateMapletConfigSchema,
} from './config'

describe('NAP-CONFIG validation', () => {
	test('applies persisted values and property defaults before ancestor defaults; drops orphan keys', () => {
		const schema = validateMapletConfigSchema({
			type: 'object',
			default: { name: 'ancestor', color: 'blue' },
			properties: {
				name: { type: 'string', default: 'property' },
				color: { type: 'string' },
				enabled: { type: 'boolean', default: true },
			},
		})
		expect(
			normalizeMapletConfig(schema, { name: 'saved', enabled: 'invalid', orphan: 'drop' }),
		).toEqual({ name: 'saved', color: 'blue', enabled: true })
		expect(normalizeMapletConfig(schema, {})).toEqual({
			name: 'property',
			color: 'blue',
			enabled: true,
		})
	})
	test('rejects references, patterns, secret defaults and prototype pollution', () => {
		for (const property of [
			{ type: 'string', pattern: '(a+)+$' },
			{ $ref: 'https://attacker.test/schema' },
			{ type: 'string', 'x-napplet-secret': true, default: 'password' },
		]) {
			expect(() =>
				validateMapletConfigSchema({ type: 'object', properties: { field: property } }),
			).toThrow()
		}
		expect(() => boundedJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('Unsafe')
	})
	test('format is only a hint and settings scopes isolate changed releases', () => {
		const schema = validateMapletConfigSchema({
			type: 'object',
			properties: { email: { type: 'string', format: 'email' } },
		})
		expect(normalizeMapletConfig(schema, { email: 'not an email' })).toEqual({
			email: 'not an email',
		})
		expect(mapletConfigKey({ dTag: 'one', aggregateHash: 'a' })).not.toBe(
			mapletConfigKey({ dTag: 'one', aggregateHash: 'b' }),
		)
		expect(mapletConfigKey({ dTag: 'one', aggregateHash: 'a' })).not.toBe(
			mapletConfigKey({ dTag: 'two', aggregateHash: 'a' }),
		)
	})
})
