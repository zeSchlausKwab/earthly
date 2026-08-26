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
import {
	attachPendingDiffCommit,
	markToolDiffsNotApplied,
} from '@/features/chat/safeEditing/pendingDiffStore'
import type { PendingDiffExecutionScope } from '@/features/chat/safeEditing/pendingDiffCommit'
import {
	serializeToolResult,
	parseToolCallArguments,
	toEditorFromToolResultValue,
	compactToolResultAfterBake,
} from './helpers'
import { dispatch, registry } from './registry'
import { isToolError, type ToolError } from './errors'
import { isToolRedirect } from './source-routing'
import {
	ensureExecutionTargetForMutation,
	hasPreparedDatasetExecutionTarget,
	isToolExecutionTargetVisible,
	persistToolExecutionRun,
	prepareToolExecutionRun,
	rollbackToolExecutionRun,
	ToolExecutionTargetPersistenceError,
} from './executionTarget'

function requiresDatasetTarget(toolName: string, args: Record<string, unknown>): boolean {
	if (args.toEditor === true && TO_EDITOR_COMPATIBLE_TOOLS.has(toolName)) return true
	if (
		toolName === 'set_dataset_metadata' ||
		toolName === 'select_features' ||
		toolName === 'place_dataset_features' ||
		toolName === 'batch_geocode' ||
		toolName === 'import_osm_to_editor'
	) {
		return true
	}
	const kind = registry.get(toolName)?.kind
	return kind === 'editor' || kind === 'authoring-primitive' || kind === 'code-interpreter'
}

function getStructuredToolError(result: ToolResult): ToolError | null {
	try {
		const parsed = JSON.parse(result.content) as unknown
		return isToolError(parsed) ? parsed : null
	} catch {
		return null
	}
}

function getPendingDiffScope(
	toolCall: ToolCall,
	context: ToolExecutionContext | undefined,
): PendingDiffExecutionScope | null {
	const run = context?.run
	if (!run) return null
	return {
		runId: run.runId,
		chatId: run.chatId,
		toolCallId: toolCall.id,
		target: run.target,
	}
}

function markToolCallDiffsNotApplied(
	toolCall: ToolCall,
	context: ToolExecutionContext | undefined,
): void {
	const scope = getPendingDiffScope(toolCall, context)
	if (scope) markToolDiffsNotApplied(scope)
}

async function executeToolCallBound(
	toolCall: ToolCall,
	context?: ToolExecutionContext,
): Promise<ToolResult> {
	const rawArguments =
		typeof toolCall.function.arguments === 'string' ? toolCall.function.arguments : ''
	const argumentsPreview =
		rawArguments.length > 240 ? `${rawArguments.slice(0, 240)}...` : rawArguments

	try {
		const args = parseToolCallArguments(toolCall.function.arguments)
		const needsDataset = requiresDatasetTarget(toolCall.function.name, args)
		if (needsDataset && context?.run && context.run.target.entityType !== 'dataset') {
			const toolError: ToolError = {
				ok: false,
				kind: 'handler_error',
				toolName: toolCall.function.name,
				message:
					'This conversation has no editing target. Choose New map or Use current edit, then send the request again.',
				code: 'dataset_target_required',
				retryable: true,
				sideEffectsApplied: false,
				argumentsPreview,
			}
			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(toolError),
			}
		}
		if (
			needsDataset &&
			context?.run?.target.entityType === 'dataset' &&
			!hasPreparedDatasetExecutionTarget(context.run)
		) {
			const toolError: ToolError = {
				ok: false,
				kind: 'handler_error',
				toolName: toolCall.function.name,
				message: 'The Dataset draft captured when this request started is no longer available.',
				code: 'dataset_target_unavailable',
				retryable: true,
				sideEffectsApplied: false,
				argumentsPreview,
			}
			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(toolError),
			}
		}
		if (toolCall.function.name.startsWith('editor_') && context?.run) {
			const toolError: ToolError = {
				ok: false,
				kind: 'handler_error',
				toolName: toolCall.function.name,
				message:
					'Interactive editor commands cannot run in the background. Use a geometry or authoring tool that writes to the bound Dataset draft.',
				code: 'background_editor_command_unsupported',
				retryable: false,
				sideEffectsApplied: false,
				argumentsPreview,
			}
			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(toolError),
			}
		}
		if (toolCall.function.name === 'capture_map_snapshot' && context?.run) {
			const hasDatasetTarget = context.run.target.entityType === 'dataset'
			const targetVisible = hasDatasetTarget && isToolExecutionTargetVisible(context.run)
			if (targetVisible) {
				// The host capture below is now proven to be the exact send-bound surface.
			} else {
				const toolError: ToolError = {
					ok: false,
					kind: 'handler_error',
					toolName: toolCall.function.name,
					message: hasDatasetTarget
						? 'The Dataset bound to this run is no longer the visible map. Open that exact Dataset before requesting a visual snapshot.'
						: 'This run has no immutable visual target. Bind a Dataset before requesting a map snapshot.',
					code: hasDatasetTarget ? 'capture_target_not_visible' : 'capture_target_required',
					retryable: true,
					sideEffectsApplied: false,
					argumentsPreview,
				}
				return {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: JSON.stringify(toolError),
				}
			}
		}
		if (toolCall.function.name === 'get_editor_state' && context?.run) {
			const hasDatasetTarget = context.run.target.entityType === 'dataset'
			const targetVisible = hasDatasetTarget && isToolExecutionTargetVisible(context.run)
			if (!targetVisible) {
				const toolError: ToolError = {
					ok: false,
					kind: 'handler_error',
					toolName: toolCall.function.name,
					message: hasDatasetTarget
						? 'The Dataset bound to this run is no longer the visible editor. Open that exact Dataset before requesting live editor state.'
						: 'This run has no immutable editor target. Bind a Dataset before requesting live editor state.',
					code: hasDatasetTarget
						? 'editor_state_target_not_visible'
						: 'editor_state_target_required',
					retryable: true,
					sideEffectsApplied: false,
					argumentsPreview,
				}
				return {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: JSON.stringify(toolError),
				}
			}
		}

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
			await ensureExecutionTargetForMutation(context?.run)
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
		const targetError = error instanceof ToolExecutionTargetPersistenceError ? error : null
		const toolError: ToolError = {
			ok: false,
			kind: 'handler_error',
			toolName: toolCall.function.name,
			message: error instanceof Error ? error.message : 'Tool execution failed',
			argumentsPreview,
			code: targetError?.code ?? 'tool_execution_error',
			retryable: Boolean(targetError),
			sideEffectsApplied: false,
		}
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(toolError),
		}
	}
}

export async function executeToolCall(
	toolCall: ToolCall,
	context?: ToolExecutionContext,
): Promise<ToolResult> {
	if (context?.run) prepareToolExecutionRun(context.run)
	const result = await executeToolCallBound(toolCall, context)
	if (getStructuredToolError(result)) {
		rollbackToolExecutionRun(context?.run)
		markToolCallDiffsNotApplied(toolCall, context)
		return result
	}
	try {
		const commit = persistToolExecutionRun(context?.run)
		const scope = getPendingDiffScope(toolCall, context)
		if (commit && scope) {
			try {
				attachPendingDiffCommit(scope, commit)
			} catch (error) {
				// Undo metadata is best-effort. The draft is already durably committed,
				// so a disclosure bookkeeping failure must not ask the model to retry.
				console.error('[Chat] Failed to attach target-bound Undo metadata', error)
			}
		}
		return result
	} catch (error) {
		markToolCallDiffsNotApplied(toolCall, context)
		const toolError: ToolError = {
			ok: false,
			kind: 'handler_error',
			toolName: toolCall.function.name,
			message: error instanceof Error ? error.message : 'The bound Dataset could not be saved.',
			code:
				error instanceof ToolExecutionTargetPersistenceError
					? error.code
					: 'dataset_target_conflict',
			retryable: true,
			sideEffectsApplied: false,
		}
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(toolError),
		}
	}
}
