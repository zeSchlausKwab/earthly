import type { ChatMessage } from './routstr'

/** Build the transient assistant message from provider-supplied answer/reasoning deltas. */
export function buildLiveAssistantMessage(
	content: string,
	reasoningContent: string,
): ChatMessage | null {
	if (!content && !reasoningContent) return null
	return {
		role: 'assistant',
		content: content || null,
		reasoning_content: reasoningContent || undefined,
	}
}
