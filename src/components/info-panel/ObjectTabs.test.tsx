import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ObjectTabs } from './ObjectTabs'

describe('ObjectTabs', () => {
	test('exposes the three canonical object destinations', () => {
		const markup = renderToStaticMarkup(
			<ObjectTabs value="comments" commentsCount={3} onValueChange={() => {}} />,
		)
		expect(markup).toContain('Details')
		expect(markup).toContain('Comments 3')
		expect(markup).toContain('Thread')
		expect(markup).toContain('data-state="active"')
	})
})
