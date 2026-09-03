import { describe, expect, test } from 'bun:test'
import { createMemoryHistory } from '@tanstack/history'
import { createEarthlyRouter } from './router'

const EmptyRoute = () => null

async function matchRoute(path: string) {
	const history = createMemoryHistory({ initialEntries: [path] })
	const router = createEarthlyRouter({
		history,
		appComponent: EmptyRoute,
		readComponent: EmptyRoute,
	})
	await router.load()
	return { match: router.state.matches.at(-1), location: router.state.location }
}

describe('Earthly client route contract', () => {
	test('selects the Reader boundary for a canonical Story URL', async () => {
		const { match, location } = await matchRoute('/read/naddr1story?on=ww1-battles,bcn-spots')
		expect(match?.routeId).toBe('/read/$naddr')
		expect(match?.params).toMatchObject({ naddr: 'naddr1story' })
		// URLSearchParams encodes the comma on the wire while the application-facing
		// value retains Earthly's existing comma-separated grammar.
		expect(location.searchStr).toBe('?on=ww1-battles%2Cbcn-spots')
		expect(location.search).toMatchObject({ on: 'ww1-battles,bcn-spots' })
	})

	test('preserves comment deep links on the Reader boundary', async () => {
		const { match } = await matchRoute('/read/naddr1story/comment/comment-d-tag')
		expect(match?.routeId).toBe('/read/$naddr/comment/$commentId')
		expect(match?.params).toMatchObject({
			naddr: 'naddr1story',
			commentId: 'comment-d-tag',
		})
	})

	test('owns new and legacy paths explicitly without a catch-all adapter', async () => {
		for (const [path, routeId] of [
			['/story/naddr1story', '/story/$id'],
			['/circle/local-workspace/edit', '/circle/$id/$view'],
			['/nearby/survey-123/edit', '/nearby/$id/$view'],
			['/stories/story/naddr1story', '/stories/$focusType/$naddr'],
			['/context/naddr1context/datasets', '/context/$contextNaddr/$view'],
			['/privategroup/local-workspace/edit', '/privategroup/$id/$view'],
		] as const) {
			const { match } = await matchRoute(path)
			expect(match?.routeId).toBe(routeId)
		}
	})

	test('keeps the retained account surfaces reachable after the rail cutover', async () => {
		for (const path of ['/posts', '/wallet', '/settings', '/me/circles', '/me/nearby', '/inbox']) {
			const { match } = await matchRoute(path)
			expect(match?.globalNotFound).not.toBe(true)
			expect(match?.routeId).not.toBe('__root__')
		}
	})

	test('does not route an unknown path into the application by accident', async () => {
		const { match } = await matchRoute('/definitely-not-an-earthly-route')
		expect(match?.routeId).toBe('__root__')
		expect(match?.globalNotFound).toBe(true)
	})

	test('keeps the root landing page on the complete application adapter', async () => {
		const { match } = await matchRoute('/')
		expect(match?.routeId).toBe('/')
	})
})
