import { describe, expect, test } from 'bun:test'
import type { OutboxEnqueueRequest, OutboxItem, PublishOutboxService } from '@/platform/contracts'
import { PlatformCommandError } from '@/platform/errors'
import {
	enqueueDurablePublish,
	failedRelayResults,
	pendingOutboxRelays,
	requiredPublishRelays,
} from './publishOutbox'

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

	test('retries the same immutable native enqueue once after a transient command failure', async () => {
		const calls: OutboxEnqueueRequest[] = []
		const item = { id: 'queued' } as OutboxItem
		const service = {
			enqueue: async (input: OutboxEnqueueRequest) => {
				calls.push(input)
				if (calls.length === 1) {
					throw new PlatformCommandError('database is busy', 'outbox-database-failed')
				}
				return item
			},
		} as PublishOutboxService
		const input = {
			version: 1,
			eventJson: '{"id":"same-event"}',
			routing: 'outbox',
			relayUrls: ['wss://relay.example'],
			requiredRelayUrls: ['wss://relay.example'],
		} satisfies OutboxEnqueueRequest

		expect(await enqueueDurablePublish(service, input)).toBe(item)
		expect(calls).toEqual([input, input])
	})
})
