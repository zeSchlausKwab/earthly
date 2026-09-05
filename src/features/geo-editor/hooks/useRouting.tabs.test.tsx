import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { parseEarthlyRoute, type EarthlyRouteState } from '@/router/routeContract'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useRouting: typeof import('./useRouting').useRouting
let EarthlyRouteStateProvider: typeof import('@/router/routeState').EarthlyRouteStateProvider
let installEarthlyNavigator: typeof import('@/router/navigation').installEarthlyNavigator
let routing: ReturnType<typeof import('./useRouting').useRouting> | undefined
let navigatedHref: string | undefined
let uninstallNavigator: (() => void) | undefined

const mountedRoots: Root[] = []
const ORIGIN = 'http://localhost:3000'
const CURRENT_NADDR = 'naddr1current'
const LENS_NADDR = 'naddr1atlas'

async function flush(action?: () => void | Promise<void>): Promise<void> {
	await act(async () => {
		await action?.()
		await Promise.resolve()
	})
}

async function mountRoutingProbe(
	state: EarthlyRouteState = {
		kind: 'story',
		id: CURRENT_NADDR,
		edit: false,
		tab: 'comments',
		on: ['map-one', 'map-two'],
		live: true,
		in: LENS_NADDR,
	},
): Promise<void> {
	function Probe(): ReactNode {
		routing = useRouting()
		return null
	}

	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mountedRoots.push(root)
	await flush(() =>
		root.render(
			createElement(EarthlyRouteStateProvider, {
				state,
				children: createElement(Probe),
			}),
		),
	)
}

function parsedNavigation() {
	if (!navigatedHref) throw new Error('Expected the routing hook to navigate.')
	const destination = new URL(navigatedHref, ORIGIN)
	return {
		destination,
		route: parseEarthlyRoute(
			destination.pathname,
			Object.fromEntries(destination.searchParams.entries()),
		),
	}
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const storage = new Map<string, string>()
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			origin: ORIGIN,
			pathname: `/story/${CURRENT_NADDR}`,
			hash: '',
			search: `?on=map-one,map-two&live=1&in=${LENS_NADDR}&tab=comments`,
		},
	})
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
			clear: () => storage.clear(),
		},
	})
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		MutationObserver: window.MutationObserver,
		Event: window.Event,
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true

	const react = await import('react')
	act = react.act
	createElement = react.createElement
	;({ createRoot } = await import('react-dom/client'))
	;({ useRouting } = await import('./useRouting'))
	;({ EarthlyRouteStateProvider } = await import('@/router/routeState'))
	;({ installEarthlyNavigator } = await import('@/router/navigation'))
})

beforeEach(() => {
	routing = undefined
	navigatedHref = undefined
	uninstallNavigator = installEarthlyNavigator((href) => {
		navigatedHref = href
	})
})

afterEach(async () => {
	uninstallNavigator?.()
	uninstallNavigator = undefined
	await flush(() => {
		for (const root of mountedRoots.splice(0)) root.unmount()
	})
	for (const child of Array.from(document.body.children)) child.remove()
})

describe('useRouting object tabs', () => {
	test('composition changes preserve the active sheet while object tab navigation reconciles it', async () => {
		const { useEditorStore } = await import('../store')
		const initialState = useEditorStore.getState()
		function Probe(): ReactNode {
			useRouting({ reconcileStore: true })
			return null
		}
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		const renderRoute = (state: EarthlyRouteState) =>
			flush(() =>
				root.render(
					createElement(EarthlyRouteStateProvider, { state, children: createElement(Probe) }),
				),
			)
		const objectRoute: EarthlyRouteState = {
			kind: 'map',
			id: CURRENT_NADDR,
			edit: false,
			tab: 'details',
			on: [],
			live: false,
		}
		try {
			await renderRoute(objectRoute)
			expect(useEditorStore.getState().mobilePanelTab).toBe('edit')
			useEditorStore.getState().setMobilePanelSnap('full')
			await renderRoute({ ...objectRoute, on: ['loaded-map'], live: true })
			expect(useEditorStore.getState().mobilePanelSnap).toBe('full')
			await renderRoute({ ...objectRoute, tab: 'thread', on: ['loaded-map'], live: true })
			expect(useEditorStore.getState().mobilePanelTab).toBe('chat')
			await renderRoute({ ...objectRoute, on: ['loaded-map'], live: true })
			expect(useEditorStore.getState().mobilePanelTab).toBe('edit')
			expect(useEditorStore.getState().mobilePanelSnap).toBe('half')
		} finally {
			await flush(() => useEditorStore.setState(initialState))
		}
	})

	test('Back from a Circle surface returns to that Circle without an edit suffix', async () => {
		await mountRoutingProbe({
			kind: 'circle',
			id: 'alpine-rescue',
			edit: true,
			tab: 'thread',
			on: ['map-one', 'map-two'],
			live: true,
		})
		routing?.clearFocus()
		const { destination, route } = parsedNavigation()
		expect(destination.pathname).toBe('/circle/alpine-rescue')
		expect(route).toMatchObject({
			kind: 'circle',
			id: 'alpine-rescue',
			edit: false,
			tab: 'details',
			on: ['map-one', 'map-two'],
			live: true,
		})
	})

	test('Back from a Nearby surface returns to that session instead of public Browse', async () => {
		await mountRoutingProbe({
			kind: 'nearby',
			id: 'saturday-survey',
			edit: true,
			tab: 'comments',
			on: ['map-one', 'map-two'],
			live: true,
		})
		routing?.clearFocus()
		const { destination, route } = parsedNavigation()
		expect(destination.pathname).toBe('/nearby/saturday-survey')
		expect(route).toMatchObject({
			kind: 'nearby',
			id: 'saturday-survey',
			edit: false,
			tab: 'details',
			on: ['map-one', 'map-two'],
			live: true,
		})
	})

	test('Back from an unscoped object still opens its catalog and preserves the lens', async () => {
		await mountRoutingProbe()
		routing?.clearFocus()
		const { destination, route } = parsedNavigation()
		expect(destination.pathname).toBe('/browse/stories')
		expect(route).toMatchObject({
			kind: 'browse',
			browseKind: 'stories',
			in: LENS_NADDR,
			on: ['map-one', 'map-two'],
			live: true,
		})
	})
	test('navigateToTab changes only the object panel and preserves route-local composition', async () => {
		await mountRoutingProbe()
		routing?.navigateToTab('thread')

		const { destination, route } = parsedNavigation()
		expect(destination.pathname).toBe(`/story/${CURRENT_NADDR}`)
		expect(route).toMatchObject({
			kind: 'story',
			id: CURRENT_NADDR,
			tab: 'thread',
			on: ['map-one', 'map-two'],
			live: true,
			in: LENS_NADDR,
		})
	})

	test('new object navigation resets to Details instead of inheriting the old tab', async () => {
		await mountRoutingProbe()
		routing?.navigateTo('geoevent', 'naddr1next', 'datasets')

		const { route } = parsedNavigation()
		expect(route).toMatchObject({
			kind: 'map',
			id: 'naddr1next',
			tab: 'details',
			on: ['map-one', 'map-two'],
			live: true,
			in: LENS_NADDR,
		})
	})

	test('comment navigation uses the canonical deep link and selects Comments', async () => {
		await mountRoutingProbe()
		routing?.navigateToComment('story', CURRENT_NADDR, 'comment-id', 'stories')

		const { destination, route } = parsedNavigation()
		expect(destination.pathname).toBe(`/story/${CURRENT_NADDR}/comment/comment-id`)
		expect(route).toMatchObject({ commentId: 'comment-id', tab: 'comments' })
	})
})
