import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
	AtlasPresentationValidationError,
	clearGroupEditorDraft,
	normalizeAtlasPresentationForPublish,
	readGroupEditorDraft,
	type GroupEditorDraftSnapshot,
	writeGroupEditorDraft,
} from './editorDraft'

const PUBKEY = 'a'.repeat(64)
const CURATED_MAP = `37515:${PUBKEY}:curated-map` as const
const FOREIGN_MAP = `37515:${'b'.repeat(64)}:foreign-map` as const
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
	presentation: { version: 9, future: { cameraMode: 'orbital' } },
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

	test('preserves unknown presentation data without interpreting it', () => {
		writeGroupEditorDraft('future', completeDraft, PUBKEY)
		expect(readGroupEditorDraft('future', PUBKEY)?.presentation).toEqual(completeDraft.presentation)
	})
})

describe('Atlas default-view publish validation', () => {
	test('accepts duplicate render instances of an exactly curated Map', () => {
		const presentation = {
			version: 1,
			layers: [
				{ id: 'base', source: CURATED_MAP, visible: true, opacityMultiplier: 1 },
				{
					id: 'detail',
					source: CURATED_MAP,
					featureIds: ['station-7'],
					visible: true,
					opacityMultiplier: 0.5,
				},
			],
		}

		expect(normalizeAtlasPresentationForPublish(presentation, [CURATED_MAP])).toEqual(presentation)
	})

	test('rejects a valid layer absent from the final exact a-address set', () => {
		const presentation = {
			version: 1,
			layers: [{ id: 'foreign', source: FOREIGN_MAP, visible: true, opacityMultiplier: 1 }],
		}

		expect(() => normalizeAtlasPresentationForPublish(presentation, [CURATED_MAP])).toThrow(
			AtlasPresentationValidationError,
		)
	})

	test('preserves a future raw value through unrelated publishes', () => {
		const future = { version: 9, renderer: { orbit: true } }
		expect(normalizeAtlasPresentationForPublish(future, [CURATED_MAP])).toBe(future)
	})

	test('refuses lossy normalization of malformed V1 layer entries', () => {
		const malformed = {
			version: 1,
			layers: [{ id: 'bad id', source: CURATED_MAP }],
		}
		expect(() => normalizeAtlasPresentationForPublish(malformed, [CURATED_MAP])).toThrow(
			AtlasPresentationValidationError,
		)
	})
})
