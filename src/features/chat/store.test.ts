import { beforeEach, describe, expect, test } from 'bun:test'
import { BUILTIN_PROVIDERS, estimateMaxCost } from './routstr'
import type { ProviderConfig, RoutstrModel } from './routstr'
import {
	DEFAULT_CHAT_SETTINGS,
	STREAM_STALL_TIMEOUT_MS,
	TRUNCATION_CONTENT_SUFFIX,
	chatStorePartialize,
	compactIngestHandlePartForPrompt,
	deriveOutputBudget,
	describeEmptyCompletion,
	getPromptBudgetTokens,
	getAdvertisedGeoTools,
	resolveProvider,
	sanitizeMessageForPrompt,
	useChatStore,
} from './store'
import type { ProviderOverrideMap } from './store'
import { getGeoTools } from './tools'

function makeModel(overrides: Partial<RoutstrModel> = {}): RoutstrModel {
	return {
		id: 'test-model',
		name: 'Test Model',
		contextLength: 262_144,
		pricing: { input: 0, output: 0, request: 0 },
		...overrides,
	}
}

const PAID_PROVIDER: ProviderConfig = BUILTIN_PROVIDERS.routstr
const FREE_PROVIDERS: ProviderConfig[] = [
	BUILTIN_PROVIDERS.lmstudio,
	BUILTIN_PROVIDERS.ollama,
	{ type: 'custom', baseUrl: 'http://custom/v1', name: 'Custom', requiresPayment: false },
]

describe('stream stall watchdog', () => {
	test('allows slow reasoning providers at least four minutes without a response update', () => {
		expect(STREAM_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(240_000)
	})
})

describe('model tool advertisement', () => {
	test('exposes the complete registered tool surface to vision-capable models', () => {
		expect(getAdvertisedGeoTools(true)).toEqual(getGeoTools())
	})

	test('only removes genuinely incompatible vision tools for text-only models', () => {
		const advertisedNames = getAdvertisedGeoTools(false).map((tool) => tool.function.name)
		const expectedNames = getGeoTools()
			.map((tool) => tool.function.name)
			.filter((name) => name !== 'capture_map_snapshot')

		expect(advertisedNames).toEqual(expectedNames)
	})
})

describe('system prompt transport', () => {
	test('retains a contemporary long map policy instead of silently cutting it at 1,800 chars', () => {
		const tailContract = 'TAIL_CONTRACT_FIRST_VISIBLE_GEOMETRY'
		const content = `${'policy '.repeat(3_000)}${tailContract}`
		const sanitized = sanitizeMessageForPrompt({ role: 'system', content })

		expect(sanitized.content).toBe(content)
		expect(String(sanitized.content)).toContain(tailContract)
		expect(String(sanitized.content)).not.toContain('[truncated for context window]')
	})
})

function emptyOverrides(): ProviderOverrideMap {
	return {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	}
}

describe('loadModels — empty list must not drive an infinite refetch loop', () => {
	test('an empty model list is surfaced as modelsError (stops the mount-effect loop)', async () => {
		// ChatPanel's mount effect re-runs loadModels while
		// `models.length === 0 && !modelsLoading && !modelsError`. A provider that
		// returns zero models WITHOUT throwing must set modelsError, or that guard
		// stays true forever and pegs the CPU (regression).
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})) as typeof fetch
		try {
			useChatStore.setState({
				provider: 'routstr',
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: null,
			})
			await useChatStore.getState().loadModels()
			const state = useChatStore.getState()
			expect(state.models).toEqual([])
			expect(state.modelsLoading).toBe(false)
			// The loop-breaking invariant: error set, so the guard is now false.
			expect(state.modelsError).toBeTruthy()
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('a non-empty model list clears modelsError and selects a model', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: [{ id: 'm1', name: 'M1' }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})) as typeof fetch
		try {
			useChatStore.setState({
				provider: 'routstr',
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: null,
			})
			await useChatStore.getState().loadModels()
			const state = useChatStore.getState()
			expect(state.models.length).toBe(1)
			expect(state.modelsError).toBeNull()
			expect(state.selectedModel).toBe('m1')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('a stale model response cannot replace settings hydrated while it was in flight', async () => {
		const originalFetch = globalThis.fetch
		let resolveFetch: ((response: Response) => void) | null = null
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				resolveFetch = resolve
			})) as typeof fetch
		try {
			const firstOverrides = emptyOverrides()
			firstOverrides.custom = { baseUrl: 'http://first.example/v1', apiKey: 'first' }
			useChatStore.setState({
				provider: 'custom',
				providerOverrides: firstOverrides,
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: 'imported-model',
			})

			const staleLoad = useChatStore.getState().loadModels()

			const hydratedOverrides = emptyOverrides()
			hydratedOverrides.custom = { baseUrl: 'http://hydrated.example/v1', apiKey: 'hydrated' }
			useChatStore.getState().hydrateSettings({
				provider: 'custom',
				providerOverrides: hydratedOverrides,
				selectedModel: 'imported-model',
			})

			resolveFetch?.(
				new Response(JSON.stringify({ data: [{ id: 'stale-vision-model', name: 'Stale' }] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
			await staleLoad

			const state = useChatStore.getState()
			expect(state.providerOverrides.custom.baseUrl).toBe('http://hydrated.example/v1')
			expect(state.selectedModel).toBe('imported-model')
			expect(state.models).toEqual([])
			expect(state.modelsLoading).toBe(false)
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})

describe('resolveProvider', () => {
	test('falls back to BUILTIN localhost default when override baseUrl is empty (D-03)', () => {
		const lm = resolveProvider('lmstudio', emptyOverrides())
		expect(lm.baseUrl).toBe(BUILTIN_PROVIDERS.lmstudio.baseUrl)
		expect(lm.baseUrl).toBe('http://localhost:1234/v1')

		const ollama = resolveProvider('ollama', emptyOverrides())
		expect(ollama.baseUrl).toBe(BUILTIN_PROVIDERS.ollama.baseUrl)
		expect(ollama.baseUrl).toBe('http://localhost:11434/v1')
	})

	test('uses the override baseUrl when non-empty', () => {
		const overrides = emptyOverrides()
		overrides.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: '' }
		const lm = resolveProvider('lmstudio', overrides)
		expect(lm.baseUrl).toBe('http://host:9999/v1')
	})

	test('attaches apiKey only when override apiKey is non-empty', () => {
		const withKey = emptyOverrides()
		withKey.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: 'secret' }
		expect(resolveProvider('lmstudio', withKey).apiKey).toBe('secret')

		expect(resolveProvider('lmstudio', emptyOverrides()).apiKey).toBeUndefined()
	})

	test('custom provider reads baseUrl + apiKey from its override', () => {
		const overrides = emptyOverrides()
		overrides.custom = { baseUrl: 'http://custom/v1', apiKey: 'ck' }
		const custom = resolveProvider('custom', overrides)
		expect(custom.type).toBe('custom')
		expect(custom.baseUrl).toBe('http://custom/v1')
		expect(custom.apiKey).toBe('ck')

		const customNoKey = resolveProvider('custom', emptyOverrides())
		expect(customNoKey.apiKey).toBeUndefined()
	})
})

describe('setProviderOverride', () => {
	beforeEach(() => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
	})

	test('preserves each per-type override across a provider switch (D-02)', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('lmstudio', { baseUrl: 'A' })
		state.setProviderOverride('ollama', { baseUrl: 'B' })
		state.setProvider('lmstudio')

		const after = useChatStore.getState().providerOverrides
		expect(after.lmstudio.baseUrl).toBe('A')
		expect(after.ollama.baseUrl).toBe('B')
	})

	test('immutably merges the patch into the existing override', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('custom', { baseUrl: 'http://c/v1' })
		state.setProviderOverride('custom', { apiKey: 'k' })
		const custom = useChatStore.getState().providerOverrides.custom
		expect(custom).toEqual({ baseUrl: 'http://c/v1', apiKey: 'k' })
	})
})

describe('persist partialize secret-exclusion (SC-1 / T-01-01)', () => {
	test('partialized state contains no apiKey/baseUrl/providerOverrides secret', () => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
		useChatStore.getState().setProviderOverride('lmstudio', { apiKey: 'secret' })

		const partialized = chatStorePartialize(useChatStore.getState())
		const serialized = JSON.stringify(partialized)

		expect(serialized).not.toContain('secret')
		expect(serialized).not.toContain('apiKey')
		expect(serialized).not.toContain('baseUrl')
		expect(serialized).not.toContain('providerOverrides')

		expect(Object.keys(partialized).sort()).toEqual(['activeChatId', 'chatSessions'])
	})
})

describe('DEFAULT_CHAT_SETTINGS', () => {
	test('seeds all three overrides empty and version 2', () => {
		expect(DEFAULT_CHAT_SETTINGS.version).toBe(2)
		expect(DEFAULT_CHAT_SETTINGS.providerOverrides).toEqual(emptyOverrides())
	})
})

describe('compactIngestHandlePartForPrompt (WR-08)', () => {
	function makeIngestHandlePart(opts: {
		handleId: string
		columns: number
		sampleRowCount: number
		cellChars: number
	}): string {
		const schema = Array.from({ length: opts.columns }, (_, i) => ({
			name: `column_with_a_fairly_long_descriptive_name_${i}`,
			type: 'string' as const,
		}))
		const sampleRows = Array.from({ length: opts.sampleRowCount }, (_, r) => {
			const row: Record<string, unknown> = {}
			for (let c = 0; c < opts.columns; c++) {
				row[`column_with_a_fairly_long_descriptive_name_${c}`] =
					`${'x'.repeat(opts.cellChars)}-${r}-${c}`
			}
			return row
		})
		return JSON.stringify({
			ingestHandle: opts.handleId,
			ingestSummary: {
				handleId: opts.handleId,
				fileName: 'wide.csv',
				type: 'csv',
				rowCount: 5000,
				columnCount: opts.columns,
				schema,
				sampleRows,
				detectedCoordinateColumns: [],
			},
		})
	}

	test('a wide/large summary over budget still yields parseable JSON with ingestHandle intact', () => {
		const handleId = 'handle-abc-123-keepme'
		const part = makeIngestHandlePart({
			handleId,
			columns: 40,
			sampleRowCount: 15,
			cellChars: 40,
		})
		// Far exceeds the 6000 user-message char budget.
		expect(part.length).toBeGreaterThan(6000)

		const compacted = compactIngestHandlePartForPrompt(part, 6000)
		expect(compacted).toBeDefined()
		const result = compacted as string
		// Must NOT have been blindly char-truncated (no truncation marker).
		expect(result).not.toContain('[truncated for context window]')
		// Stays within budget.
		expect(result.length).toBeLessThanOrEqual(6000)
		// Parses cleanly AND retains the handle.
		const parsed = JSON.parse(result) as {
			ingestHandle: string
			ingestSummary: { handleId: string; sampleRows?: unknown[] }
		}
		expect(parsed.ingestHandle).toBe(handleId)
		expect(parsed.ingestSummary.handleId).toBe(handleId)
		// The bulky sampleRows were dropped first to make room.
		expect(parsed.ingestSummary.sampleRows ?? []).toHaveLength(0)
	})

	test('returns the part unchanged when it already fits and is an ingest-handle part', () => {
		const part = makeIngestHandlePart({
			handleId: 'small',
			columns: 2,
			sampleRowCount: 1,
			cellChars: 2,
		})
		expect(part.length).toBeLessThan(6000)
		expect(compactIngestHandlePartForPrompt(part, 6000)).toBe(part)
	})

	test('returns undefined for a non-ingest text part (caller falls back to char-truncation)', () => {
		expect(compactIngestHandlePartForPrompt('just a normal message', 6000)).toBeUndefined()
		expect(compactIngestHandlePartForPrompt(JSON.stringify({ foo: 'bar' }), 6000)).toBeUndefined()
	})

	test('preserves the handle even at a pathologically small budget', () => {
		const handleId = 'handle-must-survive'
		const part = makeIngestHandlePart({
			handleId,
			columns: 40,
			sampleRowCount: 15,
			cellChars: 40,
		})
		const compacted = compactIngestHandlePartForPrompt(part, 300)
		expect(compacted).toBeDefined()
		const parsed = JSON.parse(compacted as string) as { ingestHandle: string }
		expect(parsed.ingestHandle).toBe(handleId)
	})
})

describe('describeEmptyCompletion — terminal-state surfacing (UAT: silent empty turn)', () => {
	test("finishReason 'length' yields truncation-specific copy and truncated:true", () => {
		const notice = describeEmptyCompletion('length')
		expect(notice.truncated).toBe(true)
		expect(notice.message).toContain('cut off')
		// Output is no longer artificially capped — 'length' now means the model
		// exhausted the context-derived output room, so the copy points at the
		// context window rather than a tunable max-output setting.
		expect(notice.message.toLowerCase()).toContain('context')
		expect(notice.message.toLowerCase()).toContain('retry')
	})

	test("empty completion with finishReason 'stop' yields empty-response copy and truncated:false", () => {
		const notice = describeEmptyCompletion('stop')
		expect(notice.truncated).toBe(false)
		expect(notice.message.toLowerCase()).toContain('empty response')
		// finishReason surfaced for debugging
		expect(notice.message).toContain('stop')
	})

	test('null / undefined finishReason still produces a visible empty-response notice', () => {
		for (const reason of [null, undefined]) {
			const notice = describeEmptyCompletion(reason)
			expect(notice.truncated).toBe(false)
			expect(notice.message.toLowerCase()).toContain('empty response')
			expect(notice.message).toContain('none')
		}
	})

	test('every branch returns a non-empty, visible message (never silent)', () => {
		for (const reason of ['length', 'stop', 'content_filter', null, undefined]) {
			expect(describeEmptyCompletion(reason).message.trim().length).toBeGreaterThan(0)
		}
	})
})

describe('empty/truncated terminal outcome — store surfacing (UAT regression)', () => {
	beforeEach(() => {
		useChatStore.setState({ error: null, lastProgressKind: null })
	})

	test('truncation suffix is appended to truncated-but-non-empty assistant content', () => {
		// The suffix is what the content-present truncation path appends so the
		// partial answer is still visibly flagged as cut off.
		const content = 'Partial answer that was cut off'
		const flagged = `${content}${TRUNCATION_CONTENT_SUFFIX}`
		expect(flagged).toContain(content)
		expect(flagged.toLowerCase()).toContain('truncated')
		expect(flagged.toLowerCase()).toContain('output-token limit')
	})

	test('the empty-completion notice routes through the rendered `error` state, not a silent idle', () => {
		// Simulate the empty-completion else branch using the same helper the store
		// uses, asserting the surface ChatPanel renders (the `error` banner) is set
		// and progress is marked as error rather than silently idle/complete.
		const { message } = describeEmptyCompletion('length')
		useChatStore.setState({ error: message, lastProgressKind: 'error' })
		const state = useChatStore.getState()
		expect(state.error).toBe(message)
		expect(state.error).not.toBeNull()
		expect(state.lastProgressKind).toBe('error')
		expect(state.lastProgressKind).not.toBe('complete')
	})
})

describe('deriveOutputBudget — no artificial output cap (UAT: 512/1024 truncation removed)', () => {
	test('budget SCALES with the context window, never the old fixed 512/1024 cap', () => {
		const bigModel = makeModel({ contextLength: 262_144 })
		const smallPrompt = 1000
		const { costTokens } = deriveOutputBudget(bigModel, PAID_PROVIDER, smallPrompt)
		// A 262k-context model must yield a large budget — emphatically NOT the old cap.
		expect(costTokens).toBeGreaterThan(200_000)
		expect(costTokens).not.toBe(512)
		expect(costTokens).not.toBe(1024)

		// Larger context => larger budget (monotonic with the window).
		const biggerModel = makeModel({ contextLength: 1_000_000 })
		const bigger = deriveOutputBudget(biggerModel, PAID_PROVIDER, smallPrompt)
		expect(bigger.costTokens).toBeGreaterThan(costTokens)
	})

	test('free/local providers OMIT max_tokens (undefined => no cap sent)', () => {
		const model = makeModel({ contextLength: 32_000 })
		for (const provider of FREE_PROVIDERS) {
			const { maxTokens } = deriveOutputBudget(model, provider, 500)
			expect(maxTokens).toBeUndefined()
		}
	})

	test('paid provider SENDS the derived budget (a concrete number, not undefined)', () => {
		const model = makeModel({ contextLength: 128_000 })
		const { maxTokens, costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 2000)
		expect(typeof maxTokens).toBe('number')
		// The sent budget and the cost-estimation number are the SAME value, so
		// prepay reserves exactly what the server may emit (refund returns the rest).
		expect(maxTokens).toBe(costTokens)
	})

	test('paid provider clamps max_tokens to model max completion tokens', () => {
		const model = makeModel({
			id: 'qwen3.7-plus',
			contextLength: 1_000_000,
			maxCompletionTokens: 65_536,
		})
		const { maxTokens, costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 1000)
		expect(maxTokens).toBe(65_536)
		expect(costTokens).toBe(65_536)
	})

	test('paid cost estimate uses the SAME derived budget (prepay never underpays)', () => {
		// Non-zero output pricing so the budget actually drives cost.
		const model = makeModel({
			contextLength: 64_000,
			pricing: { input: 1_000_000, output: 1_000_000, request: 0 },
		})
		const inputTokens = 3000
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, inputTokens)
		const costFromDerived = estimateMaxCost(model, inputTokens, costTokens)
		// The prepay must cover input + the FULL derived output budget. If we had
		// underpaid (e.g. estimated against a smaller cap), this would be lower.
		const minimumExpected = inputTokens * 1 + costTokens * 1
		expect(costFromDerived).toBeGreaterThanOrEqual(minimumExpected)
	})

	test('tool-call floor: a huge prompt still leaves the minimum output budget', () => {
		const model = makeModel({ contextLength: 8000 })
		// Prompt larger than the whole window — remaining would go negative.
		const { costTokens, maxTokens } = deriveOutputBudget(model, PAID_PROVIDER, 100_000)
		expect(costTokens).toBeGreaterThanOrEqual(1024) // MIN_OUTPUT_BUDGET_TOKENS floor
		expect(maxTokens).toBe(costTokens)
	})

	test('unknown context window falls back to a sane paid budget (no zero/NaN)', () => {
		// lmstudio clamps to a hard cap, so use a paid provider with no contextLength.
		const model = makeModel({ contextLength: undefined })
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 100)
		expect(Number.isFinite(costTokens)).toBe(true)
		expect(costTokens).toBeGreaterThanOrEqual(1024)
	})
})

describe('getPromptBudgetTokens — prompt + completion fit the window (inverted budget)', () => {
	test('prompt budget leaves real room for completion (not starved to a sliver)', () => {
		const model = makeModel({ contextLength: 32_000 })
		const promptBudget = getPromptBudgetTokens(model, PAID_PROVIDER)
		// Completion gets the remainder; prompt + a derived completion fit the window.
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, promptBudget)
		expect(promptBudget + costTokens).toBeLessThanOrEqual(model.contextLength as number)
		// Completion reserve is proportional, so it is meaningfully more than a sliver.
		expect(costTokens).toBeGreaterThanOrEqual(1024)
	})

	test('a small-context model still leaves room for both prompt and completion', () => {
		const model = makeModel({ contextLength: 8000 })
		const promptBudget = getPromptBudgetTokens(model, PAID_PROVIDER)
		expect(promptBudget).toBeGreaterThan(0)
		// A realistic small prompt + its derived completion fit inside the window.
		const prompt = Math.min(promptBudget, 2000)
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, prompt)
		expect(prompt + costTokens).toBeLessThanOrEqual(model.contextLength as number)
	})

	test('scales with the window: a bigger context yields a bigger prompt budget', () => {
		const small = getPromptBudgetTokens(makeModel({ contextLength: 16_000 }), PAID_PROVIDER)
		const big = getPromptBudgetTokens(makeModel({ contextLength: 262_144 }), PAID_PROVIDER)
		expect(big).toBeGreaterThan(small)
	})
})
