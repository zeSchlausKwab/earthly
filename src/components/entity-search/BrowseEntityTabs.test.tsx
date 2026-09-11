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

	test('uses the full five canonical Browse destinations outside a lens', () => {
		expect(getBrowseTabDefinitions().map((tab) => tab.label)).toEqual([
			'Maps',
			'Stories',
			'Atlases',
			'Sightings',
			'People',
		])
	})

	test('narrows a lens to its noun, Stories, and People', () => {
		expect(getBrowseTabDefinitions('spot').map((tab) => tab.label)).toEqual([
			'Spots',
			'Stories',
			'People',
		])
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
