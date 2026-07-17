import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocalDraftPersistenceWarning } from '../components/LocalDraftPersistenceWarning'
import {
	getScopedStorageWriteFailures,
	subscribeScopedStorageWriteFailures,
	writeScopedStorage,
} from './persistence'

const TEST_KEY = 'earthly:test:scoped-write-failure'
const DRAFT_KEY = 'earthly:geo-editor:collection-drafts:v1'
const globalWithWindow = globalThis as typeof globalThis & { window?: Window }
const originalWindow = globalWithWindow.window

let shouldFail = false
let stored = new Map<string, string>()

beforeEach(() => {
	shouldFail = false
	stored = new Map()
	globalWithWindow.window = {
		localStorage: {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => {
				if (shouldFail) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
				stored.set(key, value)
			},
		} as Storage,
	} as Window
})

afterEach(() => {
	shouldFail = false
	writeScopedStorage(TEST_KEY, { recovered: true }, null)
	writeScopedStorage(DRAFT_KEY, { recovered: true }, null)
	globalWithWindow.window = originalWindow
})

describe('scoped storage write failures', () => {
	test('keeps a failed write observable until the same key saves successfully', () => {
		let notifications = 0
		const unsubscribe = subscribeScopedStorageWriteFailures(() => {
			notifications += 1
		})

		shouldFail = true
		writeScopedStorage(TEST_KEY, { draft: 'unsaved' }, null)

		const failure = Object.values(getScopedStorageWriteFailures()).find(
			(candidate) => candidate.baseKey === TEST_KEY,
		)
		expect(failure).toMatchObject({
			baseKey: TEST_KEY,
			scope: null,
			message: 'Storage quota exceeded',
		})
		expect(notifications).toBe(1)

		shouldFail = false
		writeScopedStorage(TEST_KEY, { draft: 'saved' }, null)
		expect(
			Object.values(getScopedStorageWriteFailures()).some(
				(candidate) => candidate.baseKey === TEST_KEY,
			),
		).toBe(false)
		expect(notifications).toBe(2)
		unsubscribe()
	})

	test('reports JSON serialization failures before localStorage is called', () => {
		const circular: Record<string, unknown> = {}
		circular.self = circular

		writeScopedStorage(TEST_KEY, circular, null)

		const failure = Object.values(getScopedStorageWriteFailures()).find(
			(candidate) => candidate.baseKey === TEST_KEY,
		)
		expect(failure?.message.toLowerCase()).toContain('cyclic')
		expect(stored.size).toBe(0)
	})

	test('renders a durable warning when local draft storage fails', () => {
		shouldFail = true
		writeScopedStorage(DRAFT_KEY, { draft: 'unsaved' }, null)

		const markup = renderToStaticMarkup(
			createElement(LocalDraftPersistenceWarning, { currentUserPubkey: null }),
		)
		expect(markup).toContain('Local draft not saved')
		expect(markup).toContain('only in this open session')
	})
})
