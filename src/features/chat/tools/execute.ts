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
	createExecutionAuthoring,
	ensureExecutionTargetForMutation,
	getExecutionEditor,
	hasPreparedDatasetExecutionTarget,
	isToolExecutionTargetRendered,
	isToolExecutionTargetVisible,
	persistToolExecutionRun,
	prepareToolExecutionRun,
	rollbackToolExecutionRun,
	ToolExecutionTargetPersistenceError,
} from './executionTarget'
import { getEditorDatasetMetadata } from './editorDatasetMetadata'

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

function isDeferredGeoCatalogImport(toolName: string, result: unknown): boolean {
	if (toolName !== 'query_geography' || !result || typeof result !== 'object') return false
	const editorImport = (result as Record<string, unknown>).editorImport
	if (!editorImport || typeof editorImport !== 'object' || Array.isArray(editorImport)) return false
	const state = editorImport as Record<string, unknown>
	return state.selectionRequired === true || state.available === false
}

function getStructuredToolError(result: ToolResult): ToolError | null {
	try {
		const parsed = JSON.parse(result.content) as unknown
		return isToolError(parsed) ? parsed : null
	} catch {
		return null
	}
}

function mapSnapshotPermissionError(
	toolName: string,
	toolCallId: string,
	context: ToolExecutionContext | undefined,
	argumentsPreview: string,
): ToolResult | null {
	if (toolName !== 'capture_map_snapshot' || context?.allowMapSnapshotCapture !== false) {
		return null
	}
	const toolError: ToolError = {
		ok: false,
		kind: 'handler_error',
		toolName,
		message:
			'Autonomous map screenshots are disabled for this conversation. Continue without visual capture.',
		code: 'map_snapshot_capture_disabled',
		retryable: false,
		sideEffectsApplied: false,
		argumentsPreview,
	}
	return {
		tool_call_id: toolCallId,
		role: 'tool',
		content: JSON.stringify(toolError),
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
		const snapshotPermissionError = mapSnapshotPermissionError(
			toolCall.function.name,
			toolCall.id,
			context,
			argumentsPreview,
		)
		if (snapshotPermissionError) return snapshotPermissionError
		if (toolCall.function.name === 'capture_map_snapshot' && context?.run) {
			const hasDatasetTarget = context.run.target.entityType === 'dataset'
			const targetVisible = hasDatasetTarget && isToolExecutionTargetRendered(context.run)
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
			const redirectPermissionError = mapSnapshotPermissionError(
				dispatched.redirectTool,
				toolCall.id,
				context,
				argumentsPreview,
			)
			if (redirectPermissionError) return redirectPermissionError
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
			if (isDeferredGeoCatalogImport(toolCall.function.name, result)) {
				result = {
					...(result as Record<string, unknown>),
					toEditor: true,
				}
			} else {
				// `toEditor` is an authoring operation even though the originating tool is
				// read-only MCP. Establish the local draft before baking its result so the
				// geometry appears in Saved work, the Map Stack, and the editor list.
				await ensureExecutionTargetForMutation(context?.run)
				const editorMetadata = getEditorDatasetMetadata(result)
				if (editorMetadata) {
					const editor = getExecutionEditor()
					if (!editor) {
						throw new Error('Map editor is not ready to preserve imported dataset metadata.')
					}
					createExecutionAuthoring(editor).setDatasetMetadata(editorMetadata)
				}
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
		const structuredError = error as { code?: unknown; retryable?: unknown }
		const toolError: ToolError = {
			ok: false,
			kind: 'handler_error',
			toolName: toolCall.function.name,
			message: error instanceof Error ? error.message : 'Tool execution failed',
			argumentsPreview,
			code:
				targetError?.code ??
				(typeof structuredError.code === 'string' ? structuredError.code : 'tool_execution_error'),
			retryable: Boolean(targetError) || structuredError.retryable === true,
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
	const boundContext: ToolExecutionContext = { ...context, toolCallId: toolCall.id }
	if (boundContext.run) prepareToolExecutionRun(boundContext.run)
	const result = await executeToolCallBound(toolCall, boundContext)
	if (getStructuredToolError(result)) {
		rollbackToolExecutionRun(boundContext.run)
		markToolCallDiffsNotApplied(toolCall, boundContext)
		return result
	}
	try {
		const commit = persistToolExecutionRun(boundContext.run)
		const scope = getPendingDiffScope(toolCall, boundContext)
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
		markToolCallDiffsNotApplied(toolCall, boundContext)
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
