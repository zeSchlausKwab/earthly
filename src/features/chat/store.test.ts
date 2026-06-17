import { beforeEach, describe, expect, test } from 'bun:test'
import { BUILTIN_PROVIDERS } from './routstr'
import {
	DEFAULT_CHAT_SETTINGS,
	chatStorePartialize,
	compactIngestHandlePartForPrompt,
	resolveProvider,
	useChatStore,
} from './store'
import type { ProviderOverrideMap } from './store'

function emptyOverrides(): ProviderOverrideMap {
	return {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	}
}

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
