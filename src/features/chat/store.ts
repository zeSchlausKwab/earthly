/**
 * Chat Store - Zustand store for Routstr AI chat
 */
import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
	ChatMessage,
	ChatMessageContent,
	RoutstrModel,
	ToolCall,
	ProviderType,
	ProviderConfig,
} from './routstr'
import type { EntityType } from '@/components/entity-search'
import {
	fetchModels,
	streamChatCompletion,
	estimateTokens,
	estimateMaxCost,
	BUILTIN_PROVIDERS,
} from './routstr'
import {
	createMapContextSystemMessage,
	getGeoTools,
	executeToolCall,
	consumeMapSnapshot,
	compactToolMessageContentForPrompt,
} from './tools'
import { getWalletSnapshot, receiveCashuToken, sendCashuToken } from '@/lib/wallet'
import { detectVisionSupport } from './vision/detectVisionSupport'
import { gateToolsForVision } from './vision/gateToolsForVision'
const DEFAULT_MINT_KEY = 'nip60_default_mint'
import { toast } from 'sonner'

// Output is NOT artificially capped. We size the completion budget from the
// room left in the context window (see deriveOutputBudget). The constants below
// are floors/margins, never a fixed truncation cap.
//
// MIN_OUTPUT_BUDGET_TOKENS: a floor so every request — especially a tool call —
//   always has room to emit something, even when the prompt is large.
// OUTPUT_BUDGET_SAFETY_TOKENS: kept clear of the context window so prompt +
//   completion never collides with the model's hard limit.
const MIN_OUTPUT_BUDGET_TOKENS = 1024
const OUTPUT_BUDGET_SAFETY_TOKENS = 512
const CONTEXT_SAFETY_TOKENS = 256
const LMSTUDIO_CONTEXT_SAFETY_TOKENS = 1536
const MIN_PROMPT_BUDGET_TOKENS = 512
// Fraction of the context window reserved for completion when trimming the
// prompt. The prompt still gets the lion's share; this only guarantees the
// completion is never starved down to a fixed sliver (old behavior reserved a
// fixed `maxTokens` slice regardless of window size).
const COMPLETION_RESERVE_FRACTION = 0.25
// Cost-estimation fallback when the context window is unknown for a paid model.
// Mirrors routstr.estimateMaxCost's own default so prepay/refund stay consistent.
const PAID_OUTPUT_BUDGET_FALLBACK_TOKENS = 4096
const DEFAULT_LMSTUDIO_CONTEXT_TOKENS = 4096
const DEFAULT_OLLAMA_CONTEXT_TOKENS = 8192
const DEFAULT_GENERIC_CONTEXT_TOKENS = 16384
const LMSTUDIO_HARD_CONTEXT_CAP_TOKENS = 4096
const MAX_USER_MESSAGE_CHARS = 6000
const MAX_ASSISTANT_MESSAGE_CHARS = 8000
const MAX_TOOL_MESSAGE_CHARS = 12000
const MAX_SYSTEM_MESSAGE_CHARS = 1800
const MAX_REASONING_CONTENT_CHARS = 4000
const BUDGET_ESTIMATE_CHARS_PER_TOKEN = 2
const MESSAGE_TOKEN_OVERHEAD = 24
const MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE = 16000
const STREAM_STALL_WARNING_MS = 15000
const STREAM_STALL_TIMEOUT_MS = 45000
const OVERLOAD_RETRY_DELAYS_MS = [1500, 4000]

type StreamProgressKind =
	| 'request_start'
	| 'token'
	| 'reasoning'
	| 'tool_calls'
	| 'tool_result'
	| 'round_complete'
	| 'complete'
	| 'error'

type StreamPhase =
	| 'idle'
	| 'requesting'
	| 'streaming'
	| 'executing_tools'
	| 'recovering_context'
	| 'finalizing'

interface ChatDiagnostics {
	provider: ProviderType | null
	modelId: string | null
	modelReportedContextTokens: number | null
	effectiveContextTokens: number | null
	promptBudgetTokens: number | null
	mapContextTokens: number | null
	estimatedPromptTokens: number | null
	estimatedCompletionTokens: number | null
	finishReason: string | null
	requestMessageCount: number
	toolCallCount: number
	round: number
	startedAt: number | null
	completedAt: number | null
}

const EMPTY_CHAT_DIAGNOSTICS: ChatDiagnostics = {
	provider: null,
	modelId: null,
	modelReportedContextTokens: null,
	effectiveContextTokens: null,
	promptBudgetTokens: null,
	mapContextTokens: null,
	estimatedPromptTokens: null,
	estimatedCompletionTokens: null,
	finishReason: null,
	requestMessageCount: 0,
	toolCallCount: 0,
	round: 0,
	startedAt: null,
	completedAt: null,
}

const DEFAULT_CHAT_TITLE = 'New chat'
const MAX_CHAT_TITLE_CHARS = 60

export interface ChatSession {
	id: string
	title: string
	messages: ChatMessage[]
	references: ChatReference[]
	createdAt: number
	updatedAt: number
}

export interface ChatReference {
	id: string
	name: string
	type: EntityType
	subtitle?: string
	address?: string
	pubkey?: string
	createdAt?: number
}

export interface ProviderOverride {
	baseUrl: string
	apiKey: string
}

export interface ProviderOverrideMap {
	lmstudio: ProviderOverride
	ollama: ProviderOverride
	custom: ProviderOverride
}

export interface ChatSettingsSnapshot {
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	selectedModel: string | null
	toolsEnabled: boolean
	version?: 2
}

/**
 * Observable lifecycle of the encrypted-settings load (D-11/D-12). Promoted from the sync
 * hook's internal refs so the settings UI can render loading / failed(+Retry) / loaded /
 * no-signer states distinctly instead of silently masquerading a decrypt failure as defaults.
 */
export type SettingsStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'no-signer'

export const DEFAULT_CHAT_SETTINGS: ChatSettingsSnapshot = {
	provider: 'routstr',
	providerOverrides: {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	},
	selectedModel: null,
	toolsEnabled: true,
	version: 2,
}

function createChatId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function trimChatTitle(title: string): string {
	if (title.length <= MAX_CHAT_TITLE_CHARS) return title
	return `${title.slice(0, MAX_CHAT_TITLE_CHARS)}...`
}

function buildChatTitle(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find((message) => message.role === 'user')
	if (!firstUserMessage) return DEFAULT_CHAT_TITLE
	const content = messageContentToText(firstUserMessage.content)
	const normalized = content.replace(/\s+/g, ' ').trim()
	if (!normalized) return DEFAULT_CHAT_TITLE
	return trimChatTitle(normalized)
}

function createEmptyChatSession(): ChatSession {
	const now = Date.now()
	return {
		id: createChatId(),
		title: DEFAULT_CHAT_TITLE,
		messages: [],
		references: [],
		createdAt: now,
		updatedAt: now,
	}
}

function applyMessagesToActiveChat(
	chatSessions: ChatSession[],
	activeChatId: string | null,
	messages: ChatMessage[],
): ChatSession[] {
	const nextSessions = chatSessions.map((chat) => {
		if (chat.id !== activeChatId) return chat
		return {
			...chat,
			messages,
			references: chat.references ?? [],
			title: buildChatTitle(messages),
			updatedAt: Date.now(),
		}
	})
	if (nextSessions.some((chat) => chat.id === activeChatId)) return nextSessions

	const fallback = createEmptyChatSession()
	return [
		...nextSessions,
		{
			...fallback,
			id: activeChatId ?? fallback.id,
			messages,
			title: buildChatTitle(messages),
			references: [],
		},
	]
}

function hasChatSession(chatSessions: ChatSession[], chatId: string | null): boolean {
	if (!chatId) return false
	return chatSessions.some((chat) => chat.id === chatId)
}

function applyReferencesToActiveChat(
	chatSessions: ChatSession[],
	activeChatId: string | null,
	references: ChatReference[],
): ChatSession[] {
	const nextSessions = chatSessions.map((chat) => {
		if (chat.id !== activeChatId) return chat
		return {
			...chat,
			references,
			updatedAt: Date.now(),
		}
	})
	if (nextSessions.some((chat) => chat.id === activeChatId)) return nextSessions

	const fallback = createEmptyChatSession()
	return [
		...nextSessions,
		{
			...fallback,
			id: activeChatId ?? fallback.id,
			references,
		},
	]
}

function sortChatSessionsByRecent(chatSessions: ChatSession[]): ChatSession[] {
	return [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function messageContentToText(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content
	if (!content) return ''

	return content
		.map((part) => {
			if (part.type === 'text') return part.text
			if (part.type === 'image_url') return part.image_url?.url ?? '[image]'
			return ''
		})
		.join(' ')
}

function messageReasoningToText(reasoningContent: ChatMessage['reasoning_content']): string {
	return typeof reasoningContent === 'string' ? reasoningContent : ''
}

function truncateTextForPrompt(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	return `${text.slice(0, maxChars)}\n...[truncated for context window]`
}

/**
 * WR-08: a composed user message carries an attached dataset as a JSON text part
 * `{"ingestHandle":...,"ingestSummary":{...}}` (composeOutboundContent). Blindly
 * char-truncating that part to MAX_USER_MESSAGE_CHARS can cut the JSON mid-string
 * → invalid JSON → the model loses `ingestHandle` and can't call
 * `place_dataset_features`. Instead, if a text part IS the ingest-handle JSON and
 * is over budget, shrink it FIELD-WISE (drop the bulky `sampleRows`, then the
 * schema tail) so the result stays parseable JSON with `ingestHandle` ALWAYS
 * intact. Returns the (possibly shrunk) JSON string, or `undefined` if the part
 * is not an ingest-handle part (caller falls back to plain char-truncation).
 */
export function compactIngestHandlePartForPrompt(
	text: string,
	maxChars: number,
): string | undefined {
	if (text.length <= maxChars) {
		// Only claim this part if it actually IS the ingest-handle shape; otherwise
		// let the caller treat it as a normal text part.
		return isIngestHandleJson(text) ? text : undefined
	}

	let parsed: { ingestHandle?: unknown; ingestSummary?: Record<string, unknown> }
	try {
		parsed = JSON.parse(text)
	} catch {
		return undefined
	}
	if (typeof parsed.ingestHandle !== 'string' || !parsed.ingestSummary) {
		return undefined
	}

	const summary = { ...parsed.ingestSummary }
	// 1. Drop the bulkiest field first: the row sample.
	if ('sampleRows' in summary) {
		summary.sampleRows = []
		summary.sampleRowsOmittedForPrompt = true
	}
	let candidate = JSON.stringify({ ingestHandle: parsed.ingestHandle, ingestSummary: summary })

	// 2. Still too big (very wide schema)? Trim the schema from the tail until it
	//    fits, recording how many columns were dropped.
	if (candidate.length > maxChars && Array.isArray(summary.schema)) {
		const schema = summary.schema as unknown[]
		let kept = schema.length
		while (kept > 0 && candidate.length > maxChars) {
			kept -= 1
			summary.schema = schema.slice(0, kept)
			summary.schemaTruncatedForPrompt = schema.length - kept
			candidate = JSON.stringify({
				ingestHandle: parsed.ingestHandle,
				ingestSummary: summary,
			})
		}
	}

	// 3. Floor: a minimal handle-only object is tiny and ALWAYS parseable, so the
	//    handle is never lost even if maxChars is pathologically small.
	if (candidate.length > maxChars) {
		candidate = JSON.stringify({
			ingestHandle: parsed.ingestHandle,
			ingestSummary: {
				handleId: summary.handleId,
				fileName: summary.fileName,
				type: summary.type,
				rowCount: summary.rowCount,
				columnCount: summary.columnCount,
				truncatedForPrompt: true,
			},
		})
	}

	return candidate
}

function isIngestHandleJson(text: string): boolean {
	// Cheap prefix gate before a full parse.
	if (!text.startsWith('{') || !text.includes('"ingestHandle"')) return false
	try {
		const parsed = JSON.parse(text) as { ingestHandle?: unknown; ingestSummary?: unknown }
		return typeof parsed.ingestHandle === 'string' && !!parsed.ingestSummary
	} catch {
		return false
	}
}

/**
 * Describe a terminal model turn that produced NO content and NO tool calls.
 *
 * Without this the agent loop would end the turn silently (set idle, append no
 * message, surface nothing) — the user sees the spinner stop with no outcome.
 * Output is no longer artificially capped (the budget is derived from the
 * context window), so `finishReason: 'length'` now means the model genuinely
 * exhausted the context-derived output room — e.g. a reasoning-heavy endpoint on
 * a small window — or the model returned a genuinely empty completion. We turn
 * that into a visible notice routed through the same `error` surface ChatPanel
 * already renders for failures.
 *
 * Returns the user-facing copy plus a `truncated` flag (true only for the
 * token-limit case) so callers / tests can distinguish the two outcomes.
 */
export function describeEmptyCompletion(finishReason: string | null | undefined): {
	message: string
	truncated: boolean
} {
	if (finishReason === 'length') {
		return {
			message:
				'The response was cut off — the model ran out of room in its context ' +
				'window. Shorten the prompt/context (or use a model with a larger ' +
				'context window) and retry.',
			truncated: true,
		}
	}
	const reasonLabel = finishReason ?? 'none'
	return {
		message: `The model returned an empty response (finish reason: ${reasonLabel}).`,
		truncated: false,
	}
}

/**
 * Suffix appended to a non-empty assistant message when the model still hit its
 * output-token limit (`finishReason: 'length'`), so truncation stays visible even
 * when partial content was produced.
 */
export const TRUNCATION_CONTENT_SUFFIX = '\n\n_(response truncated — hit output-token limit)_'

function getMessageCharLimit(role: ChatMessage['role']): number {
	switch (role) {
		case 'tool':
			return MAX_TOOL_MESSAGE_CHARS
		case 'assistant':
			return MAX_ASSISTANT_MESSAGE_CHARS
		case 'system':
			return MAX_SYSTEM_MESSAGE_CHARS
		default:
			return MAX_USER_MESSAGE_CHARS
	}
}

function sanitizeMessageForPrompt(message: ChatMessage): ChatMessage {
	const maxChars = getMessageCharLimit(message.role)
	const { content } = message
	const reasoning_content =
		typeof message.reasoning_content === 'string'
			? truncateTextForPrompt(message.reasoning_content, MAX_REASONING_CONTENT_CHARS)
			: message.reasoning_content

	if (typeof content === 'string') {
		const normalizedContent =
			message.role === 'tool' ? compactToolMessageContentForPrompt(content) : content
		return {
			...message,
			content: truncateTextForPrompt(normalizedContent, maxChars),
			reasoning_content,
		}
	}

	if (!content) {
		return {
			...message,
			reasoning_content,
		}
	}

	let remainingChars = maxChars
	const sanitizedParts = content
		.map((part) => {
			if (part.type !== 'text') return part
			if (remainingChars <= 0) {
				return null
			}

			// WR-08: never char-truncate the ingest-handle JSON part (it would cut
			// the JSON mid-string and lose `ingestHandle`). Shrink it field-wise so
			// it stays parseable with the handle intact.
			const ingestCompacted = compactIngestHandlePartForPrompt(part.text, remainingChars)
			if (ingestCompacted !== undefined) {
				remainingChars -= ingestCompacted.length
				return { ...part, text: ingestCompacted }
			}

			const truncated = truncateTextForPrompt(part.text, remainingChars)
			remainingChars -= truncated.length
			return { ...part, text: truncated }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: sanitizedParts.length > 0 ? sanitizedParts : '',
		reasoning_content,
	}
}

function estimateMessageTokensForBudget(message: ChatMessage): number {
	const contentText = messageContentToText(message.content)
	const reasoningText = messageReasoningToText(message.reasoning_content)
	const toolCallsText = message.tool_calls ? JSON.stringify(message.tool_calls) : ''
	const combined = `${contentText}${reasoningText}${toolCallsText}`
	return Math.ceil(combined.length / BUDGET_ESTIMATE_CHARS_PER_TOKEN) + MESSAGE_TOKEN_OVERHEAD
}

function truncateMessageToTokenBudget(message: ChatMessage, budgetTokens: number): ChatMessage {
	const maxChars = Math.max(128, budgetTokens * BUDGET_ESTIMATE_CHARS_PER_TOKEN)
	const { content } = message
	const reasoning_content =
		typeof message.reasoning_content === 'string'
			? truncateTextForPrompt(message.reasoning_content, maxChars)
			: message.reasoning_content

	if (typeof content === 'string') {
		const normalizedContent =
			message.role === 'tool' ? compactToolMessageContentForPrompt(content) : content
		return {
			...message,
			content: truncateTextForPrompt(normalizedContent, maxChars),
			reasoning_content,
		}
	}

	if (!content) {
		return {
			...message,
			content: '[content omitted for context window]',
			reasoning_content,
		}
	}

	let remainingChars = maxChars
	const truncatedParts = content
		.map((part) => {
			if (remainingChars <= 0) return null

			if (part.type === 'text') {
				const truncated = truncateTextForPrompt(part.text, remainingChars)
				remainingChars -= truncated.length
				return { ...part, text: truncated }
			}

			const imageUrl = part.image_url?.url ?? ''
			if (imageUrl.length <= remainingChars) {
				remainingChars -= imageUrl.length
				return part
			}

			const placeholder = '[image omitted for context window]'
			if (placeholder.length > remainingChars) return null
			remainingChars -= placeholder.length
			return { type: 'text' as const, text: placeholder }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: truncatedParts.length > 0 ? truncatedParts : '[content omitted for context window]',
		reasoning_content,
	}
}

function getEffectiveContextTokens(model: RoutstrModel, provider: ProviderConfig): number {
	if (provider.type === 'lmstudio') {
		// LM Studio often reports the model's theoretical max context while the runtime
		// slot may be smaller (commonly 4096). Use a hard cap for safe prompt trimming.
		const reported =
			typeof model.contextLength === 'number' && model.contextLength > 0
				? model.contextLength
				: DEFAULT_LMSTUDIO_CONTEXT_TOKENS
		return Math.min(reported, LMSTUDIO_HARD_CONTEXT_CAP_TOKENS)
	}

	if (typeof model.contextLength === 'number' && model.contextLength > 0) {
		return model.contextLength
	}

	switch (provider.type) {
		case 'ollama':
			return DEFAULT_OLLAMA_CONTEXT_TOKENS
		default:
			return DEFAULT_GENERIC_CONTEXT_TOKENS
	}
}

export function getPromptBudgetTokens(model: RoutstrModel, provider: ProviderConfig): number {
	const contextTokens = getEffectiveContextTokens(model, provider)
	// Reserve a proportional completion slice (not a fixed sliver) so a short
	// prompt does NOT eat the whole window and starve the output. The prompt
	// still gets the remainder, which on a large window is the vast majority.
	const completionReserve = Math.max(
		MIN_OUTPUT_BUDGET_TOKENS,
		Math.floor(contextTokens * COMPLETION_RESERVE_FRACTION),
	)
	const safetyTokens =
		provider.type === 'lmstudio' ? LMSTUDIO_CONTEXT_SAFETY_TOKENS : CONTEXT_SAFETY_TOKENS
	return Math.max(MIN_PROMPT_BUDGET_TOKENS, contextTokens - completionReserve - safetyTokens)
}

/**
 * Derive the output-token budget for a single request from the room left in the
 * context window AFTER the prompt — the model is no longer artificially capped.
 *
 * Returns both:
 *  - `maxTokens`: the value to send as `max_tokens`. `undefined` means OMIT the
 *    field entirely (free/local providers run to their natural stop within the
 *    context window — no truncation).
 *  - `costTokens`: the same budget expressed as a concrete number, used for paid
 *    prepay/refund cost estimation so prepayment NEVER underpays.
 *
 * The two values are derived from one number so cost estimation and the actual
 * request stay consistent for paid providers.
 */
export function deriveOutputBudget(
	model: RoutstrModel,
	provider: ProviderConfig,
	estimatedPromptTokens: number,
): { maxTokens: number | undefined; costTokens: number } {
	const contextTokens = getEffectiveContextTokens(model, provider)
	// Room left after the prompt, kept clear of the window's hard edge. Floored
	// so a tool call always has room even when the prompt is large.
	const remaining = contextTokens - estimatedPromptTokens - OUTPUT_BUDGET_SAFETY_TOKENS
	const derived =
		contextTokens > 0
			? Math.max(MIN_OUTPUT_BUDGET_TOKENS, remaining)
			: PAID_OUTPUT_BUDGET_FALLBACK_TOKENS

	if (!provider.requiresPayment) {
		// Free/local (lmstudio, ollama, custom): omit max_tokens so the model is
		// not truncated. costTokens is unused for these (no payment) but reported
		// for diagnostics/consistency.
		return { maxTokens: undefined, costTokens: derived }
	}

	// Paid (routstr/cashu): send the derived budget so prepay reserves against it
	// and refunds the unused remainder. Same number drives estimateMaxCost.
	return { maxTokens: derived, costTokens: derived }
}

function trimMessagesToPromptBudget(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
	if (messages.length === 0) return messages
	const sanitized = messages.map(sanitizeMessageForPrompt)
	const selected: ChatMessage[] = []
	let usedTokens = 0

	for (let i = sanitized.length - 1; i >= 0; i--) {
		let candidate = sanitized[i]
		if (!candidate) continue
		let candidateTokens = estimateMessageTokensForBudget(candidate)

		if (usedTokens + candidateTokens > budgetTokens) {
			if (selected.length === 0) {
				candidate = truncateMessageToTokenBudget(candidate, budgetTokens)
				candidateTokens = estimateMessageTokensForBudget(candidate)
				if (candidateTokens > budgetTokens) {
					candidate = {
						...candidate,
						content: '[message truncated for context window]',
					}
				}
				selected.unshift(candidate)
			}
			break
		}

		usedTokens += candidateTokens
		selected.unshift(candidate)
	}

	while (selected.length > 1 && selected[0]?.role === 'tool') {
		selected.shift()
	}

	if (selected.length > 0) {
		return selected
	}

	const fallback = sanitized.at(-1)
	if (!fallback) return []
	return [truncateMessageToTokenBudget(fallback, budgetTokens)]
}

function providerMayRequireReasoningContent(provider: ProviderConfig, modelId: string): boolean {
	if (provider.type !== 'custom') return false
	const lowerModel = modelId.toLowerCase()
	const lowerBaseUrl = provider.baseUrl.toLowerCase()
	return lowerModel.includes('kimi') || lowerBaseUrl.includes('moonshot.ai')
}

function ensureReasoningContentForToolMessages(
	messages: ChatMessage[],
	required: boolean,
): ChatMessage[] {
	if (!required) return messages
	return messages.map((message) => {
		if (message.role !== 'assistant' || !message.tool_calls?.length) {
			return message
		}
		return {
			...message,
			reasoning_content:
				typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
		}
	})
}

function tryExtractSnapshotId(toolResultContent: string): string | null {
	try {
		const parsed = JSON.parse(toolResultContent) as Record<string, unknown>
		return typeof parsed.snapshotId === 'string' ? parsed.snapshotId : null
	} catch {
		return null
	}
}

function isContextOverflowError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	return (
		lower.includes('exceeds the available context size') ||
		lower.includes('cannot truncate prompt with n_keep') ||
		lower.includes('n_ctx')
	)
}

function isTransientProviderOverloadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	return (
		lower.includes('currently overloaded') ||
		lower.includes('server is busy') ||
		lower.includes('rate limit') ||
		lower.includes('too many requests') ||
		lower.includes('503') ||
		lower.includes('429')
	)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildEmergencyRetryMessages(conversationMessages: ChatMessage[]): ChatMessage[] {
	const sanitized = conversationMessages.map(sanitizeMessageForPrompt)
	const recentUserMessages = sanitized
		.filter((message) => message.role === 'user')
		.slice(-2)
		.map((message) => truncateMessageToTokenBudget(message, 220))
	const latestToolMessage = [...sanitized].reverse().find((message) => message.role === 'tool')

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'Context window recovery mode.',
				'Preserve user intent from recent turns.',
				'If user asks to draw/edit map features, call tools directly with sensible defaults instead of asking to restate.',
				'Keep output concise.',
			].join(' '),
		},
	]

	if (latestToolMessage) {
		messages.push({
			role: 'system',
			content: `Most recent tool output excerpt:\n${truncateTextForPrompt(
				messageContentToText(latestToolMessage.content),
				900,
			)}`,
		})
	}

	if (recentUserMessages.length === 0) {
		messages.push({ role: 'user', content: 'Continue with a concise response.' })
		return messages
	}

	messages.push(...recentUserMessages)
	return messages
}

export function resolveProvider(
	type: ProviderType,
	providerOverrides: ProviderOverrideMap,
): ProviderConfig {
	if (type === 'custom') {
		const override = providerOverrides.custom
		return {
			type: 'custom',
			baseUrl: override.baseUrl,
			apiKey: override.apiKey || undefined,
			name: 'Custom',
			requiresPayment: false,
		}
	}
	if (type === 'routstr') {
		return BUILTIN_PROVIDERS.routstr
	}
	// lmstudio / ollama: use override baseUrl when non-empty, else BUILTIN localhost default.
	// Guard against an unexpected `type` or a missing override map key (WR-03/WR-04): indexing
	// BUILTIN_PROVIDERS / providerOverrides with an unvalidated key can yield undefined, and the
	// subsequent spread/`.baseUrl` access would throw or produce a malformed ProviderConfig.
	const builtin = BUILTIN_PROVIDERS[type]
	if (!builtin) {
		// Unknown provider type slipped past validation — fall back to a known-good builtin
		// rather than crash downstream model loading.
		return BUILTIN_PROVIDERS.lmstudio
	}
	const override = providerOverrides[type]
	return {
		...builtin,
		baseUrl: override?.baseUrl || builtin.baseUrl,
		apiKey: override?.apiKey || undefined,
	}
}

interface ChatState {
	// Provider
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	// Sessions
	chatSessions: ChatSession[]
	activeChatId: string | null
	// Messages
	messages: ChatMessage[]
	// Models
	models: RoutstrModel[]
	selectedModel: string | null
	modelsLoading: boolean
	modelsError: string | null
	// Encrypted-settings load lifecycle (observable surface for the settings UI; D-11/D-12)
	settingsStatus: SettingsStatus
	settingsError: string | null
	settingsLoadNonce: number
	// Bumped by an explicit user-initiated import (D-09); clears the sync hook's
	// "load failed / not safe to save" guard so the recovery write is allowed (CR-01).
	settingsImportNonce: number
	// Settings
	toolsEnabled: boolean // Whether to send tools with requests
	// Chat state
	isStreaming: boolean
	streamingContent: string
	pendingToolCalls: ToolCall[] // Tool calls waiting to be executed
	executingTools: boolean // Whether we're currently executing tools
	streamPhase: StreamPhase
	streamWarning: string | null
	lastProgressAt: number | null
	lastProgressKind: StreamProgressKind | null
	error: string | null
	diagnostics: ChatDiagnostics
	references: ChatReference[]
	// Stats
	totalSpent: number // Total sats spent in this session
	totalRefunded: number // Total sats refunded
}

interface ChatActions {
	// Provider
	setProvider: (provider: ProviderType) => void
	setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) => void
	// Model management
	loadModels: () => Promise<void>
	setSelectedModel: (modelId: string) => void
	// Settings
	setToolsEnabled: (enabled: boolean) => void
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => void
	setSettingsStatus: (status: SettingsStatus, error?: string | null) => void
	requestSettingsReload: () => void
	notifySettingsImported: () => void
	// Message management
	addMessage: (message: ChatMessage) => void
	clearMessages: () => void
	createChat: () => void
	switchChat: (chatId: string) => void
	deleteChat: (chatId: string) => void
	setReferences: (references: ChatReference[]) => void
	// Chat actions
	sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>
	cancelStream: () => void
	// Reset
	reset: () => void
}

interface SendMessageOptions {
	referenceContextMessage?: string
	selectionContextMessage?: string
	geometryContextMessage?: string
	geometryAttachment?: FeatureCollection | null
	/**
	 * The D-11 composed outbound content (ChatPanel `composeOutboundContent`):
	 * attached datasets as `{ ingestHandle, ingestSummary }` text parts + gated
	 * `image_url` parts. When present it OVERRIDES the plain-string `content` as
	 * the user message — carrying the handle+summary, never `fullRows`.
	 */
	composedContent?: ChatMessageContent
}

type ChatStore = ChatState & ChatActions

function createInitialState(): ChatState {
	const initialChat = createEmptyChatSession()
	return {
		...DEFAULT_CHAT_SETTINGS,
		chatSessions: [initialChat],
		activeChatId: initialChat.id,
		messages: [],
		models: [],
		selectedModel: null,
		modelsLoading: false,
		modelsError: null,
		settingsStatus: 'idle',
		settingsError: null,
		settingsLoadNonce: 0,
		settingsImportNonce: 0,
		toolsEnabled: true,
		isStreaming: false,
		streamingContent: '',
		pendingToolCalls: [],
		executingTools: false,
		streamPhase: 'idle',
		streamWarning: null,
		lastProgressAt: null,
		lastProgressKind: null,
		error: null,
		diagnostics: EMPTY_CHAT_DIAGNOSTICS,
		references: initialChat.references,
		totalSpent: 0,
		totalRefunded: 0,
	}
}

const initialState: ChatState = createInitialState()

/**
 * persist `partialize` allow-list. ONLY `chatSessions` + `activeChatId` may cross into the
 * `chat-store` localStorage blob — secret-bearing settings (`providerOverrides[*].apiKey`)
 * must NEVER persist here (SC-1 / T-01-01). Settings flow exclusively through the encrypted
 * envelope in `settingsStorage.ts`. Exported so unit tests can assert the serialized shape.
 */
export function chatStorePartialize(
	state: ChatState,
): Pick<ChatState, 'chatSessions' | 'activeChatId'> {
	return {
		chatSessions: state.chatSessions,
		activeChatId: state.activeChatId,
	}
}

// AbortController for canceling streams
let streamAbortController: AbortController | null = null
let currentStreamRunId = 0
let currentStreamingChatId: string | null = null
const DETACHED_STREAM_ERROR = 'Chat stream was canceled or detached from its session.'

export const useChatStore = create<ChatStore>()(
	persist(
		(set, get) => ({
			...initialState,

			setProvider: (providerType: ProviderType) => {
				set({ provider: providerType, models: [], selectedModel: null, modelsError: null })
				get().loadModels()
			},

			setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) => {
				if (type === 'routstr') return
				set((state) => ({
					providerOverrides: {
						...state.providerOverrides,
						[type]: { ...state.providerOverrides[type], ...patch },
					},
				}))
			},

			loadModels: async () => {
				const { provider, providerOverrides } = get()
				const providerConfig = resolveProvider(provider, providerOverrides)

				if (provider === 'custom' && !providerOverrides.custom.baseUrl) {
					set({ modelsError: 'Enter an endpoint URL first' })
					return
				}

				set({ modelsLoading: true, modelsError: null })
				try {
					const models = await fetchModels(providerConfig)
					const selectedModel = get().selectedModel
					set({
						models,
						modelsLoading: false,
						selectedModel:
							selectedModel && models.find((m) => m.id === selectedModel)
								? selectedModel
								: (models[0]?.id ?? null),
					})
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to load models'
					set({ modelsLoading: false, modelsError: message })
				}
			},

			setSelectedModel: (modelId: string) => {
				set({ selectedModel: modelId })
			},

			setToolsEnabled: (enabled: boolean) => {
				set({ toolsEnabled: enabled })
			},

			hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => {
				const incomingOverrides = settings.providerOverrides
				set({
					provider: settings.provider ?? DEFAULT_CHAT_SETTINGS.provider,
					providerOverrides: {
						lmstudio:
							incomingOverrides?.lmstudio ?? DEFAULT_CHAT_SETTINGS.providerOverrides.lmstudio,
						ollama: incomingOverrides?.ollama ?? DEFAULT_CHAT_SETTINGS.providerOverrides.ollama,
						custom: incomingOverrides?.custom ?? DEFAULT_CHAT_SETTINGS.providerOverrides.custom,
					},
					selectedModel: settings.selectedModel ?? DEFAULT_CHAT_SETTINGS.selectedModel,
					toolsEnabled: settings.toolsEnabled ?? DEFAULT_CHAT_SETTINGS.toolsEnabled,
					models: [],
					modelsLoading: false,
					modelsError: null,
				})
			},

			setSettingsStatus: (status: SettingsStatus, error?: string | null) => {
				set({ settingsStatus: status, settingsError: error ?? null })
			},

			// Retry trigger (D-11). Only bumps the nonce the load effect depends on; it must
			// NOT call the loader directly so Retry re-enters the generation-counter guard
			// (Pitfall 2) and an in-flight stale load cannot clobber the retry result.
			requestSettingsReload: () => {
				set((state) => ({ settingsLoadNonce: state.settingsLoadNonce + 1 }))
			},

			// Signals the sync hook that the user explicitly replaced settings via import (D-09).
			// Bumping this nonce clears the hook's load-failed guard so the debounced save effect
			// is allowed to re-encrypt the imported snapshot — the recovery path CR-01 protects.
			notifySettingsImported: () => {
				set((state) => ({ settingsImportNonce: state.settingsImportNonce + 1 }))
			},

			addMessage: (message: ChatMessage) => {
				set((state) => ({
					messages: [...state.messages, message],
					chatSessions: applyMessagesToActiveChat(state.chatSessions, state.activeChatId, [
						...state.messages,
						message,
					]),
				}))
			},

			clearMessages: () => {
				set((state) => ({
					messages: [],
					chatSessions: applyMessagesToActiveChat(state.chatSessions, state.activeChatId, []),
					totalSpent: 0,
					totalRefunded: 0,
					error: null,
					streamWarning: null,
					streamPhase: 'idle',
					lastProgressAt: null,
					lastProgressKind: null,
					diagnostics: EMPTY_CHAT_DIAGNOSTICS,
				}))
			},

			createChat: () => {
				if (get().isStreaming) return
				const chat = createEmptyChatSession()
				set((state) => ({
					chatSessions: sortChatSessionsByRecent([...state.chatSessions, chat]),
					activeChatId: chat.id,
					messages: [],
					totalSpent: 0,
					totalRefunded: 0,
					error: null,
					streamWarning: null,
					streamPhase: 'idle',
					lastProgressAt: null,
					lastProgressKind: null,
					diagnostics: EMPTY_CHAT_DIAGNOSTICS,
				}))
			},

			switchChat: (chatId: string) => {
				if (get().isStreaming) return
				set((state) => {
					const target = state.chatSessions.find((chat) => chat.id === chatId)
					if (!target) return {}
					return {
						activeChatId: target.id,
						messages: target.messages,
						references: target.references ?? [],
						error: null,
						streamWarning: null,
						streamPhase: 'idle',
						lastProgressAt: null,
						lastProgressKind: null,
						diagnostics: EMPTY_CHAT_DIAGNOSTICS,
					}
				})
			},

			deleteChat: (chatId: string) => {
				if (currentStreamingChatId === chatId && streamAbortController) {
					currentStreamRunId += 1
					streamAbortController.abort()
					streamAbortController = null
					currentStreamingChatId = null
				} else if (get().isStreaming) {
					return
				}
				set((state) => {
					const remaining = state.chatSessions.filter((chat) => chat.id !== chatId)
					const ensured = remaining.length > 0 ? remaining : [createEmptyChatSession()]
					const nextActiveId = ensured.some((chat) => chat.id === state.activeChatId)
						? state.activeChatId
						: (ensured[0]?.id ?? null)
					const activeChat = ensured.find((chat) => chat.id === nextActiveId)
					return {
						chatSessions: sortChatSessionsByRecent(ensured),
						activeChatId: nextActiveId,
						messages: activeChat?.messages ?? [],
						references: activeChat?.references ?? [],
						error: null,
						streamWarning: null,
						streamPhase: 'idle',
						lastProgressAt: null,
						lastProgressKind: null,
						diagnostics: EMPTY_CHAT_DIAGNOSTICS,
					}
				})
			},

			setReferences: (references: ChatReference[]) => {
				set((state) => ({
					references,
					chatSessions: applyReferencesToActiveChat(
						state.chatSessions,
						state.activeChatId,
						references,
					),
				}))
			},

			sendMessage: async (content: string, options?: SendMessageOptions) => {
				const targetChatId = get().activeChatId
				const { selectedModel, models, toolsEnabled, provider, providerOverrides } = get()
				const providerConfig = resolveProvider(provider, providerOverrides)
				const referenceContextMessage = options?.referenceContextMessage?.trim()
				const selectionContextMessage = options?.selectionContextMessage?.trim()
				const geometryContextMessage = options?.geometryContextMessage?.trim()
				const geometryAttachment = options?.geometryAttachment ?? null

				if (!selectedModel) {
					toast.error('Please select a model first')
					return
				}
				const selectedModelId = selectedModel

				const model = models.find((m) => m.id === selectedModelId)
				if (!model) {
					toast.error('Selected model not found')
					return
				}

				// Check wallet status (only for paid providers)
				if (providerConfig.requiresPayment) {
					const snap = getWalletSnapshot()
					if (!snap.exists || snap.mints.length === 0) {
						toast.error('Wallet not ready. Please initialize your wallet first.')
						return
					}
				}

				// Add user message immediately. The D-11 composed content (datasets as
				// handle+summary + gated image parts) overrides the plain string when
				// attachments are present — fullRows never enter the message.
				const userMessage: ChatMessage = {
					role: 'user',
					content: options?.composedContent ?? content,
				}
				const streamRunId = currentStreamRunId + 1
				currentStreamRunId = streamRunId
				currentStreamingChatId = targetChatId
				set((state) => ({
					messages: [...state.messages, userMessage],
					chatSessions: applyMessagesToActiveChat(state.chatSessions, targetChatId, [
						...state.messages,
						userMessage,
					]),
					isStreaming: true,
					streamingContent: '',
					error: null,
					pendingToolCalls: [],
					streamWarning: null,
					streamPhase: 'requesting',
					lastProgressAt: Date.now(),
					lastProgressKind: 'request_start',
				}))

				const isStreamRunActive = () => {
					const state = get()
					return (
						currentStreamRunId === streamRunId &&
						currentStreamingChatId === targetChatId &&
						hasChatSession(state.chatSessions, targetChatId)
					)
				}

				// Helper to process refund (no-ops when refundToken is null)
				const processRefund = async (refundToken: string | null) => {
					if (refundToken) {
						console.log('[Chat] Received refund token, redeeming...')
						try {
							await receiveCashuToken(refundToken)
						} catch (err) {
							console.error('[Chat] Failed to process refund:', err)
						}
					}
				}

				// Helper to make a streaming request.
				// `outputBudget` is derived per-round from the room left after the
				// prompt: `.maxTokens` is what we send (undefined => omit, i.e. no cap),
				// `.costTokens` is the concrete number used for paid cost estimation so
				// prepay/refund stay consistent and never underpay.
				const makeRequest = async (
					requestMessages: ChatMessage[],
					outputBudget: { maxTokens: number | undefined; costTokens: number },
				): Promise<{
					content: string
					reasoningContent: string
					toolCalls: ToolCall[]
					finishReason?: string
					estimatedCompletionTokens: number
				}> => {
					let cashuToken: string | null | undefined

					// Payment flow only for paid providers
					if (providerConfig.requiresPayment) {
						const totalText = requestMessages
							.map(
								(message) =>
									`${messageContentToText(message.content)} ${messageReasoningToText(message.reasoning_content)}`,
							)
							.join(' ')
						const inputTokens = estimateTokens(totalText)
						// Use the SAME budget number we send as max_tokens so the server's
						// reservation and our prepayment agree (refund returns the rest).
						const estimatedCost = estimateMaxCost(model, inputTokens, outputBudget.costTokens)

						console.log('[Chat] Cost estimate:', {
							inputTokens,
							maxOutputTokens: outputBudget.costTokens,
							estimatedCost,
							modelPricing: model.pricing,
						})

						const snap = getWalletSnapshot()
						if (snap.totalBalance < estimatedCost) {
							throw new Error(
								`Insufficient balance. Need ~${estimatedCost} sats, have ${snap.totalBalance}`,
							)
						}

						const defaultMint =
							typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MINT_KEY) : null
						const mint = defaultMint || snap.mints[0]
						if (!mint) {
							throw new Error('No mint available for payment')
						}

						console.log(`[Chat] Generating ${estimatedCost} sat token for inference`)
						try {
							cashuToken = await sendCashuToken(estimatedCost, { mint })
						} catch (err) {
							throw new Error(
								`Failed to generate payment token: ${err instanceof Error ? err.message : String(err)}`,
							)
						}

						set((state) => ({ totalSpent: state.totalSpent + estimatedCost }))
					}

					return new Promise((resolve, reject) => {
						let accumulatedContent = ''
						let accumulatedReasoningContent = ''
						let accumulatedToolCalls: ToolCall[] = []
						let resultFinishReason: string | undefined
						let settled = false
						let warningTimer: ReturnType<typeof setTimeout> | null = null
						let timeoutTimer: ReturnType<typeof setTimeout> | null = null

						// D-05: read live registry state at request time so MCP-sync
						// register/unregister changes propagate (falls back to the
						// hardcoded bootstrapped entries when sync is inactive/failed).
						//
						// D-08/D-09: do NOT advertise `capture_map_snapshot` to a model that
						// cannot consume the resulting image. Mirror the autonomous-snapshot
						// vision gate (canUseVision) on the ADVERTISED surface so a no-vision
						// (or merely 'uncertain') model never sees the tool, calls it, and
						// then wastes a round reasoning that it cannot view the snapshot.
						const requestTools = toolsEnabled
							? gateToolsForVision(getGeoTools(), canUseVision)
							: undefined
						console.log('[Chat] Request config:', {
							provider: providerConfig.type,
							model: selectedModelId,
							toolsEnabled,
							toolCount: requestTools?.length ?? 0,
							toolNames: requestTools?.map((t) => t.function.name) ?? [],
						})

						const clearTimers = () => {
							if (warningTimer) {
								clearTimeout(warningTimer)
								warningTimer = null
							}
							if (timeoutTimer) {
								clearTimeout(timeoutTimer)
								timeoutTimer = null
							}
						}

						const failStalledRequest = () => {
							if (streamAbortController) {
								streamAbortController.abort()
							}
							if (settled) return
							if (!isStreamRunActive()) return
							settled = true
							clearTimers()
							set({
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
							})
							reject(
								new Error('Stream stalled: no response updates for 45 seconds. Stop and retry.'),
							)
						}

						const refreshActivity = (kind: StreamProgressKind) => {
							if (!isStreamRunActive()) return
							const now = Date.now()
							set({
								lastProgressAt: now,
								lastProgressKind: kind,
								streamWarning: null,
								streamPhase:
									kind === 'request_start'
										? 'requesting'
										: kind === 'tool_calls'
											? 'finalizing'
											: 'streaming',
							})
							clearTimers()
							warningTimer = setTimeout(() => {
								set({
									streamWarning:
										'No stream updates for 15s. The provider may be stuck. You can stop and retry.',
								})
							}, STREAM_STALL_WARNING_MS)
							timeoutTimer = setTimeout(failStalledRequest, STREAM_STALL_TIMEOUT_MS)
						}

						refreshActivity('request_start')

						streamChatCompletion(
							{
								model: selectedModelId,
								messages: requestMessages,
								stream: true,
								// Omitted (undefined) for free/local providers so the model
								// runs to its natural stop within the context window; the
								// derived budget for paid providers.
								max_tokens: outputBudget.maxTokens,
								tools: requestTools,
							},
							{
								onToken: (token: string) => {
									if (settled || !isStreamRunActive()) return
									accumulatedContent += token
									set({ streamingContent: accumulatedContent })
									refreshActivity('token')
								},
								onReasoningToken: (token: string) => {
									if (settled || !isStreamRunActive()) return
									accumulatedReasoningContent += token
									refreshActivity('reasoning')
								},
								onToolCall: (toolCalls: ToolCall[]) => {
									if (settled || !isStreamRunActive()) return
									console.log(
										'[Chat] Received tool calls:',
										toolCalls.map((t) => t.function.name),
									)
									accumulatedToolCalls = toolCalls
									refreshActivity('tool_calls')
								},
								onComplete: async (refundToken: string | null, finishReason?: string) => {
									if (settled) return
									if (!isStreamRunActive()) {
										settled = true
										clearTimers()
										reject(new Error(DETACHED_STREAM_ERROR))
										return
									}
									settled = true
									resultFinishReason = finishReason
									clearTimers()
									set({
										streamWarning: null,
										lastProgressAt: Date.now(),
										lastProgressKind: 'round_complete',
									})
									await processRefund(refundToken)
									resolve({
										content: accumulatedContent,
										reasoningContent: accumulatedReasoningContent,
										toolCalls: accumulatedToolCalls,
										finishReason: resultFinishReason,
										estimatedCompletionTokens: estimateTokens(
											`${accumulatedContent}\n${accumulatedReasoningContent}\n${JSON.stringify(accumulatedToolCalls)}`,
										),
									})
								},
								onError: async (error: Error, refundToken?: string | null) => {
									if (settled) return
									if (!isStreamRunActive()) {
										settled = true
										clearTimers()
										reject(new Error(DETACHED_STREAM_ERROR))
										return
									}
									settled = true
									clearTimers()
									if (refundToken) {
										console.log('[Chat] Processing refund from error response')
										await processRefund(refundToken)
									}
									set({
										streamWarning: null,
										lastProgressAt: Date.now(),
										lastProgressKind: 'error',
									})
									reject(error)
								},
							},
							providerConfig,
							cashuToken || undefined,
							streamAbortController?.signal,
						)
					})
				}

				try {
					streamAbortController = new AbortController()
					let conversationMessages = [...get().messages]
					let oneShotVisionMessages: ChatMessage[] = []
					let oneShotGeometryContextMessage = geometryContextMessage
					let totalToolCalls = 0
					let round = 0
					const effectiveContextTokens = getEffectiveContextTokens(model, providerConfig)
					const requiresReasoningContent = providerMayRequireReasoningContent(
						providerConfig,
						selectedModelId,
					)
					// D-07/D-09: one authoritative, cached, fail-safe vision verdict gates
					// BOTH image paths (user-attached images AND the autonomous
					// capture_map_snapshot one-shot below). Resolved once per request; the
					// per-(type,baseUrl,modelId) cache makes the reuse free.
					const visionSupport = await detectVisionSupport(providerConfig, selectedModelId)
					// The autonomous snapshot path may only send on CONFIRMED 'vision'
					// (acceptance criterion #4 fail-safe). 'uncertain' is opt-in via the
					// Plan 06 UI, never the silent snapshot loop; 'no-vision' is hard-off.
					const canUseVision =
						visionSupport === 'vision' &&
						effectiveContextTokens >= MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE
					const promptBudgetTokens = getPromptBudgetTokens(model, providerConfig)
					const streamStartAt = Date.now()

					set({
						streamPhase: 'requesting',
						streamWarning: null,
						lastProgressAt: streamStartAt,
						lastProgressKind: 'request_start',
						diagnostics: {
							provider: providerConfig.type,
							modelId: selectedModelId,
							modelReportedContextTokens:
								typeof model.contextLength === 'number' ? model.contextLength : null,
							effectiveContextTokens,
							promptBudgetTokens,
							mapContextTokens: null,
							estimatedPromptTokens: null,
							estimatedCompletionTokens: null,
							finishReason: null,
							requestMessageCount: 0,
							toolCallCount: 0,
							round: 0,
							startedAt: streamStartAt,
							completedAt: null,
						},
					})

					// Loop to handle tool calls until the model returns a final answer.
					while (true) {
						if (!isStreamRunActive()) {
							throw new Error(DETACHED_STREAM_ERROR)
						}
						round += 1
						const roundNumber = round
						let requestMessages: ChatMessage[] = [...conversationMessages]
						if (oneShotVisionMessages.length > 0) {
							requestMessages.push(...oneShotVisionMessages)
							oneShotVisionMessages = []
						}

						const systemSections = [
							toolsEnabled ? createMapContextSystemMessage()?.content : null,
							referenceContextMessage || null,
							selectionContextMessage || null,
							oneShotGeometryContextMessage || null,
						]
							.map((section) =>
								typeof section === 'string' ? section.trim() : messageContentToText(section),
							)
							.filter((section): section is string => Boolean(section))
						const combinedSystemMessage: ChatMessage | null =
							systemSections.length > 0
								? {
										role: 'system',
										content: systemSections.join('\n\n'),
									}
								: null

						const combinedSystemTokens = combinedSystemMessage
							? estimateMessageTokensForBudget(sanitizeMessageForPrompt(combinedSystemMessage))
							: 0
						const conversationBudget = Math.max(
							MIN_PROMPT_BUDGET_TOKENS,
							promptBudgetTokens - combinedSystemTokens,
						)
						requestMessages = trimMessagesToPromptBudget(requestMessages, conversationBudget)

						if (combinedSystemMessage) {
							requestMessages = [
								sanitizeMessageForPrompt(combinedSystemMessage),
								...requestMessages,
							]
							oneShotGeometryContextMessage = undefined
						}
						requestMessages = ensureReasoningContentForToolMessages(
							requestMessages,
							requiresReasoningContent,
						)
						const estimatedPromptTokens = estimateTokens(
							requestMessages
								.map(
									(message) =>
										`${messageContentToText(message.content)} ${messageReasoningToText(message.reasoning_content)}`,
								)
								.join('\n'),
						)
						// Output budget is sized per-round from the room left after this
						// round's prompt — no fixed cap. Free/local omit max_tokens; paid
						// send the derived budget (cost estimate uses the same number).
						const outputBudget = deriveOutputBudget(model, providerConfig, estimatedPromptTokens)

						set((state) => ({
							streamPhase: 'streaming',
							lastProgressAt: Date.now(),
							lastProgressKind: 'request_start',
							diagnostics: {
								...state.diagnostics,
								mapContextTokens: combinedSystemTokens,
								requestMessageCount: requestMessages.length,
								estimatedPromptTokens,
								round: roundNumber,
							},
						}))

						let result: {
							content: string
							reasoningContent: string
							toolCalls: ToolCall[]
							finishReason?: string
							estimatedCompletionTokens: number
						} | null = null

						try {
							let lastError: unknown
							for (let attempt = 0; attempt <= OVERLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
								try {
									result = await makeRequest(requestMessages, outputBudget)
									lastError = null
									break
								} catch (error) {
									lastError = error
									if (
										!isTransientProviderOverloadError(error) ||
										attempt >= OVERLOAD_RETRY_DELAYS_MS.length
									) {
										throw error
									}

									const retryDelayMs = OVERLOAD_RETRY_DELAYS_MS[attempt]
									set({
										streamPhase: 'requesting',
										streamWarning: `Provider overloaded. Retrying in ${Math.ceil(
											retryDelayMs / 1000,
										)}s...`,
										lastProgressAt: Date.now(),
										lastProgressKind: 'request_start',
									})
									await sleep(retryDelayMs)
								}
							}
							if (!result && lastError) {
								throw lastError
							}
						} catch (error) {
							if (!isContextOverflowError(error)) {
								throw error
							}

							console.warn('[Chat] Context overflow detected. Retrying with reduced prompt.')
							set({
								streamPhase: 'recovering_context',
								streamWarning:
									'Context overflow detected. Retrying with a reduced prompt window...',
							})
							const emergencyMessages = buildEmergencyRetryMessages(conversationMessages)
							// Re-derive the budget for the reduced prompt so a paid retry's
							// cost estimate matches the smaller request (more room => budget
							// floored, never starved).
							const emergencyPromptTokens = estimateTokens(
								emergencyMessages
									.map(
										(message) =>
											`${messageContentToText(message.content)} ${messageReasoningToText(message.reasoning_content)}`,
									)
									.join('\n'),
							)
							const emergencyOutputBudget = deriveOutputBudget(
								model,
								providerConfig,
								emergencyPromptTokens,
							)
							result = await makeRequest(emergencyMessages, emergencyOutputBudget)
						}
						if (!result) {
							throw new Error('Chat request finished without a result.')
						}

						// If we got tool calls, execute them and continue
						if (result.toolCalls.length > 0) {
							if (!isStreamRunActive()) {
								throw new Error(DETACHED_STREAM_ERROR)
							}
							totalToolCalls += result.toolCalls.length
							set((state) => ({
								executingTools: true,
								streamingContent: '',
								streamPhase: 'executing_tools',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'tool_calls',
								diagnostics: {
									...state.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
								},
							}))

							const normalizedReasoningContent = result.reasoningContent.trim()

							// Add assistant message with tool calls
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content || null,
								tool_calls: result.toolCalls,
								reasoning_content:
									normalizedReasoningContent || (requiresReasoningContent ? '' : undefined),
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set((state) => ({
								messages: conversationMessages,
								chatSessions: applyMessagesToActiveChat(
									state.chatSessions,
									targetChatId,
									conversationMessages,
								),
							}))

							// Execute each tool call
							for (const toolCall of result.toolCalls) {
								console.log(`[Chat] Executing tool: ${toolCall.function.name}`)
								const toolResult = await executeToolCall(toolCall, {
									attachedGeometry: geometryAttachment,
								})

								// Add tool result message
								const toolMessage: ChatMessage = {
									role: 'tool',
									content: toolResult.content,
									tool_call_id: toolResult.tool_call_id,
								}
								conversationMessages = [...conversationMessages, toolMessage]
								set((state) => ({
									messages: conversationMessages,
									chatSessions: applyMessagesToActiveChat(
										state.chatSessions,
										targetChatId,
										conversationMessages,
									),
								}))
								set({
									lastProgressAt: Date.now(),
									lastProgressKind: 'tool_result',
								})

								if (canUseVision && toolCall.function.name === 'capture_map_snapshot') {
									const snapshotId = tryExtractSnapshotId(toolResult.content)
									if (!snapshotId) continue

									const snapshot = consumeMapSnapshot(snapshotId)
									if (!snapshot) continue

									oneShotVisionMessages.push({
										role: 'user',
										content: [
											{
												type: 'text',
												text: 'Map snapshot for visual analysis. Use this image together with the tool outputs.',
											},
											{
												type: 'image_url',
												image_url: {
													url: snapshot.dataUrl,
												},
											},
										],
									})
								}
							}

							set({ executingTools: false })
							// Continue loop to get next response
							continue
						}

						// No tool calls - we're done
						if (result.content) {
							if (!isStreamRunActive()) {
								throw new Error(DETACHED_STREAM_ERROR)
							}
							const normalizedReasoningContent = result.reasoningContent.trim()
							// Truncation visibility even when content WAS produced: append a
							// subtle marker so the user knows the answer is incomplete.
							const truncatedWithContent = result.finishReason === 'length'
							const assistantContent = truncatedWithContent
								? `${result.content}${TRUNCATION_CONTENT_SUFFIX}`
								: result.content
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: assistantContent,
								reasoning_content: normalizedReasoningContent || undefined,
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set((state) => ({
								messages: conversationMessages,
								chatSessions: applyMessagesToActiveChat(
									state.chatSessions,
									targetChatId,
									conversationMessages,
								),
								isStreaming: false,
								streamingContent: '',
								streamPhase: 'idle',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'complete',
								diagnostics: {
									...state.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
									completedAt: Date.now(),
								},
							}))
						} else {
							// Empty completion, no tool calls. Never end the turn silently:
							// surface a visible notice through the same `error` channel
							// ChatPanel renders for failures, with truncation-specific copy
							// when the model hit its output-token limit.
							const { message: emptyNotice } = describeEmptyCompletion(result.finishReason)
							set((state) => ({
								isStreaming: false,
								streamingContent: '',
								streamPhase: 'idle',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
								error: emptyNotice,
								diagnostics: {
									...state.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
									completedAt: Date.now(),
								},
							}))
							toast.error(emptyNotice)
						}
						break
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to send message'
					if (message === DETACHED_STREAM_ERROR) {
						return
					}
					set((state) => ({
						isStreaming: false,
						streamingContent: '',
						executingTools: false,
						streamPhase: 'idle',
						streamWarning: null,
						lastProgressAt: Date.now(),
						lastProgressKind: 'error',
						error: message,
						diagnostics: {
							...state.diagnostics,
							completedAt: Date.now(),
						},
					}))
					toast.error(message)
				} finally {
					if (currentStreamRunId === streamRunId) {
						streamAbortController = null
						currentStreamingChatId = null
					}
				}
			},

			cancelStream: () => {
				if (streamAbortController) {
					currentStreamRunId += 1
					streamAbortController.abort()
					streamAbortController = null
					currentStreamingChatId = null
				}
				set((state) => ({
					isStreaming: false,
					streamingContent: '',
					executingTools: false,
					streamPhase: 'idle',
					streamWarning: null,
					lastProgressAt: Date.now(),
					lastProgressKind: 'error',
					error: state.error,
				}))
			},

			reset: () => {
				if (streamAbortController) {
					currentStreamRunId += 1
					streamAbortController.abort()
					streamAbortController = null
					currentStreamingChatId = null
				}
				set(createInitialState())
			},
		}),
		{
			name: 'chat-store',
			partialize: chatStorePartialize,
			merge: (persistedState, currentState) => {
				const persisted = (persistedState as Partial<ChatState> | undefined) ?? {}
				const persistedSessions = Array.isArray(persisted.chatSessions)
					? persisted.chatSessions.filter((session) => typeof session?.id === 'string')
					: []
				const chatSessions =
					persistedSessions.length > 0
						? persistedSessions
						: (currentState.chatSessions ?? [createEmptyChatSession()])
				const persistedActiveChatId =
					typeof persisted.activeChatId === 'string' ? persisted.activeChatId : null
				const activeChatId = chatSessions.some((session) => session.id === persistedActiveChatId)
					? persistedActiveChatId
					: (chatSessions[0]?.id ?? null)
				const activeChat = chatSessions.find((session) => session.id === activeChatId)
				return {
					...currentState,
					chatSessions: sortChatSessionsByRecent(chatSessions),
					activeChatId,
					messages: activeChat?.messages ?? [],
					references: activeChat?.references ?? [],
				}
			},
		},
	),
)

// Action helpers for non-hook usage
export const chatActions = {
	setProvider: (provider: ProviderType) => useChatStore.getState().setProvider(provider),
	setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) =>
		useChatStore.getState().setProviderOverride(type, patch),
	loadModels: () => useChatStore.getState().loadModels(),
	setSelectedModel: (modelId: string) => useChatStore.getState().setSelectedModel(modelId),
	setToolsEnabled: (enabled: boolean) => useChatStore.getState().setToolsEnabled(enabled),
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) =>
		useChatStore.getState().hydrateSettings(settings),
	setSettingsStatus: (status: SettingsStatus, error?: string | null) =>
		useChatStore.getState().setSettingsStatus(status, error),
	requestSettingsReload: () => useChatStore.getState().requestSettingsReload(),
	notifySettingsImported: () => useChatStore.getState().notifySettingsImported(),
	sendMessage: (content: string, options?: SendMessageOptions) =>
		useChatStore.getState().sendMessage(content, options),
	clearMessages: () => useChatStore.getState().clearMessages(),
	createChat: () => useChatStore.getState().createChat(),
	switchChat: (chatId: string) => useChatStore.getState().switchChat(chatId),
	deleteChat: (chatId: string) => useChatStore.getState().deleteChat(chatId),
	setReferences: (references: ChatReference[]) => useChatStore.getState().setReferences(references),
	cancelStream: () => useChatStore.getState().cancelStream(),
	reset: () => useChatStore.getState().reset(),
}
