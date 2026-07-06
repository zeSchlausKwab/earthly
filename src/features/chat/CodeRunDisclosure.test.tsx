import { test, expect, describe } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	CodeRunDisclosure,
	buildRunCodeSummary,
	parseRunCodeResult,
	type RunCodeResult,
} from './CodeRunDisclosure'

const SOURCE = `for (let i = 0; i < 15; i++) {\n  authoring.add(circle(point, fib(i)))\n}\nreturn { drawn: 15 }`

const SUCCESS: RunCodeResult = {
	ok: true,
	counts: { created: 15, updated: 0, deleted: 0, skippedDuplicates: 0 },
	consoleLines: ['computing fibonacci radii', 'done: 15 circles'],
	truncated: false,
	returnValue: { drawn: 15, route: 'fib' },
}

describe('parseRunCodeResult', () => {
	test('parses a serialized successful run_code result', () => {
		const parsed = parseRunCodeResult(JSON.stringify(SUCCESS))
		expect(parsed).not.toBeNull()
		expect(parsed?.counts.created).toBe(15)
		expect(parsed?.consoleLines).toEqual(['computing fibonacci radii', 'done: 15 circles'])
	})

	test('returns null for non-run_code / unparseable content', () => {
		expect(parseRunCodeResult('not json')).toBeNull()
		expect(parseRunCodeResult(JSON.stringify({ random: true }))).toBeNull()
	})
})

describe('buildRunCodeSummary (D-09 compact summary line)', () => {
	test('reports created features when created > 0', () => {
		expect(buildRunCodeSummary(SUCCESS)).toContain('15')
		expect(buildRunCodeSummary(SUCCESS).toLowerCase()).toContain('created')
	})

	test('neutral summary when nothing was created/updated/deleted', () => {
		const neutral: RunCodeResult = {
			...SUCCESS,
			counts: { created: 0, updated: 0, deleted: 0, skippedDuplicates: 0 },
		}
		const summary = buildRunCodeSummary(neutral)
		expect(summary.toLowerCase()).toContain('ran code')
		expect(summary).not.toContain('15')
	})
})

describe('CodeRunDisclosure render (D-09/D-10/D-12)', () => {
	test('collapsed by default: summary shown, full source NOT in the DOM', () => {
		const html = renderToStaticMarkup(<CodeRunDisclosure source={SOURCE} result={SUCCESS} />)
		// summary line with count is visible
		expect(html).toContain('15')
		// the source body is hidden until expanded
		expect(html).not.toContain('authoring.add(circle')
	})

	test('expanded: shows read-only source, console stream, counts, and JSON return value', () => {
		const html = renderToStaticMarkup(
			<CodeRunDisclosure source={SOURCE} result={SUCCESS} defaultOpen />,
		)
		// (1) read-only source
		expect(html).toContain('authoring.add(circle')
		// (2) captured console lines
		expect(html).toContain('computing fibonacci radii')
		expect(html).toContain('done: 15 circles')
		// (3) authoring counts summary
		expect(html.toLowerCase()).toContain('created')
		// (4) JSON-rendered return value
		expect(html).toContain('&quot;drawn&quot;')
		expect(html).toContain('&quot;route&quot;')
	})

	test('read-only (D-12): no textarea, no contentEditable, no rerun/edit affordance', () => {
		const html = renderToStaticMarkup(
			<CodeRunDisclosure source={SOURCE} result={SUCCESS} defaultOpen />,
		)
		expect(html.toLowerCase()).not.toContain('<textarea')
		expect(html.toLowerCase()).not.toContain('contenteditable')
		expect(html.toLowerCase()).not.toContain('rerun')
		expect(html).not.toContain('>Run<')
		expect(html.toLowerCase()).not.toContain('>edit<')
	})

	test('truncated (D-10/D-14): shows the output-truncated marker', () => {
		const truncated: RunCodeResult = { ...SUCCESS, truncated: true }
		const html = renderToStaticMarkup(
			<CodeRunDisclosure source={SOURCE} result={truncated} defaultOpen />,
		)
		expect(html).toContain('output truncated')
	})
})
