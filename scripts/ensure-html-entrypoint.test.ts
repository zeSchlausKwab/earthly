import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ensureHtmlEntrypoint } from './ensure-html-entrypoint'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('HTML build entry point', () => {
	test('replaces a dependency chunk with the generated application entry point', async () => {
		await mkdir(resolve('.cache'), { recursive: true })
		const directory = await mkdtemp(join(resolve('.cache'), 'html-entry-'))
		temporaryDirectories.push(directory)
		const htmlPath = join(directory, 'index.html')
		const entryPath = join(directory, 'chunk-application.js')
		await writeFile(
			htmlPath,
			'<div id="root"></div><script type="module" crossorigin src="/chunk-polyfill.js"></script>',
		)
		await writeFile(entryPath, 'document.getElementById("root").textContent = "Earthly"')

		const result = await ensureHtmlEntrypoint([
			{ kind: 'entry-point', path: htmlPath },
			{ kind: 'chunk', path: join(directory, 'chunk-polyfill.js') },
			{ kind: 'entry-point', path: entryPath },
		])

		expect(result.corrected).toBe(true)
		expect(await Bun.file(htmlPath).text()).toContain('src="/chunk-application.js"')
	})

	test('fails closed when build metadata contains ambiguous entry points', async () => {
		expect(
			ensureHtmlEntrypoint([
				{ kind: 'entry-point', path: '/tmp/index.html' },
				{ kind: 'entry-point', path: '/tmp/one.js' },
				{ kind: 'entry-point', path: '/tmp/two.js' },
			]),
		).rejects.toThrow('Expected one HTML and one JavaScript entry point')
	})
})
