/**
 * Tool call executor — the single thin dispatch controller (D-01).
 *
 * The former 24-case `switch` and the `editor_*` fallthrough are gone: every
 * tool now resolves through the unified typed registry (`registry.dispatch`).
 * An unknown tool name or a handler failure comes back as a structured
 * `ToolError` (INFRA-01 / D-16), which is serialized into the existing
 * `role:'tool'` content envelope so the model loop (store.ts) still receives
 * it for self-correction AND the chat UI can render it distinctly.
 */

import type { ToolCall, ToolExecutionContext, ToolResult } from './types'
import { TO_EDITOR_COMPATIBLE_TOOLS } from './types'
import { ensureDatasetDraftForMutation } from '@/features/geo-editor/authoringTaskBridge'
import {
	serializeToolResult,
	parseToolCallArguments,
	toEditorFromToolResultValue,
	compactToolResultAfterBake,
} from './helpers'
import { dispatch } from './registry'
import { isToolError, type ToolError } from './errors'
import { isToolRedirect } from './source-routing'

export async function executeToolCall(
	toolCall: ToolCall,
	context?: ToolExecutionContext,
): Promise<ToolResult> {
	const rawArguments =
		typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : ''
	const argumentsPreview =
		rawArguments.length > 240 ? `${rawArguments.slice(0, 240)}...` : rawArguments

	try {
		const args = parseToolCallArguments(toolCall.function.arguments)

		let dispatched = await dispatch(toolCall.function.name, args, context)
		// Structured redirects are host-side routing decisions, not failures the
		// model should spend another round interpreting. Follow exactly once; a
		// second redirect is returned as data to avoid redirect cycles.
		if (isToolRedirect(dispatched)) {
			dispatched = await dispatch(dispatched.redirectTool, dispatched.redirectArguments, context)
		}

		// Structured tool failure (unknown tool or handler error). Preserve the
		// role:'tool' envelope (tool_call_id + content) so the model loop keeps
		// self-correcting; enrich with an arguments preview for the UI/model.
		if (isToolError(dispatched)) {
			const toolError: ToolError = {
				...dispatched,
				argumentsPreview: dispatched.argumentsPreview ?? argumentsPreview,
			}
			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(toolError),
			}
		}

		let result: unknown = dispatched

		if (args.toEditor && TO_EDITOR_COMPATIBLE_TOOLS.has(toolCall.function.name)) {
			// `toEditor` is an authoring operation even though the originating tool is
			// read-only MCP. Establish the local draft before baking its result so the
			// geometry appears in Saved work, the Map Stack, and the editor list.
			await ensureDatasetDraftForMutation()
			const bakeResult = toEditorFromToolResultValue(
				result,
				Boolean(args.replaceExisting),
				toolCall.function.name,
			)
			result = {
				...compactToolResultAfterBake(result),
				editorImport: bakeResult,
				toEditor: true,
			}
		}

		console.log('tool result', result)

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: serializeToolResult(result),
		}
	} catch (error) {
		// Last-resort guard: arg-parse failure or post-dispatch baking error.
		// Surfaced in the same typed shape so the UI/model treat it uniformly.
		const toolError: ToolError = {
			ok: false,
			kind: 'handler_error',
			toolName: toolCall.function.name,
			message: error instanceof Error ? error.message : 'Tool execution failed',
			argumentsPreview,
			code: 'tool_execution_error',
			retryable: false,
			sideEffectsApplied: false,
		}
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(toolError),
		}
	}
}
