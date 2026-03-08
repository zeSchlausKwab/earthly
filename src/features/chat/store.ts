/**
 * Chat Store - Zustand store for Routstr AI chat
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, RoutstrModel, ToolCall, ProviderType, ProviderConfig } from './routstr'
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
	geoTools,
	executeToolCall,
	consumeMapSnapshot,
} from './tools'
import { nip60Actions, useNip60Store } from '@/lib/stores/nip60'
import { toast } from 'sonner'

// Default max tokens to limit cost - can be adjusted
// Lower value = lower prepayment (unused balance is refunded)
const DEFAULT_MAX_TOKENS = 512
const CONTEXT_SAFETY_TOKENS = 256
const LMSTUDIO_CONTEXT_SAFETY_TOKENS = 1536
const MIN_PROMPT_BUDGET_TOKENS = 512
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
const MIN_TOOL_ENABLED_MAX_TOKENS = 1024

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

export interface ChatSettingsSnapshot {
	provider: ProviderType
	customEndpoint: string
	customApiKey: string
	selectedModel: string | null
	toolsEnabled: boolean
}

export const DEFAULT_CHAT_SETTINGS: ChatSettingsSnapshot = {
	provider: 'routstr',
	customEndpoint: '',
	customApiKey: '',
	selectedModel: null,
	toolsEnabled: true,
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
		return {
			...message,
			content: truncateTextForPrompt(content, maxChars),
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
		return {
			...message,
			content: truncateTextForPrompt(content, maxChars),
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

function getPromptBudgetTokens(
	model: RoutstrModel,
	provider: ProviderConfig,
	maxTokens: number,
): number {
	const contextTokens = getEffectiveContextTokens(model, provider)
	const completionReserve = Math.max(64, maxTokens)
	const safetyTokens =
		provider.type === 'lmstudio' ? LMSTUDIO_CONTEXT_SAFETY_TOKENS : CONTEXT_SAFETY_TOKENS
	return Math.max(MIN_PROMPT_BUDGET_TOKENS, contextTokens - completionReserve - safetyTokens)
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

function modelMaySupportVision(provider: ProviderConfig, modelId: string): boolean {
	const lower = modelId.toLowerCase()
	const visionHints = [
		'vision',
		'vl',
		'llava',
		'qwen2.5-vl',
		'gemma-vision',
		'pixtral',
		'gpt-4o',
		'claude-3',
	]
	const providerSupportsVisionTransport =
		provider.type === 'lmstudio' || provider.type === 'routstr' || provider.type === 'custom'
	return providerSupportsVisionTransport && visionHints.some((hint) => lower.includes(hint))
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

function resolveProvider(
	type: ProviderType,
	customEndpoint: string,
	customApiKey: string,
): ProviderConfig {
	if (type === 'custom') {
		return {
			type: 'custom',
			baseUrl: customEndpoint,
			apiKey: customApiKey || undefined,
			name: 'Custom',
			requiresPayment: false,
		}
	}
	return BUILTIN_PROVIDERS[type]
}

interface ChatState {
	// Provider
	provider: ProviderType
	customEndpoint: string
	customApiKey: string
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
	// Settings
	maxTokens: number // Max output tokens per request
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
	setCustomEndpoint: (url: string) => void
	setCustomApiKey: (key: string) => void
	// Model management
	loadModels: () => Promise<void>
	setSelectedModel: (modelId: string) => void
	// Settings
	setToolsEnabled: (enabled: boolean) => void
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => void
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
		maxTokens: DEFAULT_MAX_TOKENS,
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

// AbortController for canceling streams
let streamAbortController: AbortController | null = null

export const useChatStore = create<ChatStore>()(
	persist(
		(set, get) => ({
			...initialState,

			setProvider: (providerType: ProviderType) => {
				set({ provider: providerType, models: [], selectedModel: null, modelsError: null })
				get().loadModels()
			},

			setCustomEndpoint: (url: string) => {
				set({ customEndpoint: url })
			},

			setCustomApiKey: (key: string) => {
				set({ customApiKey: key })
			},

			loadModels: async () => {
				const { provider, customEndpoint, customApiKey } = get()
				const providerConfig = resolveProvider(provider, customEndpoint, customApiKey)

				if (provider === 'custom' && !customEndpoint) {
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
				set({
					provider: settings.provider ?? DEFAULT_CHAT_SETTINGS.provider,
					customEndpoint: settings.customEndpoint ?? DEFAULT_CHAT_SETTINGS.customEndpoint,
					customApiKey: settings.customApiKey ?? DEFAULT_CHAT_SETTINGS.customApiKey,
					selectedModel: settings.selectedModel ?? DEFAULT_CHAT_SETTINGS.selectedModel,
					toolsEnabled: settings.toolsEnabled ?? DEFAULT_CHAT_SETTINGS.toolsEnabled,
					models: [],
					modelsLoading: false,
					modelsError: null,
				})
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
				if (get().isStreaming) return
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
				const {
					selectedModel,
					models,
					maxTokens,
					toolsEnabled,
					provider,
					customEndpoint,
					customApiKey,
				} = get()
				const providerConfig = resolveProvider(provider, customEndpoint, customApiKey)
				const requestMaxTokens = toolsEnabled
					? Math.max(maxTokens, MIN_TOOL_ENABLED_MAX_TOKENS)
					: maxTokens
				const referenceContextMessage = options?.referenceContextMessage?.trim()

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
					const walletState = useNip60Store.getState()
					if (walletState.status !== 'ready') {
						toast.error('Wallet not ready. Please initialize your wallet first.')
						return
					}
				}

				// Add user message immediately
				const userMessage: ChatMessage = { role: 'user', content }
				set((state) => ({
					messages: [...state.messages, userMessage],
					chatSessions: applyMessagesToActiveChat(state.chatSessions, state.activeChatId, [
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

				// Helper to process refund (no-ops when refundToken is null)
				const processRefund = async (refundToken: string | null) => {
					if (refundToken) {
						console.log('[Chat] Received refund token, redeeming...')
						try {
							await nip60Actions.receiveEcash(refundToken)
						} catch (err) {
							console.error('[Chat] Failed to process refund:', err)
						}
					}
				}

				// Helper to make a streaming request
				const makeRequest = async (
					requestMessages: ChatMessage[],
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
						const estimatedCost = estimateMaxCost(model, inputTokens, requestMaxTokens)

						console.log('[Chat] Cost estimate:', {
							inputTokens,
							maxOutputTokens: requestMaxTokens,
							estimatedCost,
							modelPricing: model.pricing,
						})

						const currentWalletState = useNip60Store.getState()
						if (currentWalletState.balance < estimatedCost) {
							throw new Error(
								`Insufficient balance. Need ~${estimatedCost} sats, have ${currentWalletState.balance}`,
							)
						}

						const mint = currentWalletState.defaultMint || currentWalletState.mints[0]
						if (!mint) {
							throw new Error('No mint available for payment')
						}

						console.log(`[Chat] Generating ${estimatedCost} sat token for inference`)
						cashuToken = await nip60Actions.sendEcash(estimatedCost, mint)
						if (!cashuToken) {
							throw new Error('Failed to generate payment token')
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

						const requestTools = toolsEnabled ? geoTools : undefined
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
								max_tokens: requestMaxTokens,
								tools: requestTools,
							},
							{
								onToken: (token: string) => {
									if (settled) return
									accumulatedContent += token
									set({ streamingContent: accumulatedContent })
									refreshActivity('token')
								},
								onReasoningToken: (token: string) => {
									if (settled) return
									accumulatedReasoningContent += token
									refreshActivity('reasoning')
								},
								onToolCall: (toolCalls: ToolCall[]) => {
									if (settled) return
									console.log(
										'[Chat] Received tool calls:',
										toolCalls.map((t) => t.function.name),
									)
									accumulatedToolCalls = toolCalls
									refreshActivity('tool_calls')
								},
								onComplete: async (refundToken: string | null, finishReason?: string) => {
									if (settled) return
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
					let totalToolCalls = 0
					let round = 0
					const effectiveContextTokens = getEffectiveContextTokens(model, providerConfig)
					const requiresReasoningContent = providerMayRequireReasoningContent(
						providerConfig,
						selectedModelId,
					)
					const canUseVision =
						modelMaySupportVision(providerConfig, selectedModelId) &&
						effectiveContextTokens >= MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE
					const promptBudgetTokens = getPromptBudgetTokens(model, providerConfig, requestMaxTokens)
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
						round += 1
						const roundNumber = round
						let requestMessages: ChatMessage[] = [...conversationMessages]
						if (oneShotVisionMessages.length > 0) {
							requestMessages.push(...oneShotVisionMessages)
							oneShotVisionMessages = []
						}

						let mapContextMessage: ChatMessage | null = null
						if (toolsEnabled) {
							mapContextMessage = createMapContextSystemMessage()
						}
						const referenceContextSystemMessage: ChatMessage | null = referenceContextMessage
							? {
									role: 'system',
									content: referenceContextMessage,
								}
							: null

						const mapContextTokens = mapContextMessage
							? estimateMessageTokensForBudget(sanitizeMessageForPrompt(mapContextMessage))
							: 0
						const referenceContextTokens = referenceContextSystemMessage
							? estimateMessageTokensForBudget(
									sanitizeMessageForPrompt(referenceContextSystemMessage),
								)
							: 0
						const conversationBudget = Math.max(
							MIN_PROMPT_BUDGET_TOKENS,
							promptBudgetTokens - mapContextTokens - referenceContextTokens,
						)
						requestMessages = trimMessagesToPromptBudget(requestMessages, conversationBudget)

						if (mapContextMessage) {
							requestMessages = [sanitizeMessageForPrompt(mapContextMessage), ...requestMessages]
						}
						if (referenceContextSystemMessage) {
							requestMessages = [
								sanitizeMessageForPrompt(referenceContextSystemMessage),
								...requestMessages,
							]
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

						set((state) => ({
							streamPhase: 'streaming',
							lastProgressAt: Date.now(),
							lastProgressKind: 'request_start',
							diagnostics: {
								...state.diagnostics,
								mapContextTokens,
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
						}

						try {
							result = await makeRequest(requestMessages)
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
							result = await makeRequest(emergencyMessages)
						}

						// If we got tool calls, execute them and continue
						if (result.toolCalls.length > 0) {
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
									state.activeChatId,
									conversationMessages,
								),
							}))

							// Execute each tool call
							for (const toolCall of result.toolCalls) {
								console.log(`[Chat] Executing tool: ${toolCall.function.name}`)
								const toolResult = await executeToolCall(toolCall)

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
										state.activeChatId,
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
							const normalizedReasoningContent = result.reasoningContent.trim()
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content,
								reasoning_content: normalizedReasoningContent || undefined,
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set((state) => ({
								messages: conversationMessages,
								chatSessions: applyMessagesToActiveChat(
									state.chatSessions,
									state.activeChatId,
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
							set((state) => ({
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
						}
						break
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to send message'
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
					streamAbortController = null
				}
			},

			cancelStream: () => {
				if (streamAbortController) {
					streamAbortController.abort()
					streamAbortController = null
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
					streamAbortController.abort()
					streamAbortController = null
				}
				set(createInitialState())
			},
		}),
		{
			name: 'chat-store',
			partialize: (state) => ({
				chatSessions: state.chatSessions,
				activeChatId: state.activeChatId,
			}),
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
	setCustomEndpoint: (url: string) => useChatStore.getState().setCustomEndpoint(url),
	setCustomApiKey: (key: string) => useChatStore.getState().setCustomApiKey(key),
	loadModels: () => useChatStore.getState().loadModels(),
	setSelectedModel: (modelId: string) => useChatStore.getState().setSelectedModel(modelId),
	setToolsEnabled: (enabled: boolean) => useChatStore.getState().setToolsEnabled(enabled),
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) =>
		useChatStore.getState().hydrateSettings(settings),
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
