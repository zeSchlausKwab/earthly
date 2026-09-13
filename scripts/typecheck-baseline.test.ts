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
