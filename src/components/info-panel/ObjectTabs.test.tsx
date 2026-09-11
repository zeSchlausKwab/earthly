import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileObjectNavigationContext } from './MobileObjectNavigation'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'

describe('ObjectTabs', () => {
	test('exposes the three canonical object destinations', () => {
		const markup = renderToStaticMarkup(
			<ObjectTabs value="comments" commentsCount={3} onValueChange={() => {}} />,
		)
		expect(markup).toContain('Details')
		expect(markup).toContain('Comments 3')
		expect(markup).toContain('Thread')
		expect(markup).toContain('aria-label="Object sections"')
		expect(markup).toContain('data-state="active"')
	})

	test('reuses the real mobile Thread content below the object tabs', () => {
		const markup = renderToStaticMarkup(
			<MobileObjectNavigationContext.Provider
				value={{
					activeTab: 'thread',
					onClose: () => {},
					threadWorking: true,
					threadContent: <section aria-label="Map conversation">Draft-safe composer</section>,
				}}
			>
				<ObjectTabs value="thread" onValueChange={() => {}} />
				<ThreadTabNotice />
			</MobileObjectNavigationContext.Provider>,
		)
		expect(markup).toContain('aria-label="Map conversation"')
		expect(markup).toContain('Draft-safe composer')
		expect(markup).toContain('aria-label="Working"')
		expect(markup).not.toContain('The Thread is open beside this Margin')
		expect(markup.match(/role="tablist"/g)).toHaveLength(1)
	})

	test('preserves the desktop Thread hand-off when no mobile slot is mounted', () => {
		expect(renderToStaticMarkup(<ThreadTabNotice />)).toContain(
			'The Thread is open beside this Margin',
		)
	})
})
