/**
 * Wave-0 spike proofs for the isolation boundary (CODE-01 / CODE-02 / CODE-04).
 *
 * These exercise the TRANSPORT-AGNOSTIC `runSandbox()` surface — the same one
 * Waves 2–3 consume. Three of the four roadmap spike criteria are exercisable in
 * `bun test`: (a) confinement, (CODE-02) surface enumeration, (b) timeout-kill;
 * plus the output cap (CODE-04) and a static import-boundary scan (CODE-01).
 * Criterion (c) — prod `.wasm` serving — is the human-verify checkpoint (Task 5).
 *
 * Worker-environment adaptation (RESEARCH / plan note): `bun test` has no browser
 * `Worker`, so `runSandbox` transparently drives the worker module's PURE engine
 * (`runSandboxCode`) via the `typeof Worker === 'undefined'` fallback in
 * quickjsWorker.ts. The engine is identical to what the real Worker runs (the VM
 * is pure given `{code, deadlineMs}`), so the confinement/surface/timeout proofs
 * stay automated and faithful.
 */

import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OUTPUT_LINE_CAP, TRUNCATION_MARKER } from './outputCapture'
import {
	directEngineTransport,
	runSandbox as runSandboxRaw,
	type SandboxRunOptions,
} from './sandboxHost'

/**
 * Drive the transport-agnostic `runSandbox()` surface with the PURE-engine
 * transport injected. Bun's test runner can spawn Workers, but
 * QuickJS-WASM-inside-a-spawned-Worker segfaults under `bun test` specifically
 * — so the proofs run the IDENTICAL pure engine in-process (the VM is pure given
 * `{code, deadlineMs}`; production uses the real fresh-spawn Worker). This keeps
 * the spike's confinement/surface/timeout criteria deterministically automated.
 */
function runSandbox(code: string, options: SandboxRunOptions = {}) {
	return runSandboxRaw(code, { ...options, transport: directEngineTransport })
}

const FORBIDDEN_GLOBALS = [
	'fetch',
	'localStorage',
	'document',
	'window',
	'XMLHttpRequest',
	'globalThis.signer',
	'globalThis.wallet',
]

describe('confinement (CODE-01 a) — forbidden host globals are unreachable', () => {
	it.each(FORBIDDEN_GLOBALS)('typeof %s is undefined inside the boundary', async (expr) => {
		const result = await runSandbox(`typeof ${expr}`)
		expect(result.ok).toBe(true)
		expect(result.returnValue).toBe('undefined')
	})

	it('reading a forbidden global throws ReferenceError (no value leaks)', async () => {
		// Bare reference (not typeof) of an undeclared global throws inside the VM.
		const result = await runSandbox('fetch')
		expect(result.ok).toBe(false)
		expect(result.error).toMatch(/fetch is not defined|ReferenceError/i)
	})
})

describe('surface (CODE-02) — only the four injected globals are present', () => {
	it('exposes exactly authoring/turf/data/console among the host names', async () => {
		const result = await runSandbox(`
			const injected = ['authoring','turf','data','console']
			const forbidden = ['fetch','localStorage','document','window','XMLHttpRequest','signer','wallet']
			const present = Object.keys(globalThis)
			JSON.stringify({
				injectedPresent: injected.filter(k => present.includes(k)).sort(),
				forbiddenPresent: forbidden.filter(k => present.includes(k)),
			})
		`)
		expect(result.ok).toBe(true)
		const parsed = JSON.parse(result.returnValue as string)
		expect(parsed.injectedPresent).toEqual(['authoring', 'console', 'data', 'turf'])
		expect(parsed.forbiddenPresent).toEqual([])
	})

	it('JS built-ins (Math, JSON, Array) remain available', async () => {
		const result = await runSandbox('[typeof Math, typeof JSON, typeof Array].join(",")')
		expect(result.ok).toBe(true)
		expect(result.returnValue).toBe('object,object,function')
	})

	it('CR-01: authoring exposes ONLY the four interceptor-routed write ops (no editorCommand)', async () => {
		const result = await runSandbox(`Object.keys(authoring).sort().join(',')`)
		expect(result.ok).toBe(true)
		// editorCommand bypasses runInterceptors() so it must NOT be sandbox-reachable.
		expect(result.returnValue).toBe('addFeature,buffer,circle,writeGeoJSON')
	})

	it('CR-01: authoring.editorCommand is undefined inside the boundary', async () => {
		const result = await runSandbox(`typeof authoring.editorCommand`)
		expect(result.ok).toBe(true)
		expect(result.returnValue).toBe('undefined')
	})
})

describe('timeout (CODE-04 b) — wall-clock kill, no host hang', () => {
	it('terminates while(true){} within a bounded wall clock and flags timedOut', async () => {
		const start = Date.now()
		const result = await runSandbox('while(true){}', { deadlineMs: 200 })
		const elapsed = Date.now() - start
		expect(result.ok).toBe(false)
		expect(result.timedOut).toBe(true)
		// Settles well under a few seconds — the test process itself does not hang.
		expect(elapsed).toBeLessThan(3000)
	})
})

describe('output cap (CODE-04) — console flooding is bounded', () => {
	it('truncates console output far past OUTPUT_LINE_CAP with a marker', async () => {
		const result = await runSandbox(
			`for (let i = 0; i < ${OUTPUT_LINE_CAP + 500}; i++) console.log('flood ' + i)`,
		)
		expect(result.ok).toBe(true)
		expect(result.truncated).toBe(true)
		expect(result.consoleLines.length).toBeLessThanOrEqual(OUTPUT_LINE_CAP + 1)
		expect(result.consoleLines[result.consoleLines.length - 1]).toBe(TRUNCATION_MARKER)
	})
})

describe('recording + return value (D-10) — buffer-then-apply', () => {
	it('records ordered authoring.* calls and returns the expression value', async () => {
		const result = await runSandbox(`
			authoring.circle([14.5, 47.5], 100)
			authoring.addFeature({ type: 'Feature', geometry: null, properties: {} })
			'done'
		`)
		expect(result.ok).toBe(true)
		expect(result.returnValue).toBe('done')
		expect(result.recordedCalls.map((c) => c.op)).toEqual(['circle', 'addFeature'])
		expect(result.recordedCalls[0].args[0]).toEqual([14.5, 47.5])
	})
})

describe('import boundary (CODE-01 static) — no signer/wallet/Nostr/createAuthoring reach', () => {
	// TUNED per PATTERNS.md, then refined for Wave 2 (run_code).
	//
	// TWO tiers of prohibition:
	//
	// (A) SECRET reach — forbidden in EVERY sandbox source file, with no exception
	//     (T-04-12): no signer / wallet / Nostr / NDK / applesauce / MCP import may
	//     appear anywhere under sandbox/, including the new host modules.
	//
	// (B) CONFINEMENT-BOUNDARY reach — `createAuthoring` and `geo-editor/store` are
	//     forbidden ONLY in the worker/transport + pure-engine files, which must
	//     stay statically provable as a closed boundary (T-04-09: the worker RECORDS
	//     calls, never applies them). `runCode.ts` is the HOST-SIDE replay seam — it
	//     legitimately imports `createAuthoring` + the editor store on the MAIN
	//     thread (that is the entire point of Wave 2, D-03/D-08), so it is exempt
	//     from tier (B) but NOT from tier (A). `readSnapshot.ts` reads the editor
	//     store via a TYPE-only import, also exempt from tier (B).
	const SECRET_IMPORT_PATTERNS: RegExp[] = [
		/@\/lib\/ndk/,
		/@\/lib\/nostr/,
		/['"]nostr/,
		/applesauce/,
		/@modelcontextprotocol/,
		/@contextvm/,
		/from\s+['"][^'"]*signer/,
		/from\s+['"][^'"]*wallet/,
	]
	const CONFINEMENT_BOUNDARY_PATTERNS: RegExp[] = [
		/from\s+['"][^'"]*createAuthoring/,
		/\bcreateAuthoring\b.*from/,
		/geo-editor\/store/,
	]

	/** Host-side modules exempt from tier (B) — they run on the main thread. */
	const HOST_REPLAY_FILES = new Set(['runCode.ts', 'readSnapshot.ts'])

	const SANDBOX_DIR = dirname(fileURLToPath(import.meta.url))

	function sandboxSourceFiles(): string[] {
		const out: string[] = []
		const walk = (dir: string) => {
			for (const name of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, name.name)
				if (name.isDirectory()) walk(full)
				else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full)
			}
		}
		walk(SANDBOX_DIR)
		return out
	}

	it('scans the worker + transport + host modules', () => {
		const names = sandboxSourceFiles().map((p) => p.split('/').pop())
		expect(names).toEqual(
			expect.arrayContaining([
				'sandbox.worker.ts',
				'quickjsWorker.ts',
				'sandboxHost.ts',
				'curatedTurf.ts',
				'outputCapture.ts',
				'runCode.ts',
				'readSnapshot.ts',
			]),
		)
	})

	it.each(sandboxSourceFiles())('%s imports no host secret (tier A)', (file) => {
		const source = readFileSync(file, 'utf8')
		const importLines = source
			.split('\n')
			.filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line))
		for (const line of importLines) {
			for (const pattern of SECRET_IMPORT_PATTERNS) {
				expect(line).not.toMatch(pattern)
			}
		}
	})

	it.each(
		sandboxSourceFiles(),
	)('%s keeps the confinement boundary closed (tier B, worker/transport only)', (file) => {
		const base = file.split('/').pop() ?? ''
		if (HOST_REPLAY_FILES.has(base)) return // host-side replay seam is exempt
		const source = readFileSync(file, 'utf8')
		const importLines = source
			.split('\n')
			.filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line))
		for (const line of importLines) {
			for (const pattern of CONFINEMENT_BOUNDARY_PATTERNS) {
				expect(line).not.toMatch(pattern)
			}
		}
	})
})
