/**
 * Poll-based MCP tool hot-reload (D-05 / D-04).
 *
 * The registry actively PULLS the connected ContextVM geo server's live tool
 * manifest via `EarthlyGeoServerClient.listTools()` and converges the registry's
 * `kind:'remote-mcp'` entries to match it: tools present in the manifest are
 * `register`ed (tagged `kind:'remote-mcp'`, `origin: SERVER_PUBKEY`), tools that
 * disappeared are `unregister`ed. `advertise()` then reflects the live manifest,
 * so what the model sees stays in sync with the server (replacing the
 * hand-transcribed MCP list in `definitions.ts`).
 *
 * POLL-BASED, NOT PUSH (Pitfall 3): `EarthlyGeoServerClient` runs the Nostr
 * transport with `isStateless: true`, so server-initiated list-changed
 * notifications are not guaranteed. We therefore refresh on an explicit call +
 * optional interval — there is intentionally NO server-push subscription wired
 * in this module (no push notification handler is registered for tool-list
 * changes). (A1 verified live: the server returns a non-empty manifest, including a
 * `create_map_upload` tool absent from the hardcoded list — exactly the drift
 * this sync eliminates.)
 *
 * Graceful degradation (T-02-18 DoS): if `listTools()` errors/hangs, sync logs a
 * ToolError-style warning and leaves the last-known/hardcoded entries in place —
 * it never throws into the caller and never clears the registry.
 *
 * Spoofing/Tampering (T-02-17 / T-02-19): every synced tool is forced to
 * `kind:'remote-mcp'` with `origin: SERVER_PUBKEY` (it can never masquerade as an
 * `editor`/`authoring-primitive` tool), and only manifest entries with a valid
 * shape (string name + object inputSchema) are registered.
 */

import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { getGeoClient } from './helpers'
import { register, registry, unregister } from './registry'
import type { Tool } from './types'

const REMOTE_MCP_ORIGIN = EarthlyGeoServerClient.SERVER_PUBKEY

/** Tracks which tool names this module synced, so we only unregister our own. */
const syncedToolNames = new Set<string>()

/** Whether the last `syncMcpTools()` call applied a live manifest. */
let lastSyncSucceeded = false

/** Minimal shape of a tool entry returned by the MCP SDK `listTools()`. */
interface McpManifestTool {
	name: string
	description?: string
	inputSchema?: {
		type?: string
		properties?: Record<string, unknown>
		required?: string[]
	}
}

/** True when a manifest entry has the minimum valid shape to register (T-02-19). */
function isValidManifestTool(value: unknown): value is McpManifestTool {
	if (!value || typeof value !== 'object') return false
	const tool = value as Record<string, unknown>
	if (typeof tool.name !== 'string' || tool.name.trim() === '') return false
	if (tool.inputSchema !== undefined && typeof tool.inputSchema !== 'object') return false
	return true
}

/**
 * Map a remote MCP manifest tool to an OpenAI function `Tool` schema. The remote
 * `inputSchema` is JSON-Schema-shaped; we project each property to the
 * `{ type, description }` pair the local `Tool` type advertises. Unknown property
 * shapes degrade to `type:'string'` rather than crashing the sync.
 */
function toOpenAiSchema(tool: McpManifestTool): Tool {
	const rawProps = tool.inputSchema?.properties ?? {}
	const properties: Tool['function']['parameters']['properties'] = {}
	for (const [key, rawValue] of Object.entries(rawProps)) {
		const prop = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<string, unknown>
		const type = typeof prop.type === 'string' ? prop.type : 'string'
		const description = typeof prop.description === 'string' ? prop.description : ''
		const enumValues = Array.isArray(prop.enum)
			? prop.enum.filter((v): v is string => typeof v === 'string')
			: undefined
		properties[key] = {
			type,
			description,
			...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
		}
	}
	const required = Array.isArray(tool.inputSchema?.required)
		? tool.inputSchema.required.filter((v): v is string => typeof v === 'string')
		: undefined
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description ?? '',
			parameters: {
				type: 'object',
				properties,
				...(required && required.length > 0 ? { required } : {}),
			},
		},
	}
}

/**
 * Register one synced remote tool. Its handler routes the call through the SAME
 * stateless transport path the hand-written remote-mcp handlers use
 * (`EarthlyGeoServerClient.callRemoteTool`), so dispatch + failure-attribution
 * stay uniform.
 */
function registerSyncedTool(tool: McpManifestTool): void {
	register({
		name: tool.name,
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: toOpenAiSchema(tool),
		handler: async (args) => {
			const client = getGeoClient()
			return client.callRemoteTool(tool.name, args)
		},
	})
}

/**
 * Pull the live MCP manifest and converge the registry's synced remote-mcp
 * entries to match it (register new, unregister removed). Poll-based; safe to
 * call repeatedly. On `listTools()` failure, degrades gracefully (keeps the
 * last-known/hardcoded set) and returns `{ ok: false }` — never throws.
 *
 * @returns the sync outcome (ok + counts) for callers/tests.
 */
export async function syncMcpTools(
	client: Pick<EarthlyGeoServerClient, 'listTools'> = getGeoClient(),
): Promise<{ ok: boolean; registered: number; unregistered: number; error?: string }> {
	let manifest: Awaited<ReturnType<EarthlyGeoServerClient['listTools']>>
	try {
		manifest = await client.listTools()
	} catch (error) {
		lastSyncSucceeded = false
		const message = error instanceof Error ? error.message : 'listTools() failed'
		// Graceful degradation (T-02-18): keep last-known/hardcoded entries intact.
		console.warn(
			`[mcp-sync] listTools() failed (${REMOTE_MCP_ORIGIN.slice(0, 8)}…): ${message}. ` +
				'Keeping last-known/hardcoded tool set.',
		)
		return { ok: false, registered: 0, unregistered: 0, error: message }
	}

	const tools = Array.isArray(manifest?.tools) ? manifest.tools : []
	const validTools = tools.filter(isValidManifestTool)
	const liveNames = new Set(validTools.map((tool) => tool.name))

	// Unregister synced tools that vanished from the live manifest (diff-to-converge).
	let unregistered = 0
	for (const name of [...syncedToolNames]) {
		if (!liveNames.has(name)) {
			unregister(name)
			syncedToolNames.delete(name)
			unregistered += 1
		}
	}

	// Register/refresh every tool in the live manifest.
	let registered = 0
	for (const tool of validTools) {
		registerSyncedTool(tool)
		syncedToolNames.add(tool.name)
		registered += 1
	}

	lastSyncSucceeded = true
	return { ok: true, registered, unregistered }
}

/** True once a `syncMcpTools()` call has successfully applied a live manifest. */
export function isMcpSyncActive(): boolean {
	return lastSyncSucceeded
}

/** The set of tool names currently sourced from the live manifest (read-only). */
export function getSyncedMcpToolNames(): string[] {
	return [...syncedToolNames]
}

// ---------------------------------------------------------------------------
// Optional cancelable interval polling. Off by default — callers opt in.
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start polling the live manifest on an interval (poll-based hot-reload). Runs
 * an immediate sync, then repeats every `intervalMs`. Idempotent: a second call
 * replaces the existing timer. NO push subscription (Pitfall 3).
 */
export function startMcpToolPolling(intervalMs = 60_000): void {
	stopMcpToolPolling()
	void syncMcpTools()
	pollTimer = setInterval(() => {
		void syncMcpTools()
	}, intervalMs)
	// Don't keep the process alive solely for polling (Node/Bun timer).
	;(pollTimer as { unref?: () => void }).unref?.()
}

/** Stop interval polling (cancelable). Safe to call when not polling. */
export function stopMcpToolPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

/** Test-only: reset module state between cases. */
export function __resetMcpSyncForTests(): void {
	for (const name of [...syncedToolNames]) {
		unregister(name)
	}
	syncedToolNames.clear()
	lastSyncSucceeded = false
	stopMcpToolPolling()
}

// Re-exported for tests that assert on registry convergence.
export { registry }
