/**
 * The spend mutex serializes proof-spending wallet operations so two
 * concurrent payments can never select the same proofs ("token already
 * spent" at the mint). See withSpendLock in actions.ts.
 */

import { describe, expect, test } from 'bun:test'
import { withSpendLock } from './actions'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('withSpendLock', () => {
	test('serializes concurrent operations in submission order', async () => {
		const order: string[] = []
		const first = withSpendLock(async () => {
			order.push('first:start')
			await tick()
			await tick()
			order.push('first:end')
			return 1
		})
		const second = withSpendLock(async () => {
			order.push('second:start')
			return 2
		})

		expect(await first).toBe(1)
		expect(await second).toBe(2)
		expect(order).toEqual(['first:start', 'first:end', 'second:start'])
	})

	test('a failing operation rejects its caller but does not block the next', async () => {
		const failing = withSpendLock(async () => {
			throw new Error('mint exploded')
		})
		const following = withSpendLock(async () => 'ok')

		await expect(failing).rejects.toThrow('mint exploded')
		expect(await following).toBe('ok')
	})
})
