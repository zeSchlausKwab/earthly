import { describe, expect, it } from 'bun:test'
import type { ChatMessage, ToolCall } from './routstr'
import { sanitizeDanglingToolCalls, syntheticCancelledToolResult } from './toolCallIntegrity'

const call = (id: string): ToolCall => ({
	id,
	type: 'function',
	function: { name: 'style_by_attribute', arguments: '{}' },
})

const user = (content: string): ChatMessage => ({ role: 'user', content })
const toolResult = (id: string): ChatMessage => ({
	role: 'tool',
	content: '{"ok":true}',
	tool_call_id: id,
})

describe('sanitizeDanglingToolCalls', () => {
	it('returns the SAME reference when pairing is intact (hot path stays cheap)', () => {
		const messages: ChatMessage[] = [
			user('hi'),
			{ role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
			toolResult('a'),
			toolResult('b'),
			{ role: 'assistant', content: 'done' },
		]
		expect(sanitizeDanglingToolCalls(messages)).toBe(messages)
	})

	it('repairs the wedged-chat shape: tool_calls followed directly by a user message', () => {
		// The exact 2026-07-08 bench wedge: STOP during a gated style_by_attribute,
		// then the user typed a new message — no tool response was ever persisted.
		const messages: ChatMessage[] = [
			user('Lets have all line a bit thicker.'),
			{ role: 'assistant', content: null, tool_calls: [call('style_by_attribute:12')] },
			user('Can you add some annotations...'),
		]
		const repaired = sanitizeDanglingToolCalls(messages)
		expect(repaired).not.toBe(messages)
		expect(repaired).toHaveLength(4)
		expect(repaired[2]).toMatchObject({
			role: 'tool',
			tool_call_id: 'style_by_attribute:12',
		})
		expect(repaired[2]?.content).toContain('stopped before this tool call completed')
		expect(repaired[3]?.role).toBe('user')
	})

	it('fills only the MISSING ids of a partially answered round, preserving order', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: null, tool_calls: [call('a'), call('b'), call('c')] },
			toolResult('a'),
			{ role: 'assistant', content: 'moved on' },
		]
		const repaired = sanitizeDanglingToolCalls(messages)
		expect(repaired).toHaveLength(5)
		// real result for a, synthetics for b and c, all before the next assistant turn
		expect(repaired[1]).toMatchObject({ role: 'tool', tool_call_id: 'a' })
		expect(repaired[2]).toMatchObject({ role: 'tool', tool_call_id: 'b' })
		expect(repaired[3]).toMatchObject({ role: 'tool', tool_call_id: 'c' })
		expect(repaired[4]?.role).toBe('assistant')
	})

	it('repairs a dangling round at the very END of the transcript', () => {
		const messages: ChatMessage[] = [
			user('go'),
			{ role: 'assistant', content: null, tool_calls: [call('x')] },
		]
		const repaired = sanitizeDanglingToolCalls(messages)
		expect(repaired).toHaveLength(3)
		expect(repaired[2]).toMatchObject({ role: 'tool', tool_call_id: 'x' })
	})

	it('handles multiple broken rounds in one history', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: null, tool_calls: [call('a')] },
			user('first interrupt'),
			{ role: 'assistant', content: null, tool_calls: [call('b')] },
			user('second interrupt'),
		]
		const repaired = sanitizeDanglingToolCalls(messages)
		expect(repaired).toHaveLength(6)
		expect(repaired[1]).toMatchObject({ role: 'tool', tool_call_id: 'a' })
		expect(repaired[4]).toMatchObject({ role: 'tool', tool_call_id: 'b' })
	})

	it('synthetic payload parses as JSON and self-describes as cancelled', () => {
		const parsed = JSON.parse(syntheticCancelledToolResult('why')) as Record<string, unknown>
		expect(parsed.cancelled).toBe(true)
		expect(parsed.note).toBe('why')
	})
})
