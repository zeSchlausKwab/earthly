import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
	clearGroupEditorDraft,
	readGroupEditorDraft,
	type GroupEditorDraftSnapshot,
	writeGroupEditorDraft,
} from './editorDraft'

const PUBKEY = 'a'.repeat(64)
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

const completeDraft: GroupEditorDraftSnapshot = {
	name: 'Retained Alpine context',
	description: 'Unsaved **Markdown** with nostr:naddr1example',
	curatedReferences: ['nostr:naddr1curated'],
	image: 'https://cdn.example/context.jpg',
	governance: 'schema',
	schemaMode: 'advanced',
	allowedGeometryTypes: ['Point', 'Polygon'],
	rows: [{ name: 'period', type: 'enum', required: true, allowedValues: ['Roman', 'Medieval'] }],
	advancedJson: '{"type":"object","properties":{"period":{"type":"string"}}}',
	sampleJson: '{"period":"Roman"}',
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

beforeEach(() => backing.clear())

describe('Context editor local drafts', () => {
	test('round-trips every user-editable field for an unmount/remount hydration', () => {
		writeGroupEditorDraft('edit:author:context-id', completeDraft, PUBKEY)

		const restored = readGroupEditorDraft('edit:author:context-id', PUBKEY)
		expect(restored).toMatchObject(completeDraft)
		expect(restored?.updatedAt).toBeGreaterThan(0)
	})

	test('keeps create and edit identities independent', () => {
		writeGroupEditorDraft('new-context', { ...completeDraft, name: 'New Context' }, PUBKEY)
		writeGroupEditorDraft('edit:author:context-id', { ...completeDraft, name: 'Edited' }, PUBKEY)

		expect(readGroupEditorDraft('new-context', PUBKEY)?.name).toBe('New Context')
		expect(readGroupEditorDraft('edit:author:context-id', PUBKEY)?.name).toBe('Edited')
	})

	test('clear removes the retained draft so discard/publish cannot resurrect it', () => {
		writeGroupEditorDraft('edit:author:context-id', completeDraft, PUBKEY)
		clearGroupEditorDraft('edit:author:context-id', PUBKEY)

		expect(readGroupEditorDraft('edit:author:context-id', PUBKEY)).toBeNull()
	})
})
