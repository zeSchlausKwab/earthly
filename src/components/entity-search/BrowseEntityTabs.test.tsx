import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowseEntityTabs, getBrowseTabDefinitions } from './BrowseEntityTabs'

describe('BrowseEntityTabs', () => {
	test('is controlled by the route instead of forcing Maps active', () => {
		const html = renderToStaticMarkup(
			<BrowseEntityTabs activeKind="atlases" onKindChange={() => {}} />,
		)
		const { document } = parseHTML(html)
		const activeTab = document.querySelector('[role="tab"][aria-selected="true"]')
		expect(activeTab?.textContent).toContain('Atlases')
	})

	test('includes Maplets in canonical Browse destinations outside a lens', () => {
		expect(getBrowseTabDefinitions().map((tab) => tab.label)).toEqual([
			'Maps',
			'Stories',
			'Atlases',
			'Sightings',
			'Maplets',
			'People',
		])
	})

	test('keeps Maplets accessible in a lens', () => {
		expect(getBrowseTabDefinitions('spot').map((tab) => tab.label)).toEqual([
			'Spots',
			'Stories',
			'Maplets',
			'People',
		])
	})

	test('selects Maplets without offering a map creation action', () => {
		const { document } = parseHTML(
			renderToStaticMarkup(
				<BrowseEntityTabs activeKind="maplets" onKindChange={() => {}} onCreate={() => {}} />,
			),
		)
		expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
			'Maplets',
		)
		expect(document.querySelector('button:not([role="tab"])')).toBeNull()
	})

	test('uses canonical singular labels for the one tab-level create action', () => {
		for (const [kind, label] of [
			['maps', 'New Map'],
			['stories', 'New Story'],
			['atlases', 'New Atlas'],
			['sightings', 'New Sighting'],
		] as const) {
			const html = renderToStaticMarkup(
				<BrowseEntityTabs activeKind={kind} onKindChange={() => {}} onCreate={() => {}} />,
			)
			const { document } = parseHTML(html)
			expect(document.querySelector(`button[aria-label="${label}"]`)).not.toBeNull()
		}
	})
})
