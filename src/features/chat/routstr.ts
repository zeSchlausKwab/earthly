/**
 * Routstr API Client
 *
 * OpenAI-compatible API proxy with Cashu micropayments (RIP-01)
 * Supports X-Cashu header for stateless payments with automatic refunds
 */

export interface RoutstrModel {
	id: string
	name: string
	description?: string
	contextLength?: number
	maxCompletionTokens?: number
	inputModalities?: string[]
	outputModalities?: string[]
	supportsTools?: boolean
	pricing: {
		input: number // cost per 1M input tokens in sats
		output: number // cost per 1M output tokens in sats
		request: number // per-request fee in sats
	}
}

export interface ToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string
	}
}

export interface ChatTextContentPart {
	type: 'text'
	text: string
}

export interface ChatImageUrlContentPart {
	type: 'image_url'
	image_url: {
		url: string
		detail?: 'auto' | 'low' | 'high'
	}
}

export type ChatContentPart = ChatTextContentPart | ChatImageUrlContentPart
export type ChatMessageContent = string | ChatContentPart[]

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: ChatMessageContent | null
	reasoning_content?: string | null
	tool_calls?: ToolCall[]
	tool_call_id?: string // For tool role messages
}

export interface Tool {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: object
	}
}

export interface ChatCompletionRequest {
	model: string
	messages: ChatMessage[]
	stream?: boolean
	max_tokens?: number
	temperature?: number
	tools?: Tool[]
	tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface ChatCompletionResponse {
	id: string
	object: string
	created: number
	model: string
	choices: {
		index: number
		message: ChatMessage
		finish_reason: string // 'stop' | 'tool_calls' | 'length' etc
	}[]
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

export interface StreamToolCall {
	index: number
	id?: string
	type?: 'function'
	function?: {
		name?: string
		arguments?: string
	}
}

export interface StreamChunk {
	id: string
	object: string
	created: number
	model: string
	choices: {
		index: number
		delta: {
			role?: string
			content?: string | null
			reasoning_content?: string | null
			tool_calls?: StreamToolCall[]
		}
		finish_reason: string | null // 'stop' | 'tool_calls' | 'length'
	}[]
}

export interface RoutstrConfig {
	baseUrl: string
}

const DEFAULT_CONFIG: RoutstrConfig = {
	baseUrl: 'https://api.routstr.com/v1',
}

// --- Multi-provider support ---

export type ProviderType = 'routstr' | 'lmstudio' | 'ollama' | 'custom'

/** The canonical, exhaustive list of provider types. */
export const PROVIDER_TYPES: readonly ProviderType[] = ['routstr', 'lmstudio', 'ollama', 'custom']

/** Shared membership guard so corrupt/tampered payloads cannot launder an unknown provider. */
export function isProviderType(value: unknown): value is ProviderType {
	return typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType)
}

export interface ProviderConfig {
	type: ProviderType
	baseUrl: string
	apiKey?: string
	name: string
	requiresPayment: boolean
}

export const BUILTIN_PROVIDERS: Record<Exclude<ProviderType, 'custom'>, ProviderConfig> = {
	routstr: {
		type: 'routstr',
		baseUrl: 'https://api.routstr.com/v1',
		name: 'Routstr (paid)',
		requiresPayment: true,
	},
	lmstudio: {
		type: 'lmstudio',
		baseUrl: 'http://localhost:1234/v1',
		name: 'LM Studio',
		requiresPayment: false,
	},
	ollama: {
		type: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		name: 'Ollama',
		requiresPayment: false,
	},
}

interface ApiModel {
	id: string
	name?: string
	description?: string
	context_length?: number
	architecture?: {
		input_modalities?: string[]
		output_modalities?: string[]
	}
	input_modalities?: string[]
	output_modalities?: string[]
	capabilities?: string[]
	top_provider?: {
		max_completion_tokens?: number | null
	}
	per_request_limits?: {
		max_completion_tokens?: number | null
		max_output_tokens?: number | null
	}
	supports_tools?: boolean
	supports_tool_calling?: boolean
	tool_calling?: boolean
	sats_pricing?: {
		prompt?: number
		completion?: number
		request?: number
	}
}

function getApiModelInputModalities(model: ApiModel): string[] | undefined {
	const declared = model.input_modalities ?? model.architecture?.input_modalities
	if (Array.isArray(declared)) return declared
	if (!Array.isArray(model.capabilities)) return undefined
	if (model.capabilities.some((value) => /image|vision/i.test(value))) return ['text', 'image']
	// `capabilities` is not standardized. Values such as `text`, `completion`,
	// and `tools` can enumerate supported features without excluding images; only
	// an explicit text-only declaration is authoritative here.
	return model.capabilities.some((value) => /^text-only$/i.test(value)) ? ['text'] : undefined
}

function getApiModelOutputModalities(model: ApiModel): string[] | undefined {
	return model.output_modalities ?? model.architecture?.output_modalities
}

function normalizePositiveInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined
}

function getApiModelMaxCompletionTokens(model: ApiModel): number | undefined {
	return (
		normalizePositiveInteger(model.top_provider?.max_completion_tokens) ??
		normalizePositiveInteger(model.per_request_limits?.max_completion_tokens) ??
		normalizePositiveInteger(model.per_request_limits?.max_output_tokens)
	)
}

/**
 * Fetch available models with pricing information
 */
export async function fetchModels(provider: ProviderConfig): Promise<RoutstrModel[]> {
	const headers: Record<string, string> = {}
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}

	const response = await fetch(`${provider.baseUrl}/models`, { headers })
	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.statusText}`)
	}
	const data = await response.json()

	// Transform OpenAI-style model list to our format
	// Pricing comes from sats_pricing.prompt/completion (per token)
	// We convert to per-million tokens for display
	return (data.data || []).map((model: ApiModel) => ({
		id: model.id,
		name: model.name || model.id,
		description: model.description,
		contextLength: model.context_length,
		maxCompletionTokens: getApiModelMaxCompletionTokens(model),
		inputModalities: getApiModelInputModalities(model),
		outputModalities: getApiModelOutputModalities(model),
		supportsTools:
			typeof model.supports_tools === 'boolean'
				? model.supports_tools
				: typeof model.supports_tool_calling === 'boolean'
					? model.supports_tool_calling
					: typeof model.tool_calling === 'boolean'
						? model.tool_calling
						: undefined,
		pricing: {
			// sats_pricing is per-token, multiply by 1M for display
			input: Math.round((model.sats_pricing?.prompt || 0) * 1_000_000),
			output: Math.round((model.sats_pricing?.completion || 0) * 1_000_000),
			// Per-request fee in sats
			request: model.sats_pricing?.request || 0,
		},
	}))
}

// Minimum prepayment to ensure request goes through
// Routstr refunds unused balance, so slight overpayment is fine
const MIN_PREPAYMENT_SATS = 10

/**
 * Estimate the maximum cost for a request in sats
 * Used to determine how much ecash to include
 *
 * Note: Routstr uses prepay-and-refund model, so overpaying is safe
 * and actually required since server reserves for max possible output
 */
export function estimateMaxCost(
	model: RoutstrModel,
	inputTokens: number,
	maxOutputTokens: number = 4096,
): number {
	// Model pricing is stored as per-1M tokens, convert back to per-token
	const inputCostPerToken = model.pricing.input / 1_000_000
	const outputCostPerToken = model.pricing.output / 1_000_000

	const inputCost = inputTokens * inputCostPerToken
	const outputCost = maxOutputTokens * outputCostPerToken
	const requestFee = model.pricing.request || 0

	// Calculate total with buffer for fees and rounding
	const calculatedCost = Math.ceil(inputCost + outputCost + requestFee) + 5

	// Use minimum prepayment to ensure request succeeds
	// Unused balance is refunded via X-Cashu header
	return Math.max(MIN_PREPAYMENT_SATS, calculatedCost)
}

/**
 * Rough estimate of tokens from text (4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export interface CompletionResult {
	response: ChatCompletionResponse
	refundToken: string | null
	actualCost: number
}

/**
 * Send a chat completion request with optional Cashu payment
 * Returns the response and any refund token
 */
export async function chatCompletion(
	request: ChatCompletionRequest,
	provider: ProviderConfig,
	cashuToken?: string,
): Promise<CompletionResult> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	}
	if (cashuToken) {
		headers['X-Cashu'] = cashuToken
	}
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}

	const response = await fetch(`${provider.baseUrl}/chat/completions`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			...request,
			stream: false,
		}),
	})

	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Chat completion failed: ${error}`)
	}

	// Get refund token from response header
	const refundToken = response.headers.get('X-Cashu')
	const data: ChatCompletionResponse = await response.json()

	// Calculate actual cost from usage
	const actualCost = data.usage?.total_tokens || 0

	return {
		response: data,
		refundToken,
		actualCost,
	}
}

export interface StreamCallbacks {
	onToken: (token: string) => void
	onReasoningToken?: (token: string) => void
	onToolCall?: (toolCalls: ToolCall[]) => void
	onComplete: (refundToken: string | null, finishReason?: string) => void
	/** Called on error - refundToken may be present in error responses */
	onError: (error: Error, refundToken?: string | null) => void
}

function readRoutstrError(errorText: string): {
	message: string | null
	refundToken: string | null
} {
	try {
		const errorJson = JSON.parse(errorText)
		const nested = errorJson.error
		return {
			message:
				typeof nested?.message === 'string'
					? nested.message
					: typeof errorJson.message === 'string'
						? errorJson.message
						: null,
			refundToken:
				typeof nested?.refund_token === 'string'
					? nested.refund_token
					: typeof errorJson.refund_token === 'string'
						? errorJson.refund_token
						: null,
		}
	} catch {
		return { message: null, refundToken: null }
	}
}

/**
 * Stream a chat completion with optional Cashu payment
 * Calls onToken for each streamed token, onComplete with refund token when done
 * Supports tool calls via onToolCall callback
 */
export async function streamChatCompletion(
	request: ChatCompletionRequest,
	callbacks: StreamCallbacks,
	provider: ProviderConfig,
	cashuToken?: string,
	signal?: AbortSignal,
): Promise<void> {
	const requestBody = {
		...request,
		stream: true,
	}

	console.log('[Chat] Sending request:', {
		provider: provider.type,
		model: request.model,
		messageCount: request.messages.length,
		hasTools: !!request.tools,
		toolCount: request.tools?.length ?? 0,
		tools: request.tools?.map((t) => t.function.name),
	})

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	}
	if (cashuToken) {
		headers['X-Cashu'] = cashuToken
	}
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}

	let response: Response
	try {
		response = await fetch(`${provider.baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
			signal,
		})
	} catch (error) {
		callbacks.onError(error instanceof Error ? error : new Error(String(error)))
		return
	}

	if (!response.ok) {
		const errorText = await response.text()
		let errorMessage = `Stream failed: ${errorText}`
		const { message, refundToken } = readRoutstrError(errorText)

		if (refundToken) {
			console.log('[Routstr] Got refund token from error response')
		}
		if (message) {
			errorMessage = `Stream failed: ${message}`
		} else {
			const looksLikeHtml = errorText.includes('<!DOCTYPE html') || errorText.includes('<html')
			if (looksLikeHtml) {
				errorMessage = `Stream failed: ${response.status} ${response.statusText} (provider returned an HTML error page)`
			}
		}

		callbacks.onError(new Error(errorMessage), refundToken)
		return
	}

	// Get refund token from response header (may also come at end for streaming)
	const refundToken = response.headers.get('X-Cashu')

	const reader = response.body?.getReader()
	if (!reader) {
		callbacks.onError(new Error('No response body'))
		return
	}

	const decoder = new TextDecoder()
	let buffer = ''

	// Accumulate tool calls as they stream in
	const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()
	let finishReason: string | undefined

	const processSseDataLine = (data: string): 'done' | 'continue' | 'invalid' => {
		if (data === '[DONE]') {
			// If we accumulated tool calls, emit them
			if (toolCallsMap.size > 0 && callbacks.onToolCall) {
				const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: {
						name: tc.name,
						arguments: tc.arguments,
					},
				}))
				callbacks.onToolCall(toolCalls)
			}
			callbacks.onComplete(refundToken, finishReason)
			return 'done'
		}

		try {
			const chunk: StreamChunk = JSON.parse(data)
			const choice = chunk.choices[0]

			// Handle regular content
			const content = choice?.delta?.content
			if (content) {
				callbacks.onToken(content)
			}

			// Some providers stream reasoning separately
			const reasoningContent = choice?.delta?.reasoning_content
			if (reasoningContent && callbacks.onReasoningToken) {
				callbacks.onReasoningToken(reasoningContent)
			}

			// Handle tool calls (streamed in parts)
			const deltaToolCalls = choice?.delta?.tool_calls
			if (deltaToolCalls) {
				for (const tc of deltaToolCalls) {
					const index = typeof tc.index === 'number' ? tc.index : 0
					const existing = toolCallsMap.get(index)
					if (existing) {
						if (tc.id && !existing.id) {
							existing.id = tc.id
						}
						if (tc.function?.name) {
							existing.name = tc.function.name
						}
						if (tc.function?.arguments) {
							existing.arguments += tc.function.arguments
						}
					} else {
						toolCallsMap.set(index, {
							id: tc.id || `tool_${index}`,
							name: tc.function?.name || '',
							arguments: tc.function?.arguments || '',
						})
					}
				}
			}

			// Track finish reason
			if (choice?.finish_reason) {
				finishReason = choice.finish_reason
			}
		} catch {
			return 'invalid'
		}
		return 'continue'
	}

	const processSseEventBlock = (eventBlock: string): 'done' | 'continue' => {
		const normalized = eventBlock.replace(/\r/g, '')
		if (!normalized.trim()) return 'continue'

		const dataLines = normalized
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trimStart())

		if (dataLines.length === 0) return 'continue'
		const data = dataLines.join('\n').trim()
		if (!data) return 'continue'
		const result = processSseDataLine(data)
		return result === 'done' ? 'done' : 'continue'
	}

	const processCompleteLine = (line: string, final = false): 'done' | 'continue' | 'wait' => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith(':')) return 'continue'
		if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) {
			return 'continue'
		}

		const data = trimmed.startsWith('data:') ? trimmed.slice(5).trimStart().trim() : trimmed
		if (!data) return 'continue'
		if (!(data === '[DONE]' || data.startsWith('{'))) return 'continue'

		const result = processSseDataLine(data)
		if (result === 'invalid' && !final) return 'wait'
		return result === 'done' ? 'done' : 'continue'
	}

	const drainBufferedEvents = (final = false): 'done' | 'continue' => {
		buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

		while (true) {
			const boundaryIndex = buffer.indexOf('\n\n')
			if (boundaryIndex !== -1) {
				const eventBlock = buffer.slice(0, boundaryIndex)
				buffer = buffer.slice(boundaryIndex + 2)
				if (processSseEventBlock(eventBlock) === 'done') return 'done'
				continue
			}

			const lineEnd = buffer.indexOf('\n')
			if (lineEnd === -1) break

			const line = buffer.slice(0, lineEnd)
			const result = processCompleteLine(line)
			if (result === 'wait') break
			buffer = buffer.slice(lineEnd + 1)
			if (result === 'done') return 'done'
		}

		if (final && buffer.trim()) {
			const trailing = buffer.trim()
			buffer = ''
			const dataLike =
				trailing.startsWith('data:') || trailing === '[DONE]' || trailing.startsWith('{')
			if (processCompleteLine(trailing, true) === 'done') return 'done'
			if (!dataLike && processSseEventBlock(trailing) === 'done') return 'done'
		}

		return 'continue'
	}

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			if (drainBufferedEvents() === 'done') return
		}

		if (drainBufferedEvents(true) === 'done') return

		// If we accumulated tool calls, emit them
		if (toolCallsMap.size > 0 && callbacks.onToolCall) {
			const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
				id: tc.id,
				type: 'function' as const,
				function: {
					name: tc.name,
					arguments: tc.arguments,
				},
			}))
			callbacks.onToolCall(toolCalls)
		}

		callbacks.onComplete(refundToken, finishReason)
	} catch (error) {
		callbacks.onError(error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * Create a balance (API key) from a Cashu token
 * Alternative to X-Cashu header for multiple requests
 */
export async function createBalance(
	cashuToken: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ apiKey: string; balance: number }> {
	const response = await fetch(
		`${config.baseUrl}/balance/create?token=${encodeURIComponent(cashuToken)}`,
	)
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to create balance: ${error}`)
	}
	return response.json()
}

/**
 * Get remaining balance for an API key
 */
export async function getBalance(
	apiKey: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ balance: number }> {
	const response = await fetch(`${config.baseUrl}/balance/info`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to get balance: ${error}`)
	}
	return response.json()
}

/**
 * Refund remaining balance as a Cashu token
 */
export async function refundBalance(
	apiKey: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ token: string }> {
	const response = await fetch(`${config.baseUrl}/balance/refund`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to refund balance: ${error}`)
	}
	return response.json()
}
