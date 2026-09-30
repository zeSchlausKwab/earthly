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
		currency?: 'sats' | 'USD'
		input: number // cost per 1M input tokens in the stated currency
		output: number // cost per 1M output tokens in the stated currency
		request: number // per-request fee in the stated currency
	}
}

export interface ToolCall {
	/** Preserve opaque Gemini tool-call signatures for the following turn. */
	extra_content?: Record<string, unknown>
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
	extra_content?: Record<string, unknown>
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

// --- Multi-provider support ---

export type ProviderType = 'routstr' | 'lmstudio' | 'ollama' | 'custom'

/** The canonical, exhaustive list of provider types. */
export const PROVIDER_TYPES: readonly ProviderType[] = ['routstr', 'lmstudio', 'ollama', 'custom']

/** Shared membership guard so corrupt/tampered payloads cannot launder an unknown provider. */
export function isProviderType(value: unknown): value is ProviderType {
	return typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType)
}

export interface ProviderConfig {
	presetId?: string
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
	context_window?: number
	max_output_tokens?: number
	display_name?: string
	supported_parameters?: string[]
	pricing?: { prompt?: string | number; completion?: string | number; request?: string | number }
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
		normalizePositiveInteger(model.per_request_limits?.max_output_tokens) ??
		normalizePositiveInteger(model.max_output_tokens)
	)
}

export function providerHeaders(provider: ProviderConfig): Record<string, string> {
	const headers: Record<string, string> = {}
	if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
	if (provider.presetId === 'openrouter') headers['X-OpenRouter-Title'] = 'Earthly'
	if (provider.presetId === 'anthropic')
		headers['anthropic-dangerous-direct-browser-access'] = 'true'
	return headers
}

/**
 * Fetch available models with pricing information
 */
export async function fetchModels(provider: ProviderConfig): Promise<RoutstrModel[]> {
	const headers = providerHeaders(provider)
	if (provider.presetId === 'anthropic' && provider.apiKey) {
		headers['x-api-key'] = provider.apiKey
		headers['anthropic-version'] = '2023-06-01'
	}
	let response: Response
	try {
		response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
			headers,
			signal: AbortSignal.timeout(15_000),
		})
	} catch {
		throw new Error(
			'Could not reach this endpoint. Check the URL, local server, and CORS permissions.',
		)
	}
	if (!response.ok)
		throw new Error(
			response.status === 401 || response.status === 403
				? 'API key rejected. Check the key and endpoint region.'
				: `Model discovery failed (HTTP ${response.status}). You can enter a model ID when editing the connection.`,
		)
	const data = await response.json()

	// Transform OpenAI-style model list to our format
	// Pricing comes from sats_pricing.prompt/completion (per token)
	// We convert to per-million tokens for display
	if (!Array.isArray(data.data))
		throw new Error('Endpoint did not return a model list. Enter a model ID in the connection.')
	return data.data
		.filter((model: ApiModel) => {
			if (typeof model?.id !== 'string' || !model.id) return false
			const output = getApiModelOutputModalities(model)
			if (output?.length && !output.includes('text')) return false
			// OpenAI's shared catalogue also contains non-chat endpoints.
			return (
				provider.presetId !== 'openai' ||
				!/^(text-embedding|whisper|tts|dall-e|gpt-image|sora|omni-moderation)|realtime|transcribe/i.test(
					model.id,
				)
			)
		})
		.map((model: ApiModel) => ({
			id: model.id,
			name: model.name || model.display_name || model.id,
			description: model.description,
			contextLength: model.context_length ?? model.context_window,
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
							: Array.isArray(model.supported_parameters)
								? model.supported_parameters.includes('tools')
								: undefined,
			pricing: {
				// sats_pricing is per-token, multiply by 1M for display
				currency: provider.presetId === 'openrouter' ? 'USD' : 'sats',
				input:
					provider.presetId === 'openrouter'
						? Number(model.pricing?.prompt ?? 0) * 1_000_000
						: Math.ceil((model.sats_pricing?.prompt || 0) * 1_000_000),
				output:
					provider.presetId === 'openrouter'
						? Number(model.pricing?.completion ?? 0) * 1_000_000
						: Math.ceil((model.sats_pricing?.completion || 0) * 1_000_000),
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
		...providerHeaders(provider),
	}
	if (cashuToken) {
		headers['X-Cashu'] = cashuToken
	}
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}

	const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
	const costMsats = Number(response.headers.get('X-Routstr-Cost-Msats') ?? 0)
	const actualCost = Number.isFinite(costMsats) ? costMsats / 1000 : 0

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
		...providerHeaders(provider),
	}
	if (cashuToken) {
		headers['X-Cashu'] = cashuToken
	}
	if (provider.apiKey) {
		headers.Authorization = `Bearer ${provider.apiKey}`
	}

	let response: Response
	try {
		response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
		let errorText: string
		try {
			errorText = await response.text()
		} catch (error) {
			callbacks.onError(
				error instanceof Error ? error : new Error(String(error)),
				response.headers.get('X-Cashu'),
			)
			return
		}
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

		callbacks.onError(new Error(errorMessage), response.headers.get('X-Cashu') || refundToken)
		return
	}

	// Get refund token from response header (may also come at end for streaming)
	const refundToken = response.headers.get('X-Cashu')

	const reader = response.body?.getReader()
	if (!reader) {
		callbacks.onError(new Error('No response body'), refundToken)
		return
	}

	const decoder = new TextDecoder()
	let buffer = ''

	// Accumulate tool calls as they stream in
	const toolCallsMap = new Map<
		number,
		{ id: string; name: string; arguments: string; extra_content?: Record<string, unknown> }
	>()
	let finishReason: string | undefined

	const processSseDataLine = (data: string): 'done' | 'continue' | 'invalid' => {
		if (data === '[DONE]') {
			// If we accumulated tool calls, emit them
			if (toolCallsMap.size > 0 && callbacks.onToolCall) {
				const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
					id: tc.id,
					...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
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
			const errorPayload = chunk as StreamChunk & { error?: { message?: string }; message?: string }
			if (errorPayload.error) {
				const streamError = new Error(
					errorPayload.error.message || 'Provider interrupted the stream',
				)
				callbacks.onError(streamError, refundToken)
				return 'done'
			}
			const choice = chunk.choices?.[0]

			// Handle regular content
			const content = choice?.delta?.content
			if (content) {
				callbacks.onToken(content)
			}

			// Some providers stream reasoning separately
			const reasoningContent =
				choice?.delta?.reasoning_content ??
				(choice?.delta as { reasoning?: string } | undefined)?.reasoning
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
						if (tc.extra_content) existing.extra_content = tc.extra_content
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
							extra_content: tc.extra_content,
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

		buffer += decoder.decode()
		if (drainBufferedEvents(true) === 'done') return
		if (!finishReason) {
			callbacks.onError(
				new Error('The provider closed the stream before completing the response'),
				refundToken,
			)
			return
		}

		// If we accumulated tool calls, emit them
		if (toolCallsMap.size > 0 && callbacks.onToolCall) {
			const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
				id: tc.id,
				...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
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
		callbacks.onError(error instanceof Error ? error : new Error(String(error)), refundToken)
	} finally {
		await reader.cancel().catch(() => undefined)
		reader.releaseLock()
	}
}
