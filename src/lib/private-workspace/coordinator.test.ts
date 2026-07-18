import { describe, expect, test } from 'bun:test'
import { withCoordinatorDeadline } from './coordinator'

describe('Cordn coordinator deadlines', () => {
	test('rejects an operation that never settles', async () => {
		await expect(
			withCoordinatorDeadline(new Promise<never>(() => undefined), 'Cordn test request', 5),
		).rejects.toThrow('Cordn test request timed out')
	})

	test('preserves a response that arrives before the deadline', async () => {
		await expect(
			withCoordinatorDeadline(Promise.resolve('ready'), 'Cordn test request', 50),
		).resolves.toBe('ready')
	})
})
