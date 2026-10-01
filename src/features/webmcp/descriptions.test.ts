import { expect, test } from 'bun:test'
import { browserSchema } from './descriptions'

test('browser schema guidance preserves validation and literal example data', () => {
	const literal = { description: 'get_editor_state', label: 'run_code' }
	const shared = {
		type: 'object',
		description: 'Read get_editor_state first.',
		properties: {
			camera: { anyOf: [{ type: 'string', description: 'Use set_map_view.' }] },
		},
		required: ['camera'],
		enum: ['get_editor_state'],
		default: literal,
		examples: [literal],
	}
	const native = browserSchema(shared)
	expect(native.description).toBe('Read earthly_get_map first.')
	expect(native.properties.camera.anyOf[0]?.description).toBe('Use earthly_set_map_view.')
	expect(native.enum).toEqual(shared.enum)
	expect(native.default).toEqual(shared.default)
	expect(native.examples).toEqual(shared.examples)
	expect(native.required).toEqual(shared.required)
	expect(shared.description).toBe('Read get_editor_state first.')
})
