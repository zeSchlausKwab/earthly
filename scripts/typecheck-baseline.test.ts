import { describe, expect, test } from 'bun:test'
import { compareDiagnostics, parseBaseline, summarizeDiagnostics } from './typecheck-baseline'

const existing = { file: 'src/editor.ts', code: 2532, message: 'Object is possibly undefined.' }

describe('TypeScript regression baseline', () => {
	test('a lower total cannot hide a different error or an error in another file', () => {
		const baseline = summarizeDiagnostics([existing, existing, existing])
		const current = summarizeDiagnostics([
			{ ...existing, code: 2322, message: 'Type string is not assignable to number.' },
			{ ...existing, file: 'src/other.ts' },
		])
		const result = compareDiagnostics(current, baseline)
		expect(result.additions).toHaveLength(2)
		expect(result.resolved).toBe(3)
	})

	test('repeated identical errors consume separate baseline entries', () => {
		const baseline = summarizeDiagnostics([existing])
		const result = compareDiagnostics(summarizeDiagnostics([existing, existing]), baseline)
		expect(result.additions).toEqual([{ ...existing, count: 1 }])
		expect(result.resolved).toBe(0)
	})

	test('removing errors can prune debt while platform separators and message layout stay stable', () => {
		const baseline = summarizeDiagnostics([
			{ ...existing, file: 'src\\editor.ts', message: 'Object is\n  possibly undefined.' },
			existing,
		])
		expect(compareDiagnostics(summarizeDiagnostics([existing]), baseline)).toEqual({
			additions: [],
			resolved: 1,
		})
	})

	test('the checked-in missing declaration allowance survives macOS, Linux and Windows checkouts', async () => {
		const stored = await Bun.file(new URL('./typecheck-baseline.json', import.meta.url)).json()
		const baseline = parseBaseline(stored, stored.compilerVersion)
		const missingDeclaration = baseline.diagnostics.find((entry) => entry.code === 7016)
		expect(missingDeclaration).toBeDefined()
		if (!missingDeclaration) throw new Error('Expected the existing missing declaration allowance')
		expect(missingDeclaration.message).toContain("'<workspace>/node_modules/shpjs/lib/index.js'")

		for (const [root, modulePath] of [
			[
				'/Users/schlaus/workspace/earthly',
				'/Users/schlaus/workspace/earthly/node_modules/shpjs/lib/index.js',
			],
			[
				'/home/runner/work/earthly/earthly',
				'/home/runner/work/earthly/earthly/node_modules/shpjs/lib/index.js',
			],
			['C:\\work\\earthly', 'C:\\work\\earthly\\node_modules\\shpjs\\lib\\index.js'],
			['C:\\work\\earthly', 'C:/work/earthly/node_modules/shpjs/lib/index.js'],
			['/tmp/work space/earthly[1]/', '/tmp/work space/earthly[1]/node_modules/shpjs/lib/index.js'],
		] as const) {
			const diagnostic = {
				...missingDeclaration,
				message: missingDeclaration.message.replace(
					'<workspace>/node_modules/shpjs/lib/index.js',
					modulePath,
				),
			}
			const current = summarizeDiagnostics([diagnostic], root)
			expect(compareDiagnostics(current, [missingDeclaration])).toEqual({
				additions: [],
				resolved: 0,
			})
			expect(
				compareDiagnostics(summarizeDiagnostics([diagnostic, diagnostic], root), [
					missingDeclaration,
				]).additions,
			).toEqual([{ ...missingDeclaration, count: 1 }])
		}
	})

	test('workspace normalization retains different module paths and paths outside the checkout', () => {
		const message = (path: string) =>
			`Could not find a declaration file. '${path}' implicitly has an 'any' type.`
		const diagnostic = {
			file: 'src/import.ts',
			code: 7016,
			message: message('/local/earthly/node_modules/shpjs/index.js'),
		}
		const baseline = summarizeDiagnostics([diagnostic], '/local/earthly')
		const current = summarizeDiagnostics(
			[
				{ ...diagnostic, message: message('/ci/earthly/node_modules/other/index.js') },
				{ ...diagnostic, message: message('/ci/earthly-copy/node_modules/shpjs/index.js') },
				{ ...diagnostic, message: message('/external/ci/earthly/node_modules/shpjs/index.js') },
			],
			'/ci/earthly',
		)
		expect(compareDiagnostics(current, baseline)).toEqual({ additions: current, resolved: 1 })
		expect(current.map((entry) => entry.message)).toEqual([
			message('/ci/earthly-copy/node_modules/shpjs/index.js'),
			message('/external/ci/earthly/node_modules/shpjs/index.js'),
			message('<workspace>/node_modules/other/index.js'),
		])
	})

	test('rejects compiler changes and malformed or duplicate allowances', () => {
		const baseline = {
			version: 1 as const,
			compilerVersion: '5.9.3',
			diagnostics: [{ ...existing, count: 1 }],
		}
		expect(() => parseBaseline(baseline, '6.0.0')).toThrow('compiler upgrade')
		for (const count of [-1, 0, 1.5, '1']) {
			expect(() =>
				parseBaseline({ ...baseline, diagnostics: [{ ...existing, count }] }, '5.9.3'),
			).toThrow('entry')
		}
		expect(() =>
			parseBaseline(
				{ ...baseline, diagnostics: [...baseline.diagnostics, ...baseline.diagnostics] },
				'5.9.3',
			),
		).toThrow('Duplicate')
		expect(() => parseBaseline(null, '5.9.3')).toThrow('version')
		expect(parseBaseline(baseline, '5.9.3')).toEqual(baseline)
	})
})
