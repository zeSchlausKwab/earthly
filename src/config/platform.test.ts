import { afterEach, describe, expect, test } from 'bun:test'
import { isTauri } from './platform'

const originalWindow = globalThis.window

afterEach(() => {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: originalWindow,
		writable: true,
	})
})

describe('native platform detection', () => {
	test('recognizes the Tauri v2 internal bridge', () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { __TAURI_INTERNALS__: { invoke: () => undefined } },
			writable: true,
		})
		expect(isTauri()).toBe(true)
	})

	test('does not classify an ordinary browser as Tauri', () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {},
			writable: true,
		})
		expect(isTauri()).toBe(false)
	})
})
