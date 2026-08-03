import { describe, expect, test } from 'bun:test'
import { advertise, registry } from './registry'

describe('map callout AI tools', () => {
	test('registers and advertises dedicated add, update, and remove verbs', () => {
		const names = advertise().map((tool) => tool.function.name)
		for (const name of [
			'add_feature_callout',
			'update_feature_callout',
			'remove_feature_callout',
		]) {
			expect(registry.get(name)?.kind).toBe('authoring-primitive')
			expect(names).toContain(name)
		}
	})

	test('does not expose geometry or arbitrary feature replacement in callout schemas', () => {
		const add = advertise().find((tool) => tool.function.name === 'add_feature_callout')
		const properties = add?.function.parameters.properties ?? {}
		expect(properties).toHaveProperty('featureId')
		expect(properties).toHaveProperty('text')
		expect(properties).not.toHaveProperty('geometry')
		expect(properties).not.toHaveProperty('feature')
	})
})
