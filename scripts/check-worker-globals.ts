/**
 * Guard: browser-worker bundles must be free of Node-only globals.
 *
 * Bun tests run under the Bun runtime where `Buffer`/`process` exist, so a
 * stray `Buffer.byteLength` in worker-bundled code passes every unit test and
 * then throws `ReferenceError: Buffer is not defined` on the first real
 * in-browser run (it broke every run_code authoring call and every console
 * byte-cap check — 2026-07-08).
 *
 * Builds the REAL worker bundles (same `buildWorkerSource` as the dev route
 * and prod build) and scans the emitted JS for free `Buffer` / `process`
 * references — the whole transitive import graph, not just the sources.
 * `process.env.*` never survives (the bundler's define map replaces it), so
 * any surviving reference is live and fatal.
 *
 * Run: `bun scripts/check-worker-globals.ts` — exits 1 with findings on
 * stdout. Invoked as a SUBPROCESS by `noNodeGlobals.test.ts` (in-process
 * Bun.build corrupts the test runner's path-alias resolution).
 */

import { buildWorkerSource } from '../src/lib/workers/buildWorker'
import { WORKER_ASSETS } from '../src/lib/workers/workerAssets'

/** Whether position `index` on `line` sits inside a '…' or "…" string literal. */
function insideStringLiteral(line: string, index: number): boolean {
	let inSingle = false
	let inDouble = false
	for (let i = 0; i < index; i++) {
		const char = line[i]
		if (char === '\\') {
			i++ // skip the escaped character
			continue
		}
		if (char === "'" && !inDouble) inSingle = !inSingle
		else if (char === '"' && !inSingle) inDouble = !inDouble
	}
	return inSingle || inDouble
}

/** Free (non-property, non-declared, non-string) uses of a Node global. */
function findNodeGlobalUses(bundle: string): string[] {
	const findings: string[] = []
	// `Buffer.` / `process.` not preceded by an identifier char or `.` — skips
	// jsts/turf class names like `BufferOp` and property accesses like
	// `foo.Buffer`, catches the bare global reference that throws in browsers.
	const pattern = /(^|[^.\w$])(Buffer|process)\s*\./g
	for (const line of bundle.split('\n')) {
		// Declared shims (`var Buffer = …`) mean the reference is safe.
		if (/(?:var|let|const|function)\s+(?:Buffer|process)\b/.test(line)) continue
		pattern.lastIndex = 0
		let match = pattern.exec(line)
		while (match) {
			const globalIndex = match.index + (match[1]?.length ?? 0)
			// A polyfill's own error MESSAGES ("Buffer.write(...) is not
			// supported") are quoted strings, not live references — skip those.
			if (!insideStringLiteral(line, globalIndex)) {
				findings.push(line.slice(Math.max(0, match.index - 30), match.index + 40).trim())
			}
			match = pattern.exec(line)
		}
	}
	return findings
}

let failed = false
for (const [name, asset] of Object.entries(WORKER_ASSETS)) {
	const bundle = await buildWorkerSource(asset.sourcePath, false)
	const findings = findNodeGlobalUses(bundle)
	if (findings.length > 0) {
		failed = true
		console.log(`✖ ${name} (${asset.sourcePath}): ${findings.length} Node-global reference(s)`)
		for (const finding of findings.slice(0, 10)) {
			console.log(`    …${finding}…`)
		}
	} else {
		console.log(`✓ ${name}`)
	}
}

process.exit(failed ? 1 : 0)
