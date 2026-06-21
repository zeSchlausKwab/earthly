import { describe, expect, it } from 'bun:test'
import type { Interceptor, InterceptorContext, MutationIntent } from './interceptor'
import { classifyIntentInterceptor, runInterceptors } from './interceptor'

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

describe('classifyIntentInterceptor (SAFE-02 intent-tag hook)', () => {
	it('returns the context intent unchanged for add/modify/delete (tagging, not mutating)', () => {
		const intents: MutationIntent[] = ['add', 'modify', 'delete']
		for (const intent of intents) {
			const ctx: InterceptorContext = { intent, featureIds: ['x'] }
			// As a tag-only hook it echoes the observed intent — it never escalates.
			expect(classifyIntentInterceptor(ctx)).toEqual({ intent })
		}
	})

	it('stays synchronous (returns an object, not a Promise) and is chainable as a no-op', () => {
		const ctx: InterceptorContext = { intent: 'modify', featureIds: ['a', 'b'] }
		const out = classifyIntentInterceptor(ctx)
		expect(out).not.toBeInstanceOf(Promise)
		// Run through the fold: a tag-only interceptor must not change the result.
		expect(runInterceptors(ctx, [classifyIntentInterceptor])).toEqual(ctx)
	})
})
