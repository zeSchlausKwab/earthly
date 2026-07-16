import { describe, expect, test } from 'bun:test'
import type { OutboxItemSummary } from '@/platform/contracts'
import {
	canDiscardOutboxItem,
	canRetryOutboxItem,
	outboxKindLabel,
	partitionOutbox,
	relayAcknowledgementCount,
	summarizeOutbox,
} from './outboxPresentation'

const item = (
	state: OutboxItemSummary['state'],
	createdAt: number,
	overrides: Partial<OutboxItemSummary> = {},
): OutboxItemSummary => ({
	version: 1,
	id: String(createdAt).padStart(64, '0'),
	eventId: String(createdAt).padStart(64, '0'),
	eventKind: 37_515,
	routing: 'configured',
	state,
	attemptCount: 0,
	createdAt,
	updatedAt: createdAt,
	relays: [
		{
			relayUrl: 'wss://relay.example/',
			required: true,
			state: 'pending',
			attempts: 0,
		},
	],
	...overrides,
})

describe('delivery ledger presentation', () => {
	test('summarizes waiting, attention, and delivered states', () => {
		expect(
			summarizeOutbox([
				item('queued', 1),
				item('delivering', 2),
				item('retryWait', 3),
				item('partial', 4),
				item('rejected', 5),
				item('delivered', 6),
			]),
		).toEqual({ waiting: 3, attention: 2, delivered: 1 })
	})

	test('partitions newest-first without mutating native order', () => {
		const original = [item('queued', 1), item('delivered', 3), item('partial', 2)]
		const result = partitionOutbox(original)

		expect(result.pending.map((entry) => entry.createdAt)).toEqual([2, 1])
		expect(result.history.map((entry) => entry.createdAt)).toEqual([3])
		expect(original.map((entry) => entry.createdAt)).toEqual([1, 3, 2])
	})

	test('exposes safe actions for the native state machine', () => {
		expect(canRetryOutboxItem(item('retryWait', 1))).toBe(true)
		expect(canRetryOutboxItem(item('queued', 1))).toBe(false)
		expect(canDiscardOutboxItem(item('partial', 1))).toBe(true)
		expect(canDiscardOutboxItem(item('delivering', 1))).toBe(false)
		expect(canDiscardOutboxItem(item('delivered', 1))).toBe(false)
	})

	test('labels known Earthly kinds and relay acknowledgements', () => {
		expect(outboxKindLabel(37_515)).toBe('Dataset')
		expect(outboxKindLabel(65_000)).toBe('Event kind 65000')
		expect(
			relayAcknowledgementCount(
				item('partial', 1, {
					relays: [
						{
							relayUrl: 'wss://one.example/',
							required: true,
							state: 'acknowledged',
							attempts: 1,
						},
						{
							relayUrl: 'wss://two.example/',
							required: false,
							state: 'rejected',
							attempts: 1,
						},
					],
				}),
			),
		).toBe(1)
	})
})
