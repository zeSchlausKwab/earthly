#!/usr/bin/env bun
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_ROOTS = ['src', 'scripts', 'ops']

/** Bun 1.3 shares module mocks and DOM globals across files. Each unit-test file
 * gets its own process; Playwright and generated/scratch files are separate suites. */
export async function discoverTests(roots: string[] = DEFAULT_ROOTS): Promise<string[]> {
	const files = new Set<string>()
	for (const root of roots) {
		const path = resolve(root)
		if ((await stat(path)).isFile()) {
			if (!/\.test\.tsx?$/.test(path)) throw new Error(`Not a unit-test file: ${root}`)
			files.add(path)
		} else {
			for await (const file of new Bun.Glob('**/*.test.{ts,tsx}').scan({ cwd: path, absolute: true })) {
				if (!/(?:^|\/)(?:node_modules|artifacts|scratch|dist|target)\//.test(file)) files.add(file)
			}
		}
	}
	return [...files].sort()
}

export async function runTestFile(path: string, timeoutMs = 60_000) {
	const child = Bun.spawn([process.execPath, 'test', path], { stdout: 'pipe', stderr: 'pipe' })
	let timedOut = false
	const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
		])
		return { ok: exitCode === 0 && !timedOut, timedOut, output: stdout + stderr }
	} finally {
		clearTimeout(deadline)
	}
}

async function main() {
	const roots = process.argv.slice(2).filter(arg => arg !== '--')
	const files = await discoverTests(roots.length ? roots : undefined)
	if (!files.length) throw new Error('No unit-test files found')
	const workers = Number(process.env.EARTHLY_TEST_WORKERS ?? 4)
	if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('EARTHLY_TEST_WORKERS must be 1–16')
	const failures: string[] = []
	let next = 0
	let passed = 0
	console.log(`Running ${files.length} unit-test files in isolated processes (${workers} workers).`)
	await Promise.all(Array.from({ length: Math.min(workers, files.length) }, async () => {
		while (next < files.length) {
			const path = files[next++]
			if (!path) continue
			const label = path.replace(`${process.cwd()}/`, '')
			try {
				const result = await runTestFile(path)
				if (result.ok) { passed++; console.log(`PASS ${label}`) }
				else { failures.push(label); console.error(`FAIL ${label}${result.timedOut ? ' (60-second file deadline)' : ''}\n${result.output}`) }
			} catch (error) { failures.push(label); console.error(`FAIL ${label}`, error) }
		}
	}))
	console.log(`\n${passed}/${files.length} files passed; ${failures.length} failed.`)
	if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
}

if (import.meta.main) main().catch(error => { console.error(error); process.exitCode = 1 })
