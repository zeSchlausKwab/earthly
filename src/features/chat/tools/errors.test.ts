import { describe, expect, it } from 'bun:test'
import { isToolError, type ToolError } from './errors'

describe('ToolError contract', () => {
	it('isToolError accepts a valid unknown_tool error', () => {
		const error: ToolError = {
			kind: 'unknown_tool',
			toolName: 'mystery',
			message: 'Unknown tool: mystery',
		}
		expect(isToolError(error)).toBe(true)
	})

	it('isToolError accepts a valid handler_error with origin', () => {
		const error: ToolError = {
			kind: 'handler_error',
			toolName: 'search_location',
			message: 'network down',
			origin: 'pubkey-abc',
			argumentsPreview: '{"query":"x"}',
		}
		expect(isToolError(error)).toBe(true)
	})

	it('isToolError rejects non-ToolError shapes', () => {
		expect(isToolError(null)).toBe(false)
		expect(isToolError(undefined)).toBe(false)
		expect(isToolError('boom')).toBe(false)
		expect(isToolError(42)).toBe(false)
		expect(isToolError({})).toBe(false)
		expect(isToolError({ kind: 'unknown_tool' })).toBe(false) // missing toolName/message
		expect(isToolError({ kind: 'other', toolName: 'x', message: 'y' })).toBe(false)
		expect(isToolError({ ok: true, message: 'plain tool result' })).toBe(false)
	})
})
