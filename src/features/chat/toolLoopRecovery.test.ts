import { describe, expect, test } from 'bun:test'
import { ToolLoopRecovery } from './toolLoopRecovery'
import type { ToolCall } from './routstr'

function call(name: string, args: string): ToolCall {
	return { id: crypto.randomUUID(), type: 'function', function: { name, arguments: args } }
}

describe('ToolLoopRecovery', () => {
	test('reports repeated same-state observations without stopping the run', () => {
		const recovery = new ToolLoopRecovery()
		const find = call('find_features', '{"predicate":{"field":"type","value":"callout"}}')

		expect(recovery.observe(find, '{"matched":8}', false)).toBeNull()
		const instruction = recovery.observe(find, '{"matched":8}', false)

		expect(instruction).toMatch(/no new information/i)
		expect(instruction).toMatch(/do not repeat/i)
		expect(instruction).toMatch(/does not stop/i)
	})

	test('resets repeated-read evidence after the map changes', () => {
		const recovery = new ToolLoopRecovery()
		const find = call('find_features', '{}')

		recovery.observe(find, '{"matched":8}', false)
		recovery.observe(call('add_feature_callouts', '{}'), '{"counts":{"updated":8}}', true)

		expect(recovery.observe(find, '{"matched":8}', false)).toBeNull()
	})
})
