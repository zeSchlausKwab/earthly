import { describe, expect, it } from 'bun:test'
import type { Interceptor, InterceptorContext } from './interceptor'
import { runInterceptors } from './interceptor'

describe('runInterceptors (D-12 scaffold)', () => {
	const ctx: InterceptorContext = { intent: 'add', featureIds: ['a', 'b'] }

	it('returns the context unchanged with an empty chain (no-op pass-through)', () => {
		expect(runInterceptors(ctx, [])).toEqual(ctx)
	})

	it('defaults the chain to empty', () => {
		expect(runInterceptors(ctx)).toEqual(ctx)
	})

	it('lets an interceptor observe { intent, featureIds } without changing default output', () => {
		const observed: InterceptorContext[] = []
		const observer: Interceptor = (c) => {
			observed.push(c)
		}
		const result = runInterceptors(ctx, [observer])
		expect(observed).toEqual([ctx])
		expect(result).toEqual(ctx)
	})

	it('lets an interceptor adjust the intent (proves Phase 5 can hook the gate)', () => {
		const escalate: Interceptor = () => ({ intent: 'delete' })
		const result = runInterceptors(ctx, [escalate])
		expect(result.intent).toBe('delete')
		expect(result.featureIds).toEqual(ctx.featureIds)
	})
})
