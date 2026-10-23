import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverTests, runTestFile } from './test-isolated'

const directories: string[] = []
async function fixture(name: string, source: string) {
	const directory = await mkdtemp(join(tmpdir(), 'earthly test isolation '))
	directories.push(directory)
	const path = join(directory, name)
	await writeFile(path, source)
	return { directory, path }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

test('discovery deduplicates overlapping roots and excludes browser/scratch artifacts', async () => {
	const { directory, path } = await fixture('one.test.ts', '')
	await mkdir(join(directory, 'scratch'))
	await writeFile(join(directory, 'scratch', 'ignored.test.ts'), '')
	await writeFile(join(directory, 'browser.spec.ts'), '')
	expect(await discoverTests([directory, path])).toEqual([path])
})

test('separate processes prevent global state leaking between test files', async () => {
	const first = await fixture('first.test.ts', 'import {test,expect} from "bun:test"; test("first",()=>{expect(globalThis.marker).toBeUndefined();globalThis.marker=1})')
	const second = await fixture('second.test.ts', 'import {test,expect} from "bun:test"; test("second",()=>expect(globalThis.marker).toBeUndefined())')
	expect((await runTestFile(first.path)).ok).toBe(true)
	expect((await runTestFile(second.path)).ok).toBe(true)
})

test('failed assertions and hung files fail the release gate', async () => {
	const failed = await fixture('failure.test.ts', 'import {test,expect} from "bun:test"; test("failure",()=>expect(1).toBe(2))')
	const hung = await fixture('hung.test.ts', 'setInterval(()=>{},1000); await new Promise(()=>{})')
	expect((await runTestFile(failed.path)).ok).toBe(false)
	const timeout = await runTestFile(hung.path, 200)
	expect(timeout.ok).toBe(false)
	expect(timeout.timedOut).toBe(true)
})
