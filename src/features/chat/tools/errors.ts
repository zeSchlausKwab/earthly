/**
 * Unified tool-error contract (D-16).
 *
 * A `ToolError` is the single structured failure shape produced by the tool
 * registry. It covers BOTH an unknown tool name (`unknown_tool`, INFRA-01 hard
 * error replacing the old bare `throw`) AND a handler runtime failure
 * (`handler_error`). The same shape is:
 *   1. serialized into the existing `role:'tool'` content envelope and fed back
 *      into the model loop for self-correction (store.ts), and
 *   2. surfaced distinctly in the chat UI (ChatPanel MessageBubble).
 */

export interface ToolError {
	/** Discriminator: unknown tool name vs. a registered handler that threw. */
	kind: 'unknown_tool' | 'handler_error'
	/** The tool name the model attempted to call. */
	toolName: string
	/** Human-readable failure message (model- and user-facing). */
	message: string
	/** For remote-mcp handler failures: the originating server pubkey (D-12 attribution). */
	origin?: string
	/** Truncated preview of the raw arguments that triggered the failure. */
	argumentsPreview?: string
}

/** Runtime guard: is an arbitrary value a structured ToolError? */
export function isToolError(value: unknown): value is ToolError {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Record<string, unknown>
	return (
		(candidate.kind === 'unknown_tool' || candidate.kind === 'handler_error') &&
		typeof candidate.toolName === 'string' &&
		typeof candidate.message === 'string'
	)
}
