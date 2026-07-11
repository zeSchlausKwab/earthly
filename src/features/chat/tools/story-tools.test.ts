import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { ToolEntry } from './registry'
import { registerStoryTools, resetStoryDraftOwnership } from './story-tools'

// readScopedStorage/writeScopedStorage no-op without a window — give the tools a
// map-backed localStorage so draft round-trips are observable.
const backing = new Map<string, string>()
const localStorageStub = {
	getItem: (key: string) => backing.get(key) ?? null,
	setItem: (key: string, value: string) => {
		backing.set(key, value)
	},
	removeItem: (key: string) => {
		backing.delete(key)
	},
}

let hadWindow = false
let previousWindow: unknown

const tools = new Map<string, ToolEntry>()
registerStoryTools((entry) => tools.set(entry.name, entry))

const call = (name: string, args: Record<string, unknown> = {}) => {
	const entry = tools.get(name)
	if (!entry) throw new Error(`tool not registered: ${name}`)
	return entry.handler(args, undefined) as Promise<Record<string, unknown>>
}

beforeAll(() => {
	hadWindow = 'window' in globalThis
	previousWindow = (globalThis as Record<string, unknown>).window
	;(globalThis as Record<string, unknown>).window = { localStorage: localStorageStub }
})

afterAll(() => {
	if (hadWindow) {
		;(globalThis as Record<string, unknown>).window = previousWindow
	} else {
		delete (globalThis as Record<string, unknown>).window
	}
})

beforeEach(() => {
	backing.clear()
	resetStoryDraftOwnership()
})

describe('story draft tools', () => {
	it('registers both tools', () => {
		expect(tools.has('read_story_draft')).toBe(true)
		expect(tools.has('write_story_draft')).toBe(true)
	})

	it('reads an empty draft slot', async () => {
		const result = await call('read_story_draft')
		expect(result.ok).toBe(true)
		expect(result.exists).toBe(false)
		expect(result.draft).toBeNull()
	})

	it('writes then reads back a draft', async () => {
		const write = await call('write_story_draft', {
			title: 'Ras Laffan shipping lanes',
			summary: 'The LNG corridors out of Qatar.',
			markdown: '# Lanes\n\nSee nostr:naddr1example…',
		})
		expect(write.ok).toBe(true)

		const read = await call('read_story_draft')
		expect(read.exists).toBe(true)
		expect(read.authoredByThisSession).toBe(true)
		const draft = read.draft as Record<string, unknown>
		expect(draft.title).toBe('Ras Laffan shipping lanes')
		expect(draft.markdown).toContain('nostr:naddr1example')
	})

	it('refuses to overwrite a draft this session did not write', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		// Simulate a fresh session: the existing draft is no longer AI-owned.
		resetStoryDraftOwnership()

		expect(call('write_story_draft', { title: 'AI draft', markdown: 'new' })).rejects.toThrow(
			/overwrite/,
		)

		const overwritten = await call('write_story_draft', {
			title: 'AI draft',
			markdown: 'new',
			overwrite: true,
		})
		expect(overwritten.ok).toBe(true)
	})

	it('freely rewrites its own draft within a session', async () => {
		await call('write_story_draft', { title: 'v1', markdown: 'one' })
		const second = await call('write_story_draft', { title: 'v2', markdown: 'two' })
		expect(second.ok).toBe(true)
		const read = await call('read_story_draft')
		expect((read.draft as Record<string, unknown>).title).toBe('v2')
	})

	it('validates required fields', async () => {
		expect(call('write_story_draft', { markdown: 'body' })).rejects.toThrow(/title/)
		expect(call('write_story_draft', { title: 'x' })).rejects.toThrow(/markdown/)
		expect(call('write_story_draft', { title: 'x', markdown: '   ' })).rejects.toThrow(/markdown/)
	})
})
