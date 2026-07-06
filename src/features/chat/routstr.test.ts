import { afterEach, describe, expect, test } from 'bun:test'
import { fetchModels } from './routstr'

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
