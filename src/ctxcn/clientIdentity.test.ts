import { describe, expect, test } from 'bun:test'
import { getContextVmSessionPrivateKey } from './clientIdentity'

const PREVIOUSLY_BUNDLED_KEY = '4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c'

describe('ContextVM session identity', () => {
	test('creates one valid, non-shared private key for the current process', () => {
		const first = getContextVmSessionPrivateKey()
		const second = getContextVmSessionPrivateKey()

		expect(first).toMatch(/^[0-9a-f]{64}$/)
		expect(first).toBe(second)
		expect(first).not.toBe(PREVIOUSLY_BUNDLED_KEY)
	})
})
