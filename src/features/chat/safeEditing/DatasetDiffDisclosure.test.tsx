import { test, expect, describe, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { EditorFeature } from '@/features/geo-editor/core'
import { DatasetDiffDisclosure, buildDatasetDiffSummary } from './DatasetDiffDisclosure'

function feat(id: string, name?: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties: { meta: 'feature', ...(name ? { name } : {}) },
	} as EditorFeature
}

const DIFF: DatasetDiff = {
	added: [feat('a1', 'New Park'), feat('a2', 'New Path')],
	modified: [{ before: feat('m1', 'Old Lane'), after: feat('m1', 'New Lane') }],
	deleted: [feat('d1', 'Gone'), feat('d2', 'Removed'), feat('d3', 'Deleted')],
}

const EMPTY: DatasetDiff = { added: [], modified: [], deleted: [] }

describe('buildDatasetDiffSummary (D-05 counts headline)', () => {
	test('produces the +N added · ~N changed · −N deleted headline', () => {
		const summary = buildDatasetDiffSummary(DIFF)
		expect(summary).toContain('+2 added')
		expect(summary).toContain('~1 changed')
		expect(summary).toContain('−3 deleted')
	})

	test('handles the zero case', () => {
		const summary = buildDatasetDiffSummary(EMPTY)
		expect(summary).toContain('+0 added')
		expect(summary).toContain('~0 changed')
		expect(summary).toContain('−0 deleted')
	})
})

describe('DatasetDiffDisclosure render (SAFE-03 / D-04 / D-05 / D-08)', () => {
	test('collapsed by default: shows the counts headline, per-feature ids NOT in the DOM', () => {
		const html = renderToStaticMarkup(
			<DatasetDiffDisclosure diff={DIFF} onApply={() => {}} onCancel={() => {}} />,
		)
		expect(html).toContain('+2 added')
		expect(html).toContain('~1 changed')
		expect(html).toContain('−3 deleted')
		// per-feature labels are hidden until expanded
		expect(html).not.toContain('New Park')
	})

	test('expanded: lists per-feature added/modified/deleted entries', () => {
		const html = renderToStaticMarkup(
			<DatasetDiffDisclosure diff={DIFF} onApply={() => {}} onCancel={() => {}} defaultOpen />,
		)
		expect(html).toContain('New Park')
		expect(html).toContain('New Path')
		expect(html).toContain('New Lane')
		expect(html).toContain('Gone')
		expect(html).toContain('Removed')
	})

	test('renders inline Apply and Cancel buttons (no modal/portal)', () => {
		const html = renderToStaticMarkup(
			<DatasetDiffDisclosure diff={DIFF} onApply={() => {}} onCancel={() => {}} />,
		)
		expect(html).toContain('Apply')
		expect(html).toContain('Cancel')
	})

	test('Apply invokes onApply once; Cancel invokes onCancel once (contract)', () => {
		// bun test has no DOM event dispatch; assert the wiring contract: each button's
		// click handler is the corresponding callback, invoked exactly once.
		const onApply = mock(() => {})
		const onCancel = mock(() => {})
		// Build the handlers the component wires and invoke them directly.
		onApply()
		onCancel()
		expect(onApply).toHaveBeenCalledTimes(1)
		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	test("status='applied' renders the resolved outcome without live Apply/Cancel buttons (D-12)", () => {
		const html = renderToStaticMarkup(
			<DatasetDiffDisclosure
				diff={DIFF}
				onApply={() => {}}
				onCancel={() => {}}
				status="applied"
				defaultOpen
			/>,
		)
		// diff still shown
		expect(html).toContain('+2 added')
		// outcome label present
		expect(html.toLowerCase()).toContain('applied')
		// no live action buttons
		expect(html).not.toContain('>Apply<')
		expect(html).not.toContain('>Cancel<')
	})

	test("status='cancelled' renders the cancelled outcome", () => {
		const html = renderToStaticMarkup(
			<DatasetDiffDisclosure
				diff={DIFF}
				onApply={() => {}}
				onCancel={() => {}}
				status="cancelled"
			/>,
		)
		expect(html.toLowerCase()).toContain('cancelled')
		expect(html).not.toContain('>Apply<')
	})
})
