/**
 * Tests for the D-07 vision-detection ladder.
 *
 * `fetch` is MOCKED (deterministic, no network). We assert the full ladder:
 *  1. Ollama native `/api/show` capabilities (authoritative; `/v1` stripped),
 *  2. other providers' `/v1/models` capabilities/input_modalities,
 *  3. name heuristic → `'uncertain'` (NOT confirmed),
 *  4. fail-safe → `'no-vision'` (never silently send to a blind model),
 *  plus network-failure degradation (never throws) and per-key caching.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ProviderConfig } from '../routstr'
import { type VisionSupport, clearVisionCache, detectVisionSupport } from './detectVisionSupport'

const realFetch = globalThis.fetch

function ollama(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		type: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		name: 'Ollama',
		requiresPayment: false,
		...overrides,
	}
}

function routstr(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		type: 'routstr',
		baseUrl: 'https://api.routstr.com/v1',
		name: 'Routstr',
		requiresPayment: true,
		...overrides,
	}
}

function custom(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		type: 'custom',
		baseUrl: 'https://user-controlled.example/v1',
		name: 'Custom',
		requiresPayment: false,
		...overrides,
	}
}

/** Build a mocked fetch that records calls and returns the given JSON body. */
function jsonFetch(body: unknown, ok = true) {
	const calls: string[] = []
	const fn = mock(async (input: RequestInfo | URL) => {
		calls.push(String(input))
		return {
			ok,
			json: async () => body,
		} as unknown as Response
	})
	return { fn, calls }
}

beforeEach(() => {
	clearVisionCache()
})

afterEach(() => {
	globalThis.fetch = realFetch
	clearVisionCache()
})

describe('detectVisionSupport — Ollama /api/show (tier 1)', () => {
	test('capabilities include vision → vision; hits /api/show with /v1 stripped', async () => {
		const { fn, calls } = jsonFetch({ capabilities: ['completion', 'vision'] })
		globalThis.fetch = fn as unknown as typeof fetch

		const result = await detectVisionSupport(ollama(), 'llava')
		expect(result).toBe<VisionSupport>('vision')
		expect(calls).toHaveLength(1)
		expect(calls[0]).toBe('http://localhost:11434/api/show')
		expect(calls[0]).not.toContain('/v1')
	})

	test('capabilities present but no vision → no-vision', async () => {
		const { fn } = jsonFetch({ capabilities: ['completion'] })
		globalThis.fetch = fn as unknown as typeof fetch

		const result = await detectVisionSupport(ollama(), 'qwen2.5')
		expect(result).toBe<VisionSupport>('no-vision')
	})

	test('POST body carries the model id', async () => {
		let captured: unknown
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			captured = init?.body ? JSON.parse(String(init.body)) : null
			return { ok: true, json: async () => ({ capabilities: ['vision'] }) } as unknown as Response
		}) as unknown as typeof fetch

		await detectVisionSupport(ollama(), 'my-model')
		expect(captured).toEqual({ model: 'my-model' })
	})
})

describe('detectVisionSupport — other providers /v1/models (tier 2)', () => {
	test('capabilities array lists image → vision', async () => {
		const { fn, calls } = jsonFetch({
			data: [{ id: 'gpt-4o', capabilities: ['text', 'image'] }],
		})
		globalThis.fetch = fn as unknown as typeof fetch

		const result = await detectVisionSupport(routstr(), 'gpt-4o')
		expect(result).toBe<VisionSupport>('vision')
		expect(calls[0]).toBe('https://api.routstr.com/v1/models')
	})

	test('input_modalities lists image → vision', async () => {
		const { fn } = jsonFetch({
			data: [{ id: 'pixtral', input_modalities: ['text', 'image'] }],
		})
		globalThis.fetch = fn as unknown as typeof fetch

		expect(await detectVisionSupport(routstr(), 'pixtral')).toBe<VisionSupport>('vision')
	})

	test('architecture.input_modalities lists image → vision', async () => {
		const { fn } = jsonFetch({
			data: [{ id: 'some-vlm', architecture: { input_modalities: ['text', 'image'] } }],
		})
		globalThis.fetch = fn as unknown as typeof fetch

		expect(await detectVisionSupport(routstr(), 'some-vlm')).toBe<VisionSupport>('vision')
	})

	test('entry present with capability data but no image → no-vision', async () => {
		const { fn } = jsonFetch({
			data: [{ id: 'text-only', capabilities: ['text'] }],
		})
		globalThis.fetch = fn as unknown as typeof fetch

		expect(await detectVisionSupport(routstr(), 'text-only')).toBe<VisionSupport>('no-vision')
	})

	test('sends Authorization: Bearer when apiKey present', async () => {
		let authHeader: string | undefined
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>
			authHeader = headers.Authorization
			return {
				ok: true,
				json: async () => ({ data: [{ id: 'm', capabilities: ['image'] }] }),
			} as unknown as Response
		}) as unknown as typeof fetch

		await detectVisionSupport(routstr({ apiKey: 'secret-key' }), 'm')
		expect(authHeader).toBe('Bearer secret-key')
	})

	// WR-05: a `custom` provider's baseUrl is fully user-controlled, so the probe
	// must NOT leak the API key to that origin.
	test('does NOT send the API key to a custom provider /models probe (WR-05)', async () => {
		let authHeader: string | undefined
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>
			authHeader = headers.Authorization
			return {
				ok: true,
				json: async () => ({ data: [{ id: 'm', capabilities: ['image'] }] }),
			} as unknown as Response
		}) as unknown as typeof fetch

		const result = await detectVisionSupport(custom({ apiKey: 'leak-me-not' }), 'm')
		expect(authHeader).toBeUndefined()
		// The public list still resolves capabilities normally.
		expect(result).toBe<VisionSupport>('vision')
	})
})

describe('nameHeuristic token-boundary matching (WR-06)', () => {
	// All these have an entry with NO capability fields, so detection falls through
	// to the tier-3 name heuristic.
	function fallThrough(modelId: string) {
		const { fn } = jsonFetch({ data: [{ id: modelId }] })
		globalThis.fetch = fn as unknown as typeof fetch
		return detectVisionSupport(routstr(), modelId)
	}

	test.each([
		'marvel',
		'mistral-small',
		'nouvelle-7b',
		'some-vllm-host',
		'plain-text-model',
	])('non-vision id %s does NOT falsely match a vision hint → no-vision', async (modelId) => {
		expect(await fallThrough(modelId)).toBe<VisionSupport>('no-vision')
	})

	test.each([
		'qwen2.5-vl',
		'vl-7b-instruct',
		'gemma-vision',
		'llava-1.6',
		'pixtral-12b',
		'gpt-4o-mini',
		'claude-3-opus',
	])('vision-named id %s matches on a token boundary → uncertain', async (modelId) => {
		expect(await fallThrough(modelId)).toBe<VisionSupport>('uncertain')
	})
})

describe('detectVisionSupport — name heuristic (tier 3) → uncertain', () => {
	test.each([
		'qwen2.5-vl',
		'llava',
		'gpt-4o',
		'pixtral-12b',
		'claude-3-opus',
	])('%s with no capability data → uncertain (NOT confirmed)', async (modelId) => {
		// /v1/models entry exists but exposes NO capability fields → fall through to heuristic.
		const { fn } = jsonFetch({ data: [{ id: modelId }] })
		globalThis.fetch = fn as unknown as typeof fetch

		expect(await detectVisionSupport(routstr(), modelId)).toBe<VisionSupport>('uncertain')
	})
})

describe('detectVisionSupport — fail-safe (tier 4) → no-vision', () => {
	test('unknown id with no capability data → no-vision (never silent vision)', async () => {
		const { fn } = jsonFetch({ data: [{ id: 'mystery-model-7b' }] })
		globalThis.fetch = fn as unknown as typeof fetch

		const result = await detectVisionSupport(routstr(), 'mystery-model-7b')
		expect(result).toBe<VisionSupport>('no-vision')
		expect(result).not.toBe('vision')
	})
})

describe('detectVisionSupport — network failure degrades, never throws (T-03-13)', () => {
	test('Ollama /api/show rejects → name heuristic → uncertain for a vision-named model', async () => {
		globalThis.fetch = (async () => {
			throw new Error('CORS / network down')
		}) as unknown as typeof fetch

		let result: VisionSupport | undefined
		await expect(
			(async () => {
				result = await detectVisionSupport(ollama(), 'llava')
			})(),
		).resolves.toBeUndefined()
		expect(result).toBe<VisionSupport>('uncertain')
	})

	test('fetch rejects + non-vision name → no-vision (fail-safe), never throws', async () => {
		globalThis.fetch = (async () => {
			throw new Error('network down')
		}) as unknown as typeof fetch

		expect(await detectVisionSupport(routstr(), 'plain-text-model')).toBe<VisionSupport>(
			'no-vision',
		)
	})

	test('non-ok response degrades to heuristic without throwing', async () => {
		const { fn } = jsonFetch({}, false)
		globalThis.fetch = fn as unknown as typeof fetch

		expect(await detectVisionSupport(ollama(), 'gemma-vision')).toBe<VisionSupport>('uncertain')
	})
})

describe('detectVisionSupport — caching (T-03-12)', () => {
	test('two calls for the same (type, baseUrl, modelId) perform one fetch', async () => {
		const { fn } = jsonFetch({ capabilities: ['vision'] })
		globalThis.fetch = fn as unknown as typeof fetch

		const a = await detectVisionSupport(ollama(), 'llava')
		const b = await detectVisionSupport(ollama(), 'llava')
		expect(a).toBe('vision')
		expect(b).toBe('vision')
		expect(fn).toHaveBeenCalledTimes(1)
	})

	test('different modelId is a distinct cache key', async () => {
		const { fn } = jsonFetch({ capabilities: ['vision'] })
		globalThis.fetch = fn as unknown as typeof fetch

		await detectVisionSupport(ollama(), 'model-a')
		await detectVisionSupport(ollama(), 'model-b')
		expect(fn).toHaveBeenCalledTimes(2)
	})

	test('clearVisionCache forces a re-fetch', async () => {
		const { fn } = jsonFetch({ capabilities: ['vision'] })
		globalThis.fetch = fn as unknown as typeof fetch

		await detectVisionSupport(ollama(), 'llava')
		clearVisionCache()
		await detectVisionSupport(ollama(), 'llava')
		expect(fn).toHaveBeenCalledTimes(2)
	})
})
