import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

/**
 * Regression guard for the "Buffer is not defined" class of bug: code that
 * bundles into a BROWSER worker must not touch Node-only globals (they exist
 * under bun test, so unit tests can't catch it — the failure only shows on a
 * real in-browser run; it broke every run_code authoring call, 2026-07-08).
 *
 * The scan lives in `scripts/check-worker-globals.ts` and is run here as a
 * SUBPROCESS: calling Bun.build in-process corrupts the test runner's `@/`
 * path-alias resolution for test files loaded afterwards.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')

describe('browser worker bundles are free of Node-only globals', () => {
	it('scripts/check-worker-globals.ts reports no findings', async () => {
		const proc = Bun.spawn(['bun', 'scripts/check-worker-globals.ts'], {
			cwd: REPO_ROOT,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		])
		if (exitCode !== 0) {
			console.error(stdout)
			console.error(stderr)
		}
		expect(exitCode).toBe(0)
	}, 60_000)
})
