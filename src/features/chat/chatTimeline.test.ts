import { describe, expect, it } from 'bun:test'
import type { ChatMessage } from './routstr'
import { buildChatTimeline } from './chatTimeline'

function toolCall(id: string, name: string): ChatMessage {
	return {
		role: 'assistant',
		content: null,
		tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
	}
}

describe('buildChatTimeline', () => {
	it('collapses a multi-round tool run while preserving user and final answer messages', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Map the table' },
			toolCall('a', 'wikipedia_extract'),
			{ role: 'tool', tool_call_id: 'a', content: '{"result":{}}' },
			toolCall('b', 'run_code'),
			{ role: 'tool', tool_call_id: 'b', content: '{"ok":true}' },
			{ role: 'assistant', content: 'Done' },
		]
		const timeline = buildChatTimeline(messages)
		expect(timeline.map((item) => item.type)).toEqual([
			'message',
			'tool-operation-group',
			'message',
		])
		const group = timeline[1]
		expect(group?.type).toBe('tool-operation-group')
		if (group?.type !== 'tool-operation-group') return
		expect(group.phaseCounts.research).toBe(1)
		expect(group.phaseCounts.build).toBe(1)
		expect(group.messages).toHaveLength(4)
	})

	it('keeps a single tool call expanded in the ordinary timeline', () => {
		const timeline = buildChatTimeline([
			toolCall('a', 'get_editor_state'),
			{ role: 'tool', tool_call_id: 'a', content: '{}' },
		])
		expect(timeline.map((item) => item.type)).toEqual(['message', 'message'])
	})

	it('surfaces serialized tool-error counts on a grouped operation', () => {
		const timeline = buildChatTimeline([
			toolCall('a', 'web_search'),
			{
				role: 'tool',
				tool_call_id: 'a',
				content: '{"ok":false,"kind":"handler_error","toolName":"web_search"}',
			},
			toolCall('b', 'wikipedia_lookup'),
			{ role: 'tool', tool_call_id: 'b', content: '{}' },
		])
		const group = timeline[0]
		expect(group?.type === 'tool-operation-group' ? group.errorCount : -1).toBe(1)
	})

	it('keeps a grouped operation identity stable as more tool calls arrive', () => {
		const inProgress: ChatMessage[] = [
			{ role: 'user', content: 'Build a map' },
			toolCall('a', 'web_search'),
			{ role: 'tool', tool_call_id: 'a', content: '{}' },
			toolCall('b', 'wikipedia_extract'),
			{ role: 'tool', tool_call_id: 'b', content: '{}' },
		]
		const initialGroup = buildChatTimeline(inProgress)[1]
		const updatedGroup = buildChatTimeline([
			...inProgress,
			toolCall('c', 'run_code'),
			{ role: 'tool', tool_call_id: 'c', content: '{}' },
		])[1]

		expect(initialGroup?.type).toBe('tool-operation-group')
		expect(updatedGroup?.type).toBe('tool-operation-group')
		expect(initialGroup?.key).toBe(updatedGroup?.key)
		expect(updatedGroup?.key).toBe('tools-1')
	})
})
