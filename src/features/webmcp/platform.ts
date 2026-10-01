import type { ToolJsonSchema } from '@/features/chat/tools/types'

/** Keep the changing browser API at this boundary (Chrome imperative API, Sep 2026). */
export interface BrowserTool {
	name: string
	description: string
	inputSchema: ToolJsonSchema
	annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean }
	execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>
}

export interface ModelContext {
	registerTool: (tool: BrowserTool, options?: { signal: AbortSignal }) => void | Promise<void>
	/** Older navigator.modelContext implementations used explicit removal. */
	unregisterTool?: (name: string) => void
}

export function getModelContext(
	doc: object = document,
	nav: object = navigator,
): ModelContext | null {
	const context =
		(doc as { modelContext?: ModelContext }).modelContext ??
		(nav as { modelContext?: ModelContext }).modelContext
	return typeof context?.registerTool === 'function' ? context : null
}

/** Abort registration on teardown or partial failure; never leave stale executable tools. */
export async function registerBrowserTools(
	context: ModelContext,
	tools: BrowserTool[],
	signal: AbortSignal,
): Promise<void> {
	const registrations = new AbortController()
	const cancel = () => registrations.abort()
	signal.addEventListener('abort', cancel, { once: true })
	if (signal.aborted) cancel()
	const registered: string[] = []
	const removeLegacyTools = () => {
		for (const name of registered.splice(0)) context.unregisterTool?.(name)
	}
	registrations.signal.addEventListener('abort', removeLegacyTools, { once: true })
	try {
		for (const tool of tools) {
			signal.throwIfAborted()
			await context.registerTool(tool, { signal: registrations.signal })
			registered.push(tool.name)
			// An old implementation may ignore the signal during an awaited registration.
			if (signal.aborted) {
				removeLegacyTools()
				signal.throwIfAborted()
			}
		}
	} catch (error) {
		registrations.abort()
		signal.removeEventListener('abort', cancel)
		removeLegacyTools()
		throw error
	}
}
