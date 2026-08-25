import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useRouting: typeof import('./useRouting').useRouting
let useEditorStore: typeof import('../store').useEditorStore
let initialEditorState: ReturnType<typeof import('../store').useEditorStore.getState>

const mountedRoots: Root[] = []

async function flush(action?: () => void | Promise<void>): Promise<void> {
	await act(async () => {
		await action?.()
		await Promise.resolve()
	})
}

async function mountProbe(reconcileStore: boolean): Promise<void> {
	function Probe(): ReactNode {
		useRouting({ reconcileStore })
		return null
	}

	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mountedRoots.push(root)
	await flush(() => root.render(createElement(Probe)))
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const storage = new Map<string, string>()
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { pathname: '/drafts', hash: '', search: '' },
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
	;({ useEditorStore } = await import('../store'))
	initialEditorState = useEditorStore.getState()
})

beforeEach(() => {
	useEditorStore.setState(initialEditorState, true)
})

afterEach(async () => {
	await flush(() => {
		for (const root of mountedRoots.splice(0)) root.unmount()
	})
	for (const child of Array.from(document.body.children)) child.remove()
})

describe('useRouting store ownership', () => {
	test('a late observer cannot replay the current route over mobile presentation state', async () => {
		await mountProbe(true)
		useEditorStore.setState({
			mobilePanelOpen: true,
			mobilePanelTab: 'edit',
			mobileSidebarOpen: false,
			mobileEntitySurface: 'story',
			viewMode: 'view',
			stance: 'focus',
		})

		// Story activation mounts nested controls that need route helpers. Their
		// mount observes `/drafts`, but it is not a browser navigation and cannot
		// replace the Edit sheet with the Local drafts drawer.
		await mountProbe(false)

		const state = useEditorStore.getState()
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.mobilePanelTab).toBe('edit')
		expect(state.mobileSidebarOpen).toBe(false)
		expect(state.mobileEntitySurface).toBe('story')
		expect(state.viewMode).toBe('view')
		expect(state.stance).toBe('focus')
	})
})
