import { describe, expect, test } from 'bun:test'
import { selectZapReceiptRelays } from './receiptRelays'

describe('selectZapReceiptRelays', () => {
	test('uses an externally reachable read relay when local development writes are loopback-only', () => {
		expect(
			selectZapReceiptRelays(
				['ws://localhost:3334'],
				['ws://localhost:3334', 'wss://relay.earthly.city'],
			),
		).toEqual(['wss://relay.earthly.city'])
	})

	test('prefers configured public write relays in production', () => {
		expect(
			selectZapReceiptRelays(
				['wss://relay.earthly.city'],
				['wss://relay.earthly.city', 'wss://relay.example'],
			),
		).toEqual(['wss://relay.earthly.city', 'wss://relay.example'])
	})

	test('falls back to the configured local relay for deterministic development tests', () => {
		expect(selectZapReceiptRelays(['ws://localhost:3334'], ['ws://localhost:3334'])).toEqual([
			'ws://localhost:3334',
		])
	})
})
