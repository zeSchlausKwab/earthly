import { describe, expect, test } from 'bun:test'
import { assertAllowedExternalProtocol, normalizeLightningUri } from './externalProtocol'

describe('external app protocols', () => {
	test('normalizes Lightning invoices without duplicating the scheme', () => {
		expect(normalizeLightningUri('  lnbc123  ')).toBe('lightning:lnbc123')
		expect(normalizeLightningUri('LIGHTNING:lnbc123')).toBe('LIGHTNING:lnbc123')
	})

	test('allows only signer and wallet protocols', () => {
		expect(
			assertAllowedExternalProtocol('nostrconnect://client?relay=wss%3A%2F%2Frelay.test'),
		).toBe('nostrconnect://client?relay=wss%3A%2F%2Frelay.test')
		expect(assertAllowedExternalProtocol('bunker://signer')).toBe('bunker://signer')
		expect(assertAllowedExternalProtocol('lightning:lnbc123')).toBe('lightning:lnbc123')
		expect(() => assertAllowedExternalProtocol('https://example.com')).toThrow()
		expect(() => assertAllowedExternalProtocol('javascript:alert(1)')).toThrow()
	})
})
