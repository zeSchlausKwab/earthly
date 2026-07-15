import { describe, expect, test } from 'bun:test'
import type { OutboxItem } from '@/platform/contracts'
import { failedRelayResults, pendingOutboxRelays, requiredPublishRelays } from './publishOutbox'

describe('native publish outbox helpers', () => {
	test('marks configured baseline relays as required and keeps routed relays optional', () => {
		expect(
			requiredPublishRelays(
				['wss://inbox.example', 'wss://baseline.example/'],
				['wss://baseline.example'],
			),
		).toEqual(['wss://baseline.example/'])
	})

	test('requires all explicit targets when no configured baseline is present', () => {
		expect(
			requiredPublishRelays(['wss://one.example', 'wss://two.example'], ['wss://other.example']),
		).toEqual(['wss://one.example/', 'wss://two.example/'])
	})

	test('retries only relays that have not acknowledged the immutable event', () => {
		const item = {
			relays: [
				{ relayUrl: 'wss://saved.example/', state: 'acknowledged' },
				{ relayUrl: 'wss://offline.example/', state: 'rejected' },
			],
		} as OutboxItem
		expect(pendingOutboxRelays(item)).toEqual(['wss://offline.example/'])
	})

	test('records a failed attempt for every target when the pool throws', () => {
		expect(failedRelayResults(['wss://one.example/'], new Error('offline'))).toEqual([
			{ relayUrl: 'wss://one.example/', ok: false, message: 'offline' },
		])
	})
})
