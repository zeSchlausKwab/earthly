import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useSightingEditor: typeof import('./useSightingEditor').useSightingEditor
let useEditorStore: typeof import('../store').useEditorStore
let initialEditorState: ReturnType<typeof import('../store').useEditorStore.getState>

const mountedRoots: Root[] = []

async function flush(action?: () => void | Promise<void>): Promise<void> {
	await act(async () => {
		await action?.()
		await Promise.resolve()
	})
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const storage = new Map<string, string>()
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
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true

	const react = await import('react')
	act = react.act
	createElement = react.createElement
	;({ createRoot } = await import('react-dom/client'))
	;({ useSightingEditor } = await import('./useSightingEditor'))
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

describe('useSightingEditor inspect routing', () => {
	test('writes the canonical focused Sighting route instead of a list-only route', async () => {
		const focusedCalls: unknown[][] = []
		const listCalls: string[] = []
		let latest: ReturnType<typeof useSightingEditor> | null = null
		const sighting = { id: 'event-1', dTag: 'sighting-1' } as TemporalSighting

		function Probe(): ReactNode {
			latest = useSightingEditor({
				isMobile: false,
				ensureInfoPanelVisible: () => {},
				navigateToView: (view) => listCalls.push(view),
				navigateTo: (...args) => focusedCalls.push(args),
				encodeSightingNaddr: () => 'naddr1sighting',
				clearFocus: () => {},
				armPlacement: () => {},
				disarmPlacement: () => {},
			})
			return null
		}

		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		await flush(() => root.render(createElement(Probe)))
		if (!latest) throw new Error('Sighting editor hook did not render')

		await flush(() => latest?.handleInspectSighting(sighting))

		expect(focusedCalls).toEqual([['sighting', 'naddr1sighting', 'sightings']])
		expect(listCalls).toEqual([])
		expect(useEditorStore.getState().inspectionSubject).toEqual({
			kind: 'sighting',
			entity: sighting,
		})
	})

	test('falls back to the Sightings list when the entity cannot be addressed', async () => {
		const focusedCalls: unknown[][] = []
		const listCalls: string[] = []
		let latest: ReturnType<typeof useSightingEditor> | null = null

		function Probe(): ReactNode {
			latest = useSightingEditor({
				isMobile: false,
				ensureInfoPanelVisible: () => {},
				navigateToView: (view) => listCalls.push(view),
				navigateTo: (...args) => focusedCalls.push(args),
				encodeSightingNaddr: () => null,
				clearFocus: () => {},
				armPlacement: () => {},
				disarmPlacement: () => {},
			})
			return null
		}

		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		await flush(() => root.render(createElement(Probe)))
		if (!latest) throw new Error('Sighting editor hook did not render')

		await flush(() => latest?.handleInspectSighting({ id: 'unaddressed' } as TemporalSighting))

		expect(focusedCalls).toEqual([])
		expect(listCalls).toEqual(['sightings'])
	})
})
