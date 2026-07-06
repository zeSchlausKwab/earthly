import { describe, expect, it } from 'bun:test'
import { runSandboxCode } from '@/features/chat/sandbox/transport/sandbox.worker'

describe('top-level return support (fix #2)', () => {
	it('a script ending in `return 42` succeeds and returns 42', async () => {
		const r = await runSandboxCode({ code: 'return 42', readSnapshot: null, deadlineMs: 3000 })
		expect(r.success).toBe(true)
		expect(r.returnValue).toBe(42)
	})
	it('top-level return of a computed value works', async () => {
		const r = await runSandboxCode({
			code: 'const x = 1 + 2; return { sum: x }',
			readSnapshot: null,
			deadlineMs: 3000,
		})
		expect(r.success).toBe(true)
		expect(r.returnValue).toEqual({ sum: 3 })
	})
	it('last-expression-as-value still works (no return)', async () => {
		const r = await runSandboxCode({
			code: 'const x = 5; x * 2',
			readSnapshot: null,
			deadlineMs: 3000,
		})
		expect(r.success).toBe(true)
		expect(r.returnValue).toBe(10)
	})
	it('authoring side effects + top-level return are not duplicated', async () => {
		const r = await runSandboxCode({
			code: 'authoring.addFeature(turf.point([1,1])); return "done"',
			readSnapshot: null,
			deadlineMs: 3000,
		})
		expect(r.success).toBe(true)
		expect(r.returnValue).toBe('done')
		expect(r.recordedCalls.length).toBe(1)
	})
	it('a genuine syntax error is still surfaced (not swallowed)', async () => {
		const r = await runSandboxCode({ code: 'const = =', readSnapshot: null, deadlineMs: 3000 })
		expect(r.success).toBe(false)
		expect(r.error).toMatch(/SyntaxError/)
	})
})
