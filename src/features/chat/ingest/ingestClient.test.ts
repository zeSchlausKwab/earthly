/**
 * Worker-RPC + sync-fallback + timeout coverage for the host-side ingest client
 * (`./ingestClient.ts`, INGEST-02 / INGEST-03).
 *
 * The off-thread no-freeze contract is delivered by mirroring
 * `src/lib/geo/workerJsonParse.ts`: a lazy worker, id-keyed pending requests, a
 * `workerBroken` latch that sync-parses all pending on `onerror`, and a 30s
 * per-request timeout that falls back to a synchronous parse. This suite asserts
 * the host-visible behaviour of that machinery.
 *
 * `bun:test` cannot drive a real `new Worker(new URL(...))`, so every test here
 * runs the **sync-fallback** path that the same `parseSync` powers at runtime
 * (no-worker, broken-worker, and timeout all converge on it). We force that path
 * deterministically by removing `globalThis.Worker` for the duration of a test,
 * so the assertions exercise the exact code the production fallback runs — the
 * worker round-trip itself is covered by the build-emission gate (Plan 01) and
 * the parse-correctness suite (`parse.test.ts`).
 */

import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { parseFileInWorker, terminateIngestWorker } from './ingestClient'

const fixture = (name: string) => path.resolve(import.meta.dir, '__fixtures__', name)

/** Run `fn` with `globalThis.Worker` removed so the client takes the sync path. */
async function withoutWorker<T>(fn: () => Promise<T>): Promise<T> {
	const saved = (globalThis as { Worker?: unknown }).Worker
	;(globalThis as { Worker?: unknown }).Worker = undefined
	try {
		return await fn()
	} finally {
		if (saved !== undefined) {
			;(globalThis as { Worker?: unknown }).Worker = saved
		}
	}
}

afterEach(() => {
	terminateIngestWorker()
})

describe('ingestClient — csv via the no-freeze client (INGEST-02)', () => {
	it('resolves rows + schemaFields for the messy.csv fixture', async () => {
		const text = await Bun.file(fixture('messy.csv')).text()

		const res = await withoutWorker(() => parseFileInWorker('csv', { text }))

		expect(res.success).toBe(true)
		expect(res.schemaFields).toEqual(['name', 'lat', 'lon', 'place', 'note'])
		expect(res.rows).toHaveLength(3)
		expect(res.rows?.[0].name).toBe('Eiffel Tower')
		expect(res.rows?.[0].lat).toBe(48.8584)
	})
})

describe('ingestClient — xlsx via the no-freeze client (INGEST-03)', () => {
	it('resolves rows from the sample.xlsx fixture (ArrayBuffer payload)', async () => {
		const buffer = await Bun.file(fixture('sample.xlsx')).arrayBuffer()

		const res = await withoutWorker(() => parseFileInWorker('xlsx', { buffer }))

		expect(res.success).toBe(true)
		expect(res.schemaFields).toEqual(['name', 'lat', 'lon', 'place'])
		expect(res.rows).toHaveLength(3)
		expect(res.rows?.[0].name).toBe('Eiffel Tower')
		expect(res.rows?.[2].lat).toBe(-33.8568)
	})
})

describe('ingestClient — json / geojson / text via the client', () => {
	it('resolves a parsed object for geojson', async () => {
		const text = await Bun.file(fixture('sample.geojson')).text()

		const res = await withoutWorker(() => parseFileInWorker('geojson', { text }))

		expect(res.success).toBe(true)
		const data = res.data as { type: string; features: unknown[] }
		expect(data.type).toBe('FeatureCollection')
		expect(data.features).toHaveLength(2)
	})

	it('resolves a parsed object for json', async () => {
		const res = await withoutWorker(() => parseFileInWorker('json', { text: '{"a":1,"b":[2,3]}' }))

		expect(res.success).toBe(true)
		expect(res.data).toEqual({ a: 1, b: [2, 3] })
	})

	it('resolves line/char metadata for text', async () => {
		const text = await Bun.file(fixture('sample.txt')).text()

		const res = await withoutWorker(() => parseFileInWorker('text', { text }))

		expect(res.success).toBe(true)
		const data = res.data as { lineCount: number; charCount: number; lines: string[] }
		expect(data.lineCount).toBe(4)
		expect(data.charCount).toBe(text.length)
	})
})

describe('ingestClient — error surface (worker boundary parity)', () => {
	it('returns { success:false, error } for malformed json instead of throwing', async () => {
		const res = await withoutWorker(() => parseFileInWorker('json', { text: '{ not valid json' }))

		expect(res.success).toBe(false)
		expect(typeof res.error).toBe('string')
		expect(res.rows).toBeUndefined()
		expect(res.data).toBeUndefined()
	})
})

describe('ingestClient — no-Worker sync fallback (T-03-04)', () => {
	it('still resolves rows when Worker is unavailable (no hang)', async () => {
		const text = await Bun.file(fixture('messy.csv')).text()

		const res = await withoutWorker(() => parseFileInWorker('csv', { text }))

		expect(res.success).toBe(true)
		expect(res.rows).toHaveLength(3)
	})
})

describe('ingestClient — timeout sync fallback (T-03-03)', () => {
	it('settles via the injected timeout when the worker never responds', async () => {
		const text = await Bun.file(fixture('sample.txt')).text()

		// A 0ms timeout simulates a stuck worker: the timer fires before any
		// worker reply, and the client must still resolve via the sync parse.
		// (Runs the worker branch when Worker is defined under bun:test, but the
		// worker cannot reply here, so the timeout is the settling path.)
		const res = await parseFileInWorker('text', { text }, { timeoutMs: 0 })

		expect(res.success).toBe(true)
		const data = res.data as { lineCount: number }
		expect(data.lineCount).toBe(4)
	})
})
