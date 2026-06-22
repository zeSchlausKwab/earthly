import { describe, expect, it } from 'bun:test'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
// RED (Wave 0): the RPC client lands in Wave 2. Namespace import so the missing
// `runOptimize` export is a call-time failure, not a module-load crash (06-01 idiom).
import * as optimizeClient from './optimizeClient'
import { makeOversizedTrailFixture } from './fixture'

/**
 * GEO-01 no-hang RPC contract, written FIRST. In a non-worker environment (the test
 * runner has no DOM `Worker`), `runOptimize` MUST settle via the synchronous fallback —
 * it must NEVER hang. Mirrors the ingestClient sync-fallback guarantee.
 */

describe('optimizeClient — settles via sync fallback (no hang)', () => {
	it('runOptimize resolves to a result + report even with no Worker available', async () => {
		const input = makeOversizedTrailFixture()
		const settled = await Promise.race([
			optimizeClient.runOptimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES),
			new Promise((_, reject) => setTimeout(() => reject(new Error('runOptimize hung')), 15_000)),
		])
		const outcome = settled as { result: unknown; report: { bytesAfter: number } }
		expect(outcome.result).toBeDefined()
		expect(typeof outcome.report.bytesAfter).toBe('number')
	})
})
