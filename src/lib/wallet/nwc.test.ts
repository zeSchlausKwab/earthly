import { beforeEach, describe, expect, test } from 'bun:test'
import {
	loadNwcConnection,
	parseNwcConnection,
	removeNwcConnection,
	saveNwcConnection,
} from './nwc'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
		key: (index: number) => [...values.keys()][index] ?? null,
		get length() {
			return values.size
		},
	} satisfies Storage,
})

const pubkey = '1'.repeat(64)
const uri = `nostr+walletconnect://${'2'.repeat(64)}?relay=${encodeURIComponent(
	'wss://relay.example',
)}&secret=${'3'.repeat(64)}&lud16=wallet%40example.com`

describe('NWC connection persistence', () => {
	beforeEach(() => values.clear())

	test('accepts a scanned NIP-47 URI and persists it per account', () => {
		const parsed = parseNwcConnection(uri)
		expect(parsed.relays).toEqual(['wss://relay.example/'])
		expect(parsed.lud16).toBe('wallet@example.com')

		saveNwcConnection(uri, pubkey)
		expect(loadNwcConnection(pubkey)).toEqual(parsed)

		removeNwcConnection(pubkey)
		expect(loadNwcConnection(pubkey)).toBeNull()
	})

	test('rejects a QR payload that is not an NWC connection', () => {
		expect(() => parseNwcConnection('https://example.com/not-a-wallet')).toThrow(
			'invalid wallet connect uri protocol',
		)
	})
})
