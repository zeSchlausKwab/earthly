import { afterEach, describe, expect, it } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import * as optimizeClient from './optimizeClient'
import { makeOversizedTrailFixture } from './fixture'
import type { OptimizeFeatureCollection } from './types'

/**
 * GEO-01 no-hang RPC contract + the 07-05 SAFE-TIMEOUT contract.
 *
 * Test A (existing): in a non-worker environment the client settles via the synchronous
 * fallback — it must NEVER hang.
 *
 * Tests B/C (07-05): a HUNG worker on a LARGE input must TERMINATE the worker and REJECT
 * with a model-relayable error (NOT re-run optimize() synchronously on the main thread —
 * that is what crashed the UAT user's tab). A small input on the same hung worker still
 * settles via the sync fallback (trivially-small datasets never reject spuriously).
 */

/** Run `fn` with `globalThis.Worker` removed so the client takes the sync path. */
async function withoutWorker<T>(fn: () => Promise<T>): Promise<T> {
	const saved = (globalThis as { Worker?: unknown }).Worker
	;(globalThis as { Worker?: unknown }).Worker = undefined
	try {
		return await fn()
	} finally {
		if (saved !== undefined) {
			;(globalThis as { Worker?: unknown }).Worker = saved
		} else {
			delete (globalThis as { Worker?: unknown }).Worker
		}
	}
}

/**
 * A minimal stub Worker that NEVER replies (its `postMessage` is a no-op) and records
 * whether `terminate()` was called — the idiom used in `ingestClient.test.ts` /
 * `geometry-tools.test.ts` for driving the stuck-worker path under bun:test.
 */
function installNeverReplyingWorker(): { terminated: () => boolean } {
	let terminatedFlag = false
	class NeverReplyWorker {
		onmessage: ((ev: MessageEvent) => void) | null = null
		onerror: ((ev: unknown) => void) | null = null
		postMessage(): void {
			/* never replies */
		}
		terminate(): void {
			terminatedFlag = true
		}
		addEventListener(): void {}
		removeEventListener(): void {}
	}
	;(globalThis as { Worker?: unknown }).Worker = NeverReplyWorker as unknown
	return { terminated: () => terminatedFlag }
}

function uninstallWorker(saved: unknown): void {
	if (saved !== undefined) {
		;(globalThis as { Worker?: unknown }).Worker = saved
	} else {
		delete (globalThis as { Worker?: unknown }).Worker
	}
}

/** A tiny FeatureCollection comfortably under the sync-fallback size gate. */
function smallFixture(): OptimizeFeatureCollection {
	const features: EditorFeature[] = [
		{
			type: 'Feature',
			id: 'tiny',
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1],
				],
			},
			properties: { name: 'tiny' },
		} as EditorFeature,
	]
	return { type: 'FeatureCollection', features }
}

afterEach(() => {
	optimizeClient.terminateOptimizeWorker()
})

describe('optimizeClient — settles via sync fallback (no hang)', () => {
	it('runOptimize resolves to a result + report even with no Worker available (Test A)', async () => {
		const input = makeOversizedTrailFixture()
		const settled = await withoutWorker(() =>
			Promise.race([
				optimizeClient.runOptimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES),
				new Promise((_, reject) => setTimeout(() => reject(new Error('runOptimize hung')), 15_000)),
			]),
		)
		const outcome = settled as { result: unknown; report: { bytesAfter: number } }
		expect(outcome.result).toBeDefined()
		expect(typeof outcome.report.bytesAfter).toBe('number')
	})
})

describe('optimizeClient — safe timeout on a hung worker (07-05, T-07-13)', () => {
	it('LARGE input + hung worker → terminates the worker and REJECTS with a relayable error (Test B)', async () => {
		const saved = (globalThis as { Worker?: unknown }).Worker
		const stub = installNeverReplyingWorker()
		try {
			const largeInput = makeOversizedTrailFixture() // >1MB serialized → over the sync gate
			let rejected = false
			let message = ''
			try {
				await optimizeClient.runOptimize(largeInput, BLOSSOM_UPLOAD_THRESHOLD_BYTES, {
					timeoutMs: 20,
				})
			} catch (error) {
				rejected = true
				message = error instanceof Error ? error.message : String(error)
			}
			expect(rejected).toBe(true)
			expect(message).toMatch(/timed out|too large/i)
			// The still-running worker must have been terminated (not leaked).
			expect(stub.terminated()).toBe(true)
		} finally {
			uninstallWorker(saved)
			optimizeClient.terminateOptimizeWorker()
		}
	})

	it('SMALL input + hung worker → still settles via the sync fallback, never rejects (Test C)', async () => {
		const saved = (globalThis as { Worker?: unknown }).Worker
		installNeverReplyingWorker()
		try {
			const result = await optimizeClient.runOptimize(
				smallFixture(),
				BLOSSOM_UPLOAD_THRESHOLD_BYTES,
				{ timeoutMs: 20 },
			)
			expect(result.result).toBeDefined()
			expect(typeof result.report.bytesAfter).toBe('number')
		} finally {
			uninstallWorker(saved)
			optimizeClient.terminateOptimizeWorker()
		}
	})
})
