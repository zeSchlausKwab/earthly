/**
 * Conversation dump (Phase 4 UAT debugging aid).
 *
 * Pure, DOM-free builder for a full structured snapshot of the current chat —
 * everything needed to debug a run like "model wrote run_code, it errored, it
 * retried": message roles, raw content, reasoning blocks, tool_call
 * ids/names/arguments, and the RAW tool result content (not the rendered
 * summary), plus the active model/endpoint label.
 *
 * SECURITY (mirrors `chatStorePartialize` / SC-1 / T-01-01): provider API keys
 * MUST NEVER appear in the dump. We surface the endpoint `baseUrl` (useful for
 * debugging which endpoint served the run) but deliberately drop
 * `providerOverrides[*].apiKey`. The clipboard/Blob I/O lives in the UI; this
 * module is pure so it can be unit-tested headless.
 */
import type { ChatMessage, ProviderType, RoutstrModel, ToolCall } from './routstr'
import { resolveProvider } from './store'
import type { ChatReference, ChatSession, ProviderOverrideMap } from './store'

export const CONVERSATION_DUMP_SCHEMA = 'earthly.chat.dump'
export const CONVERSATION_DUMP_VERSION = 1 as const

export interface ConversationDumpInput {
	/** Wall-clock of the export, passed in so the builder stays pure. */
	exportedAt: number
	activeChat: Pick<ChatSession, 'id' | 'title' | 'createdAt' | 'updatedAt'> | null
	messages: ChatMessage[]
	references: ChatReference[]
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	selectedModel: string | null
	models: RoutstrModel[]
	toolsEnabled: boolean
	/** Live `ChatDiagnostics` snapshot (loosely typed to avoid a store-internal export). */
	diagnostics?: Record<string, unknown> | null
}

export interface ConversationDumpMessage {
	index: number
	role: ChatMessage['role']
	content: ChatMessage['content']
	reasoning_content: string | null
	tool_calls: ToolCall[] | null
	/** Present on role:'tool' messages — pairs the raw result with its call. */
	tool_call_id: string | null
}

export interface ConversationDump {
	schema: typeof CONVERSATION_DUMP_SCHEMA
	version: typeof CONVERSATION_DUMP_VERSION
	exportedAt: string
	chat: { id: string; title: string; createdAt: number; updatedAt: number } | null
	endpoint: {
		provider: ProviderType
		/** Endpoint URL — NOT a secret. The `apiKey` is intentionally omitted. */
		baseUrl: string
		modelId: string | null
		modelLabel: string | null
		toolsEnabled: boolean
	}
	diagnostics: Record<string, unknown> | null
	references: ChatReference[]
	messageCount: number
	messages: ConversationDumpMessage[]
}

/** Build the structured, secret-free conversation dump payload. */
export function buildConversationDump(input: ConversationDumpInput): ConversationDump {
	// resolveProvider also returns `apiKey`; we read ONLY `baseUrl` so the secret
	// never reaches the payload.
	const providerConfig = resolveProvider(input.provider, input.providerOverrides)
	const modelLabel =
		input.models.find((model) => model.id === input.selectedModel)?.name ??
		input.selectedModel ??
		null

	return {
		schema: CONVERSATION_DUMP_SCHEMA,
		version: CONVERSATION_DUMP_VERSION,
		exportedAt: new Date(input.exportedAt).toISOString(),
		chat: input.activeChat
			? {
					id: input.activeChat.id,
					title: input.activeChat.title,
					createdAt: input.activeChat.createdAt,
					updatedAt: input.activeChat.updatedAt,
				}
			: null,
		endpoint: {
			provider: input.provider,
			baseUrl: providerConfig.baseUrl,
			modelId: input.selectedModel,
			modelLabel,
			toolsEnabled: input.toolsEnabled,
		},
		diagnostics: input.diagnostics ?? null,
		references: input.references,
		messageCount: input.messages.length,
		messages: input.messages.map((message, index) => ({
			index,
			role: message.role,
			content: message.content,
			reasoning_content:
				typeof message.reasoning_content === 'string' ? message.reasoning_content : null,
			tool_calls: message.tool_calls ?? null,
			tool_call_id: message.tool_call_id ?? null,
		})),
	}
}

/** Pretty JSON for the clipboard and the downloaded `.json` file. */
export function serializeConversationDump(dump: ConversationDump): string {
	return JSON.stringify(dump, null, 2)
}

/** Stable, filesystem-safe download filename for a dump. */
export function buildConversationDumpFilename(dump: ConversationDump): string {
	const stamp = dump.exportedAt.replace(/[:.]/g, '-')
	const chatId = dump.chat?.id ? `-${dump.chat.id.slice(0, 8)}` : ''
	return `earthly-chat-dump${chatId}-${stamp}.json`
}
