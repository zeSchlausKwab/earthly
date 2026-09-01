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
import type { ChatReference, ChatRunStatus, ChatSession, ProviderOverrideMap } from './store'
import type { PromptProfile } from './tools/context'
import { isToolError } from './tools/errors'
import type { ToolExecutionRunIdentity, ToolExecutionTarget } from './tools/types'

export const CONVERSATION_DUMP_SCHEMA = 'earthly.chat.dump'
export const CONVERSATION_DUMP_VERSION = 3 as const

export interface ConversationDumpLastRunInput {
	identity: ToolExecutionRunIdentity | null
	completedAt: number | null
	status: ChatRunStatus | null
}

export interface ConversationDumpInput {
	/** Wall-clock of the export, passed in so the builder stays pure. */
	exportedAt: number
	activeChat: Pick<
		ChatSession,
		'id' | 'title' | 'targetWorkspaceId' | 'createdAt' | 'updatedAt'
	> | null
	/** Freshly resolved target for the active Chat at export time. */
	currentTarget: ToolExecutionTarget | null
	/** Last memory-resident run owned by the active Chat. */
	lastRun: ConversationDumpLastRunInput | null
	messages: ChatMessage[]
	references: ChatReference[]
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	selectedModel: string | null
	models: RoutstrModel[]
	toolsEnabled: boolean
	promptProfile?: PromptProfile
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
	chat: {
		id: string
		title: string
		targetWorkspaceId: string | null
		createdAt: number
		updatedAt: number
	} | null
	endpoint: {
		provider: ProviderType
		/** Endpoint URL — NOT a secret. The `apiKey` is intentionally omitted. */
		baseUrl: string
		modelId: string | null
		modelLabel: string | null
		toolsEnabled: boolean
		promptProfile: PromptProfile
	}
	analysis: ConversationDumpAnalysis
	editingTarget: ConversationDumpEditingTarget
	diagnostics: Record<string, unknown> | null
	references: ChatReference[]
	messageCount: number
	messages: ConversationDumpMessage[]
}

export interface ConversationDumpTargetIdentity {
	entityType: ToolExecutionTarget['entityType']
	draftId: string | null
	entityId: string | null
	sourceId: string | null
	baseRevisionId: string | null
	draftUpdatedAt: number | null
	wasDirty: boolean | null
	workspaceId: string | null
}

/** Keep diagnostic exports useful without embedding megabytes of private pixels. */
function sanitizeContentForConversationDump(
	content: ChatMessage['content'],
): ChatMessage['content'] {
	if (!Array.isArray(content)) return content
	return content.map((part) => {
		if (part.type !== 'image_url' || !part.image_url.url.startsWith('data:')) return part
		const mimeType = /^data:([^;,]+)/.exec(part.image_url.url)?.[1] ?? 'image'
		return {
			type: 'text' as const,
			text: `[inline ${mimeType} omitted from conversation export]`,
		}
	})
}

export type ConversationDumpCurrentTargetStatus =
	| 'no_active_chat'
	| 'unbound'
	| 'legacy_resolved'
	| 'resolved'
	| 'unavailable'
	| 'mismatch'

export interface ConversationDumpEditingTarget {
	current: {
		chatId: string | null
		/** Persisted Chat pointer, separate from the freshly resolved target below. */
		targetWorkspaceId: string | null
		status: ConversationDumpCurrentTargetStatus
		target: ConversationDumpTargetIdentity
	}
	lastRun: {
		runId: number | null
		chatId: string | null
		startedAt: number | null
		completedAt: number | null
		status: ChatRunStatus | null
		target: ConversationDumpTargetIdentity
	}
}

export interface ConversationDumpAnalysis {
	modelRoundCount: number
	toolCallCount: number
	toolErrorCount: number
	redirectCount: number
	repeatedToolCalls: Array<{ fingerprint: string; count: number }>
	completedWithAssistant: boolean
	endedOnToolResult: boolean
	stopReason: string | null
}

function dumpTargetIdentity(target: ToolExecutionTarget | null): ConversationDumpTargetIdentity {
	if (!target) {
		return {
			entityType: null,
			draftId: null,
			entityId: null,
			sourceId: null,
			baseRevisionId: null,
			draftUpdatedAt: null,
			wasDirty: null,
			workspaceId: null,
		}
	}
	const hasIdentity = Boolean(
		target.entityType ||
			target.draftId ||
			target.entityId ||
			target.sourceId ||
			target.baseRevisionId ||
			target.workspaceId,
	)
	return {
		entityType: target.entityType,
		draftId: target.draftId,
		entityId: target.entityId,
		sourceId: target.sourceId,
		baseRevisionId: target.baseRevisionId,
		draftUpdatedAt: target.draftUpdatedAt,
		wasDirty: hasIdentity ? target.wasDirty : null,
		workspaceId: target.workspaceId,
	}
}

function currentTargetStatus(
	activeChat: ConversationDumpInput['activeChat'],
	target: ToolExecutionTarget | null,
): ConversationDumpCurrentTargetStatus {
	if (!activeChat) return 'no_active_chat'
	if (!activeChat.targetWorkspaceId) {
		return target?.entityType && target.workspaceId ? 'legacy_resolved' : 'unbound'
	}
	if (!target?.entityType || !target.workspaceId) return 'unavailable'
	return target.workspaceId === activeChat.targetWorkspaceId ? 'resolved' : 'mismatch'
}

function buildEditingTargetDump(input: ConversationDumpInput): ConversationDumpEditingTarget {
	const runIdentity = input.lastRun?.identity ?? null
	return {
		current: {
			chatId: input.activeChat?.id ?? null,
			targetWorkspaceId: input.activeChat?.targetWorkspaceId ?? null,
			status: currentTargetStatus(input.activeChat, input.currentTarget),
			target: dumpTargetIdentity(input.currentTarget),
		},
		lastRun: {
			runId: runIdentity?.runId ?? null,
			chatId: runIdentity?.chatId ?? null,
			startedAt: runIdentity?.startedAt ?? null,
			completedAt: runIdentity ? (input.lastRun?.completedAt ?? null) : null,
			status: runIdentity ? (input.lastRun?.status ?? null) : null,
			target: dumpTargetIdentity(runIdentity?.target ?? null),
		},
	}
}

function parseToolContent(content: ChatMessage['content']): unknown {
	if (typeof content !== 'string') return null
	try {
		return JSON.parse(content)
	} catch {
		return null
	}
}

export function analyzeConversationDumpMessages(
	messages: readonly ChatMessage[],
	diagnostics?: Record<string, unknown> | null,
): ConversationDumpAnalysis {
	const fingerprints = new Map<string, number>()
	let modelRoundCount = 0
	let toolCallCount = 0
	let toolErrorCount = 0
	let redirectCount = 0
	for (const message of messages) {
		if (message.role === 'assistant') {
			modelRoundCount += 1
			for (const call of message.tool_calls ?? []) {
				toolCallCount += 1
				const fingerprint = `${call.function.name}:${call.function.arguments}`
				fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1)
			}
		}
		if (message.role === 'tool') {
			const value = parseToolContent(message.content)
			if (isToolError(value) || (value as Record<string, unknown> | null)?.ok === false) {
				toolErrorCount += 1
			}
			if ((value as Record<string, unknown> | null)?.kind === 'tool_redirect') redirectCount += 1
		}
	}
	const last = messages.at(-1)
	return {
		modelRoundCount,
		toolCallCount,
		toolErrorCount,
		redirectCount,
		repeatedToolCalls: [...fingerprints.entries()]
			.filter(([, count]) => count > 1)
			.map(([fingerprint, count]) => ({ fingerprint, count })),
		completedWithAssistant: last?.role === 'assistant' && Boolean(last.content),
		endedOnToolResult: last?.role === 'tool',
		stopReason: typeof diagnostics?.stopReason === 'string' ? diagnostics.stopReason : null,
	}
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
					targetWorkspaceId: input.activeChat.targetWorkspaceId,
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
			promptProfile: input.promptProfile ?? 'legacy',
		},
		analysis: analyzeConversationDumpMessages(input.messages, input.diagnostics),
		editingTarget: buildEditingTargetDump(input),
		diagnostics: input.diagnostics ?? null,
		references: input.references,
		messageCount: input.messages.length,
		messages: input.messages.map((message, index) => ({
			index,
			role: message.role,
			content: sanitizeContentForConversationDump(message.content),
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
