import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	getStoryEditorOpenRequest,
	resetStoryEditorOpenRequests,
} from '@/features/geo-editor/storyEditorBridge'
import type { ToolEntry } from './registry'
import { registerStoryTools, resetStoryDraftOwnership } from './story-tools'
import type { ToolExecutionContext } from './types'

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

const call = (name: string, args: Record<string, unknown> = {}, context?: ToolExecutionContext) => {
	const entry = tools.get(name)
	if (!entry) throw new Error(`tool not registered: ${name}`)
	return entry.handler(args, context) as Promise<Record<string, unknown>>
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
	resetStoryEditorOpenRequests()
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

		// The model cannot authorize itself by proactively setting overwrite:true.
		expect(
			call('write_story_draft', {
				title: 'AI draft',
				markdown: 'new',
				overwrite: true,
			}),
		).rejects.toThrow(/confirm/i)

		const overwritten = await call(
			'write_story_draft',
			{
				title: 'AI draft',
				markdown: 'new',
				overwrite: true,
			},
			{ userMessage: 'yes, overwrite the existing story draft' } as ToolExecutionContext,
		)
		expect(overwritten.ok).toBe(true)
	})

	it('freely rewrites its own draft within a session', async () => {
		await call('write_story_draft', { title: 'v1', markdown: 'one' })
		const second = await call('write_story_draft', { title: 'v2', markdown: 'two' })
		expect(second.ok).toBe(true)
		const read = await call('read_story_draft')
		expect((read.draft as Record<string, unknown>).title).toBe('v2')
	})

	it('does not treat an explicit refusal as overwrite confirmation', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		resetStoryDraftOwnership()

		expect(
			call(
				'write_story_draft',
				{ title: 'AI draft', markdown: 'new', overwrite: true },
				{ userMessage: 'Do not overwrite my existing draft.' },
			),
		).rejects.toThrow(/confirm/i)
	})

	it('surfaces the draft: a successful write fires a story-editor open request', async () => {
		expect(getStoryEditorOpenRequest()).toBeNull()

		await call('write_story_draft', { title: 'Surfaced', markdown: 'body' })
		const first = getStoryEditorOpenRequest()
		expect(first?.mode).toBe('create')
		expect(first?.nonce).toBe(1)

		// A follow-up write fires a NEW nonce so an already-open panel re-prefills.
		await call('write_story_draft', { title: 'Surfaced v2', markdown: 'body 2' })
		expect(getStoryEditorOpenRequest()?.nonce).toBe(2)
	})

	it('writes an existing published Story into its edit-draft slot', async () => {
		const identifier = 'east-german-travel'
		const event = finalizeEvent(
			{
				kind: ARTICLE_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					modelVersion: MODEL_VERSION,
					title: 'East German travel',
					content: 'Published body',
				}),
			},
			generateSecretKey(),
		)
		const pubkey = event.pubkey
		eventStore.add(event)
		const storyReference = `nostr:${nip19.naddrEncode({
			kind: ARTICLE_KIND,
			pubkey,
			identifier,
		})}`
		const published = await call('read_story_draft', { storyReference })
		expect(published).toMatchObject({ exists: true, source: 'published' })

		const result = await call('write_story_draft', {
			storyReference,
			title: 'East German travel',
			markdown: 'Updated with fine-grained references.',
		})
		expect(result).toMatchObject({ ok: true, draftKey: identifier, mode: 'edit' })
		expect(getStoryEditorOpenRequest()).toMatchObject({
			mode: 'edit',
			story: { dTag: identifier, pubkey },
		})
	})

	it('does not fire an open request when the overwrite gate rejects the write', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		resetStoryDraftOwnership()
		resetStoryEditorOpenRequests()

		expect(call('write_story_draft', { title: 'AI draft', markdown: 'new' })).rejects.toThrow(
			/overwrite/,
		)
		expect(getStoryEditorOpenRequest()).toBeNull()
	})

	it('validates required fields', async () => {
		expect(call('write_story_draft', { markdown: 'body' })).rejects.toThrow(/title/)
		expect(call('write_story_draft', { title: 'x' })).rejects.toThrow(/markdown/)
		expect(call('write_story_draft', { title: 'x', markdown: '   ' })).rejects.toThrow(/markdown/)
	})
})
