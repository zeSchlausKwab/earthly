import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileObjectNavigationContext } from './MobileObjectNavigation'
import { ObjectDetailsSection, ObjectInspectLayout } from './ObjectInspectLayout'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'

describe('Object inspection grammar', () => {
	test('keeps the title, author, actions, and social row ahead of tabs', () => {
		const html = renderToStaticMarkup(
			<ObjectInspectLayout
				kind="Map"
				title="Crew gate and muster points"
				state="published · 2026-09-01"
				author="Aria Voss"
				meta="4 features"
				actions={<button type="button">Edit</button>}
				social="Social controls"
				tabs="Object tabs"
				onBack={() => {}}
			>
				<ObjectDetailsSection title="At a glance" count={4}>
					Map facts
				</ObjectDetailsSection>
			</ObjectInspectLayout>,
		)
		expect(html).toContain('Back')
		expect(html).toContain('Close inspection')
		expect(html.indexOf('Crew gate and muster points')).toBeLessThan(html.indexOf('Object tabs'))
		expect(html.indexOf('Aria Voss')).toBeLessThan(html.indexOf('Object tabs'))
		expect(html.indexOf('Social controls')).toBeLessThan(html.indexOf('Object tabs'))
		expect(html.indexOf('Object tabs')).toBeLessThan(html.indexOf('Map facts'))
		expect(html).not.toContain('Version')
	})
	test('composes phone actions into one object header and keeps Thread height bounded', () => {
		const html = renderToStaticMarkup(
			<MobileObjectNavigationContext.Provider
				value={{
					activeTab: 'thread',
					onClose: () => {},
					headerActions: <button type="button">See map through panel</button>,
					threadContent: <section aria-label="Map conversation">Composer</section>,
				}}
			>
				<ObjectInspectLayout
					kind="Map"
					title="Crew gate and muster points"
					state="published · 2026-09-01"
					author="Aria Voss"
					actions={<button type="button">Propose changes</button>}
					tabs={<ObjectTabs value="thread" onValueChange={() => {}} />}
					onBack={() => {}}
				>
					<ThreadTabNotice />
				</ObjectInspectLayout>
			</MobileObjectNavigationContext.Provider>,
		)
		expect(html.match(/<header/g)).toHaveLength(1)
		expect(html.match(/aria-label="Close inspection"/g)).toHaveLength(1)
		expect(html.indexOf('See map through panel')).toBeLessThan(html.indexOf('</header>'))
		expect(html.match(/role="tablist"/g)).toHaveLength(1)
		expect(html).toContain('min-h-0 flex-1 overflow-hidden')
		expect(html).toContain('h-full min-h-0')
		expect(html).toContain('aria-label="Map conversation"')
	})
	test('gives each boxed section a semantic heading and optional count/hint', () => {
		const html = renderToStaticMarkup(
			<ObjectDetailsSection title="Belonging" hint="Edit the Map to change">
				No topics.
			</ObjectDetailsSection>,
		)
		expect(html).toContain('aria-labelledby=')
		expect(html).toContain('<h3')
		expect(html).toContain('Belonging')
		expect(html).toContain('Edit the Map to change')
	})
})
