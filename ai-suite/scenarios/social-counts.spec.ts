import { test, expect } from '../fixtures/earthly'
import { installInMemoryContextFixture } from '../tasks/setup/in-memory-context-fixture'
import { openEntityActions } from '../tasks/navigation/open-entity-actions'
import { openPanel } from '../tasks/navigation/open-panel'

for (const supported of [true, false]) {
	test(`visible social counts ${supported ? 'share zero results' : 'show unavailable when COUNT is unsupported'}`, async ({
		earthly,
	}) => {
		const requests: Array<Record<string, unknown>> = []
		const counts: Array<Record<string, unknown>> = []
		await earthly.page.routeWebSocket(/^ws:\/\/(localhost|127\.0\.0\.1):3334\/?$/, (socket) => {
			const server = socket.connectToServer()
			socket.onMessage((raw) => {
				const message = JSON.parse(String(raw))
				if (message[0] === 'COUNT') {
					counts.push(...message.slice(2))
					socket.send(
						JSON.stringify(
							supported
								? ['COUNT', message[1], { count: 0 }]
								: ['CLOSED', message[1], 'unsupported: COUNT'],
						),
					)
				} else {
					if (message[0] === 'REQ') requests.push(...message.slice(2))
					server.send(raw)
				}
			})
		})
		await earthly.open({ tour: 'seen' })
		const name = `Count contract ${supported}`
		await installInMemoryContextFixture(earthly, {
			name,
			description: 'Page-local count contract.',
		})
		await openPanel(earthly, 'Atlases')
		const actions = await openEntityActions(earthly, name)
		await expect.poll(() => counts.length).toBe(2)
		const unknown = actions.getByLabel('Reaction count unavailable', { exact: true })
		if (supported) await expect(unknown).toHaveCount(0)
		else await expect(unknown).toBeVisible()
		expect(counts.some((filter) => '#a' in filter && JSON.stringify(filter.kinds) === '[7]')).toBe(
			true,
		)
		expect(
			counts.some((filter) => '#A' in filter && JSON.stringify(filter.kinds) === '[37517]'),
		).toBe(true)
		expect(
			requests.some(
				(filter) => '#a' in filter && JSON.stringify(filter.kinds) === '[7]' && !filter.authors,
			),
		).toBe(false)
		await earthly.page.keyboard.press('Escape')
	})
}
