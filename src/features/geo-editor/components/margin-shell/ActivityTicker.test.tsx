import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityTicker, type ActivityTickerItem } from './ActivityTicker'

function item(index: number, live = false): ActivityTickerItem {
	return {
		id: `activity:${index}`,
		actor: `Actor ${index}`,
		verb: 'opened',
		title: `Map ${index}`,
		ageLabel: `${index}m`,
		icon: <svg aria-hidden="true" />,
		live,
	}
}

describe('ActivityTicker', () => {
	it('prioritizes live activity, caps the feed, and exposes a persistent pause', () => {
		const markup = renderToStaticMarkup(
			<ActivityTicker
				items={[...Array.from({ length: 8 }, (_, index) => item(index)), item(8, true)]}
			/>,
		)

		expect(markup).toContain('Actor 8')
		expect(markup).toContain('aria-label="Pause activity ticker"')
		expect(markup.match(/data-active/g)).toHaveLength(1)
	})
})
