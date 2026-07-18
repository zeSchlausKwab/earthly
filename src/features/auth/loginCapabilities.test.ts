import { afterEach, describe, expect, test } from 'bun:test'
import { shouldOfferNip07Login } from './loginCapabilities'

const hadWindow = Object.hasOwn(globalThis, 'window')
const originalWindow = globalThis.window

afterEach(() => {
	if (!hadWindow) {
		Reflect.deleteProperty(globalThis, 'window')
		return
	}
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: originalWindow,
		writable: true,
	})
})

describe('NIP-07 login availability', () => {
	test('is offered in an ordinary browser', () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: {},
			writable: true,
		})

		expect(shouldOfferNip07Login()).toBe(true)
	})

	test('is hidden in Tauri apps', () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { __TAURI_INTERNALS__: { invoke: () => undefined } },
			writable: true,
		})

		expect(shouldOfferNip07Login()).toBe(false)
	})
})
