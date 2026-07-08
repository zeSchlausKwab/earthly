/**
 * Tool-call pairing integrity for the chat transcript.
 *
 * The OpenAI-compatible protocol requires every assistant message carrying
 * `tool_calls` to be followed by one `role:'tool'` message per `tool_call_id`
 * BEFORE any other message. A transcript violating this is permanently
 * unsendable — the provider rejects every subsequent request with
 * "an assistant message with 'tool_calls' must be followed by tool messages".
 *
 * That state is reachable: stopping a run while a tool executes (e.g. a
 * safe-editing gate awaiting Apply/Cancel) detaches the run between the
 * persisted assistant tool_calls message and its tool results (2026-07-08
 * bench: style_by_attribute + STOP wedged the chat). Two layers of defence:
 *
 *  - WRITE side: the store persists real or synthetic cancelled results for
 *    every outstanding call when a run detaches mid-round.
 *  - READ side (this module): `sanitizeDanglingToolCalls` repairs any history
 *    that violates pairing anyway (crashes, pre-fix chats) by inserting
 *    synthetic cancelled tool results, healing wedged chats on their next send.
 */

import type { ChatMessage, ToolCall } from './routstr'

/** Serialized synthetic result for a tool call that never got a response. */
export function syntheticCancelledToolResult(reason: string): string {
	return JSON.stringify({ cancelled: true, note: reason })
}

/**
 * Repair assistant→tool pairing: after each assistant message with
 * `tool_calls`, insert a synthetic cancelled `role:'tool'` message for every
 * tool_call_id that is not answered before the next non-tool message. Returns
 * the input array unchanged (same reference) when nothing needed repair.
 */
export function sanitizeDanglingToolCalls(messages: ChatMessage[]): ChatMessage[] {
	let repaired: ChatMessage[] | null = null

	let i = 0
	while (i < messages.length) {
		const message = messages[i] as ChatMessage
		const toolCalls = message.role === 'assistant' ? (message.tool_calls ?? null) : null
		if (!toolCalls || toolCalls.length === 0) {
			repaired?.push(message)
			i++
			continue
		}

		// The contiguous tool-response block that follows this assistant turn.
		const answered = new Set<string>()
		let blockEnd = i + 1
		while (blockEnd < messages.length && messages[blockEnd]?.role === 'tool') {
			const id = messages[blockEnd]?.tool_call_id
			if (typeof id === 'string') answered.add(id)
			blockEnd++
		}

		const missing = (toolCalls as ToolCall[]).filter((call) => !answered.has(call.id))
		// First repair: materialize the copy lazily.
		if (missing.length > 0 && !repaired) repaired = messages.slice(0, i)

		if (repaired) {
			repaired.push(message)
			// Keep the real results first, then append synthetics for the gaps —
			// all tool messages stay contiguous after their assistant turn.
			for (let k = i + 1; k < blockEnd; k++) {
				repaired.push(messages[k] as ChatMessage)
			}
			for (const call of missing) {
				repaired.push({
					role: 'tool',
					content: syntheticCancelledToolResult(
						'The run was stopped before this tool call completed. Nothing was applied for it.',
					),
					tool_call_id: call.id,
				})
			}
		}
		i = blockEnd
	}

	return repaired ?? messages
}
