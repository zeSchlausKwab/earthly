import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { clearStoryDraft, readStoryDraft, writeStoryDraft } from './draft'

const PUBKEY = 'b'.repeat(64)
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

beforeEach(() => backing.clear())

describe('Story editor local drafts', () => {
	test('round-trips exact unsaved values and the active authoring tab', () => {
		writeStoryDraft(
			'story-id',
			{
				title: '  Working title  ',
				summary: '',
				image: 'https://cdn.example/cover.jpg',
				content: '# Unsaved narrative\n',
				bodyTab: 'preview',
			},
			PUBKEY,
		)

		expect(readStoryDraft('story-id', PUBKEY)).toMatchObject({
			title: '  Working title  ',
			summary: '',
			image: 'https://cdn.example/cover.jpg',
			content: '# Unsaved narrative\n',
			bodyTab: 'preview',
		})
	})

	test('clear removes the draft after discard or successful publish', () => {
		writeStoryDraft('story-id', { title: 'Temporary' }, PUBKEY)
		clearStoryDraft('story-id', PUBKEY)

		expect(readStoryDraft('story-id', PUBKEY)).toBeNull()
	})
})
