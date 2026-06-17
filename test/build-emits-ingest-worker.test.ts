/**
 * Pitfall-3 build-emission gate (RESEARCH 03 Pitfall 2 + 3).
 *
 * The single highest-risk unknown for the ingest phase is whether ExcelJS
 * bundles cleanly into a browser Web Worker under Bun — ExcelJS pulls Node-only
 * `fs`/`stream` paths via its `main` entry, and only its `browser` entry
 * (`dist/exceljs.min.js`) is worker-safe. `build.ts` enumerates `**.html`
 * entrypoints and emits worker chunks as deps of `new Worker(new URL(...))`, so
 * a NEW worker must bundle under the same `target: 'browser'` config.
 *
 * This test compiles `ingest.worker.ts` as a standalone browser entrypoint with
 * the SAME `Bun.build` config the production build uses, then asserts:
 *   1. the build succeeds (no Node-shim/`fs`/`stream` resolution failure), and
 *   2. the emitted bundle actually contains the ExcelJS + PapaParse parse code.
 *
 * If this build fails on ExcelJS, the spike has failed and Task 3's
 * `read-excel-file` fallback gate must be taken.
 */

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

const WORKER_ENTRY = path.resolve(
	import.meta.dir,
	'../src/features/chat/ingest/ingest.worker.ts',
)

describe('ingest worker build emission (Pitfall 3 gate)', () => {
	it('bundles ingest.worker.ts cleanly for the browser target with ExcelJS + PapaParse', async () => {
		const result = await Bun.build({
			entrypoints: [WORKER_ENTRY],
			target: 'browser',
			splitting: true,
			sourcemap: 'none',
			// No outdir: build in-memory and inspect artifacts directly.
		})

		// SPIKE GATE: a failure here means ExcelJS (or PapaParse) did not bundle
		// for the browser worker target under Bun.
		if (!result.success) {
			const messages = result.logs.map((l) => String(l)).join('\n')
			throw new Error(`ingest worker build failed (spike NOT green):\n${messages}`)
		}

		expect(result.success).toBe(true)
		expect(result.outputs.length).toBeGreaterThan(0)

		// Concatenate all emitted JS so we can assert the parse libraries are in.
		let combined = ''
		for (const output of result.outputs) {
			if (output.kind === 'entry-point' || output.kind === 'chunk') {
				combined += await output.text()
			}
		}

		// PapaParse leaves recognizable markers even minified.
		expect(combined).toContain('papaparse')
		// ExcelJS browser bundle self-identifies; the worker calls xlsx.load.
		expect(combined.toLowerCase()).toContain('exceljs')
		// The worker's own message contract survives bundling.
		expect(combined).toContain('Unknown ingest kind')
	})
})
