import { describe, expect, test } from 'bun:test'
import { buildLiveAssistantMessage } from './liveAssistantMessage'

describe('buildLiveAssistantMessage', () => {
	test('surfaces reasoning-only provider deltas before answer text arrives', () => {
		expect(buildLiveAssistantMessage('', 'Inspecting the current map…')).toEqual({
			role: 'assistant',
			content: null,
			reasoning_content: 'Inspecting the current map…',
		})
	})

	test('returns null only while waiting for the first provider delta', () => {
		expect(buildLiveAssistantMessage('', '')).toBeNull()
	})
})
