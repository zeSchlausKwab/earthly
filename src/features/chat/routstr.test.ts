import { afterEach, describe, expect, test } from 'bun:test'
import { fetchModels, streamChatCompletion, type StreamChunk } from './routstr'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('fetchModels', () => {
	test('parses Routstr max completion and modality metadata', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					data: [
						{
							id: 'qwen3.7-plus',
							name: 'Qwen: Qwen3.7 Plus',
							context_length: 1_000_000,
							architecture: {
								input_modalities: ['text', 'image'],
								output_modalities: ['text'],
							},
							top_provider: {
								max_completion_tokens: 65_536,
							},
							sats_pricing: {
								prompt: 0.0003924730660501084,
								completion: 0.0015698922642004337,
								request: 0.001,
							},
						},
					],
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			)) as typeof fetch

		const [model] = await fetchModels({
			type: 'routstr',
			baseUrl: 'https://api.routstr.com/v1',
			name: 'Routstr',
			requiresPayment: true,
		})

		expect(model?.maxCompletionTokens).toBe(65_536)
		expect(model?.inputModalities).toEqual(['text', 'image'])
		expect(model?.outputModalities).toEqual(['text'])
	})
})

const provider = {
	type: 'routstr' as const,
	baseUrl: 'https://api.routstr.test/v1',
	name: 'Routstr',
	requiresPayment: true,
}

const request = {
	model: 'model',
	messages: [{ role: 'user' as const, content: 'hi' }],
}

function streamResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
				controller.close()
			},
		}),
		{ status: 200, headers: { 'content-type': 'text/event-stream' } },
	)
}

function textChunk(content: string): StreamChunk {
	return {
		id: 'chunk',
		object: 'chat.completion.chunk',
		created: 1,
		model: 'model',
		choices: [
			{
				index: 0,
				delta: { content },
				finish_reason: null,
			},
		],
	}
}

describe('streamChatCompletion', () => {
	test('streams provider-supplied reasoning deltas separately from answer text', async () => {
		globalThis.fetch = (async () =>
			streamResponse([
				`data: ${JSON.stringify({
					...textChunk(''),
					choices: [
						{
							index: 0,
							delta: { reasoning_content: 'Inspecting the selected routes…' },
							finish_reason: null,
						},
					],
				})}\n`,
				`data: ${JSON.stringify(textChunk('Done.'))}\n`,
				'data: [DONE]\n',
			])) as typeof fetch

		const tokens: string[] = []
		const reasoningTokens: string[] = []
		await streamChatCompletion(
			request,
			{
				onToken: (token) => tokens.push(token),
				onReasoningToken: (token) => reasoningTokens.push(token),
				onComplete: () => undefined,
				onError: (error) => {
					throw error
				},
			},
			provider,
			'cashu-token',
		)

		expect(reasoningTokens).toEqual(['Inspecting the selected routes…'])
		expect(tokens).toEqual(['Done.'])
	})

	test('streams line-delimited data frames without blank SSE separators', async () => {
		globalThis.fetch = (async () =>
			streamResponse([
				`data: ${JSON.stringify(textChunk('Hel'))}\n`,
				`data: ${JSON.stringify(textChunk('lo'))}\n`,
				'data: [DONE]\n',
			])) as typeof fetch

		const tokens: string[] = []
		let completed = false

		await streamChatCompletion(
			request,
			{
				onToken: (token) => tokens.push(token),
				onComplete: () => {
					completed = true
				},
				onError: (error) => {
					throw error
				},
			},
			provider,
			'cashu-token',
		)

		expect(tokens).toEqual(['Hel', 'lo'])
		expect(completed).toBe(true)
	})

	test('parses top-level Routstr error messages and refund tokens', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					message: 'The provided CASHU token has already been spent',
					type: 'token_already_spent',
					code: 400,
					refund_token: 'cashu-refund',
				}),
				{ status: 400, headers: { 'content-type': 'application/json' } },
			)) as typeof fetch

		let error: Error | null = null
		let refundToken: string | null | undefined

		await streamChatCompletion(
			request,
			{
				onToken: () => undefined,
				onComplete: () => undefined,
				onError: (err, refund) => {
					error = err
					refundToken = refund
				},
			},
			provider,
			'cashu-token',
		)

		expect(error?.message).toBe('Stream failed: The provided CASHU token has already been spent')
		expect(refundToken).toBe('cashu-refund')
	})

	test('reports fetch aborts through onError instead of rejecting', async () => {
		globalThis.fetch = (async () => {
			throw new DOMException('signal is aborted without reason', 'AbortError')
		}) as typeof fetch

		let error: Error | null = null

		await expect(
			streamChatCompletion(
				request,
				{
					onToken: () => undefined,
					onComplete: () => undefined,
					onError: (err) => {
						error = err
					},
				},
				provider,
				'cashu-token',
			),
		).resolves.toBeUndefined()

		expect(error?.name).toBe('AbortError')
	})
})
