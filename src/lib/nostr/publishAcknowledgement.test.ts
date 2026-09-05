import { describe, expect, test } from 'bun:test'
import { requirePublishAcknowledgement } from './publishAcknowledgement'

describe('web publication acknowledgement', () => {
	test('rejects an empty result, including an empty write-relay configuration', () => {
		expect(() => requirePublishAcknowledgement([])).toThrow('No relay accepted')
	})
	test('surfaces relay rejection and connection errors even though the pool resolved', () => {
		expect(() =>
			requirePublishAcknowledgement([
				{ from: 'ws://localhost:3334', ok: false, message: 'blocked: writes disabled' },
				{ from: 'ws://localhost:3335', ok: false, message: 'Connection timed out' },
			]),
		).toThrow('blocked: writes disabled; Connection timed out')
	})
	test('does not mark an accepted event failed because another relay was offline', () => {
		expect(() =>
			requirePublishAcknowledgement([
				{ from: 'ws://localhost:3334', ok: true },
				{ from: 'ws://localhost:3335', ok: false, message: 'offline' },
			]),
		).not.toThrow()
	})
	test('bounds and deduplicates untrusted relay messages', () => {
		const response = {
			from: 'ws://localhost:3334',
			ok: false,
			message: 'blocked\nagain ' + 'x'.repeat(500),
		}
		try {
			requirePublishAcknowledgement([response, response])
			throw new Error('Expected rejection')
		} catch (error) {
			expect((error as Error).message.length).toBeLessThan(300)
			expect((error as Error).message).not.toContain('\n')
		}
	})
})
