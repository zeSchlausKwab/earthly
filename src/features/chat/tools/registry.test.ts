import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { isToolError } from './errors'
import {
	advertise,
	dispatch,
	type ToolEntry,
	register,
	registry,
	unregister,
} from './registry'

const TEST_TOOL: ToolEntry = {
	name: 'test_echo_tool',
	kind: 'host-builtin',
	schema: {
		type: 'function',
		function: {
			name: 'test_echo_tool',
			description: 'Echo back the provided value.',
			parameters: { type: 'object', properties: {} },
		},
	},
	handler: (args) => ({ echoed: (args as { value?: unknown }).value }),
}

describe('tool registry', () => {
	beforeEach(() => {
		register(TEST_TOOL)
	})

	afterEach(() => {
		unregister(TEST_TOOL.name)
	})

	it('dispatches a registered handler and returns its result', async () => {
		const result = await dispatch('test_echo_tool', { value: 42 })
		expect(isToolError(result)).toBe(false)
		expect(result).toEqual({ echoed: 42 })
	})

	it('returns a structured unknown_tool ToolError for an unknown name (INFRA-01)', async () => {
		const result = await dispatch('definitely_not_a_tool', {})
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('unknown_tool')
		expect(result.toolName).toBe('definitely_not_a_tool')
		// Not null, not a silent no-op.
		expect(result).not.toBeNull()
	})

	it('wraps a throwing handler into a handler_error ToolError (D-16)', async () => {
		register({
			name: 'test_thrower',
			kind: 'remote-mcp',
			origin: 'server-pubkey-xyz',
			schema: {
				type: 'function',
				function: {
					name: 'test_thrower',
					description: 'Always throws.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				throw new Error('boom')
			},
		})
		const result = await dispatch('test_thrower', {})
		unregister('test_thrower')
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
		expect(result.toolName).toBe('test_thrower')
		expect(result.message).toContain('boom')
		expect(result.origin).toBe('server-pubkey-xyz')
	})

	it('advertise() derives the tool list from live registry state (D-04/D-06)', () => {
		const advertised = advertise()
		const names = advertised.map((tool) => tool.function.name)
		expect(names).toContain('test_echo_tool')

		unregister('test_echo_tool')
		const afterUnregister = advertise().map((tool) => tool.function.name)
		expect(afterUnregister).not.toContain('test_echo_tool')
		register(TEST_TOOL) // restore for afterEach symmetry
	})

	it('every advertised schema resolves to a registered handler (no orphans, INFRA-01)', () => {
		const advertised = advertise()
		for (const tool of advertised) {
			expect(registry.has(tool.function.name)).toBe(true)
		}
	})

	it('advertises the full migrated tool surface (~30 tools)', () => {
		// The production registry self-populates via module side effects on import.
		const advertised = advertise()
		expect(advertised.length).toBeGreaterThanOrEqual(28)
		const names = advertised.map((tool) => tool.function.name)
		// A representative sample across every kind.
		expect(names).toContain('write_geojson_to_editor') // editor write via authoring
		expect(names).toContain('add_feature_to_editor')
		expect(names).toContain('get_editor_state') // host-builtin
		expect(names).toContain('search_location') // remote-mcp
		expect(names).toContain('valhalla_route') // remote-mcp
		expect(names).toContain('editor_set_mode') // editor command (self-registered)
		expect(names).toContain('editor_undo')
	})

	it('every registered entry carries a non-empty kind (D-03)', () => {
		for (const tool of advertise()) {
			const entry = registry.get(tool.function.name)
			expect(entry).toBeDefined()
			expect(entry?.kind).toBeTruthy()
		}
	})
})
