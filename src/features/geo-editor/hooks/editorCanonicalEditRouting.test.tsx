import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { Article } from '@/lib/nostr/article'
import type { MapContext } from '@/lib/nostr/map-context'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useStoryEditor: typeof import('./useStoryEditor').useStoryEditor
let useContextEditor: typeof import('./useContextEditor').useContextEditor
let useEditorStore: typeof import('../store').useEditorStore
let resetStoryEditorOpenRequests: typeof import('../storyEditorBridge').resetStoryEditorOpenRequests
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
	;({ useStoryEditor } = await import('./useStoryEditor'))
	;({ useContextEditor } = await import('./useContextEditor'))
	;({ useEditorStore } = await import('../store'))
	;({ resetStoryEditorOpenRequests } = await import('../storyEditorBridge'))
	initialEditorState = useEditorStore.getState()
})

beforeEach(() => {
	useEditorStore.setState(initialEditorState, true)
	resetStoryEditorOpenRequests()
})

afterEach(async () => {
	await flush(() => {
		for (const root of mountedRoots.splice(0)) root.unmount()
	})
	for (const child of Array.from(document.body.children)) child.remove()
})

describe('canonical editor entry routing', () => {
	test('opens Story editing on the canonical focused edit route without clearing it first', async () => {
		const story = { id: 'story-event', dTag: 'western-front' } as unknown as Article
		const focusedCalls: unknown[][] = []
		const listCalls: string[] = []
		let clearFocusCount = 0
		const result: { current: ReturnType<typeof useStoryEditor> | null } = { current: null }

		function Probe(): ReactNode {
			result.current = useStoryEditor({
				isMobile: false,
				ensureInfoPanelVisible: () => {},
				encodeStoryNaddr: () => 'naddr1story',
				navigateTo: (...args) => focusedCalls.push(args),
				navigateToView: (view) => listCalls.push(view),
				clearFocus: () => {
					clearFocusCount += 1
				},
			})
			return null
		}

		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		await flush(() => root.render(createElement(Probe)))
		if (!result.current) throw new Error('Story editor hook did not render')

		await flush(() => result.current?.handleEditStory(story))

		expect(focusedCalls).toEqual([['story', 'naddr1story', 'stories', true]])
		expect(listCalls).toEqual([])
		expect(clearFocusCount).toBe(0)
		expect(result.current.storyEditorMode).toBe('edit')
		expect(result.current.editingStory).toBe(story)
	})

	test('opens Atlas editing on the canonical focused edit route without clearing it first', async () => {
		const context = { id: 'atlas-event', dTag: 'western-front' } as unknown as MapContext
		const focusedCalls: unknown[][] = []
		const listCalls: string[] = []
		let clearFocusCount = 0
		const result: { current: ReturnType<typeof useContextEditor> | null } = { current: null }

		function Probe(): ReactNode {
			result.current = useContextEditor({
				isMobile: false,
				ensureInfoPanelVisible: () => {},
				encodeContextNaddr: () => 'naddr1atlas',
				navigateTo: (...args) => focusedCalls.push(args),
				navigateToView: (view) => listCalls.push(view),
				clearFocus: () => {
					clearFocusCount += 1
				},
				handleInspectDataset: () => {},
				loadDatasetForEditing: () => {},
				startNewDataset: () => {},
				switchToWorkspace: () => {},
			})
			return null
		}

		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		await flush(() => root.render(createElement(Probe)))
		if (!result.current) throw new Error('Atlas editor hook did not render')

		await flush(() => result.current?.handleEditContext(context))

		expect(focusedCalls).toEqual([['mapcontext', 'naddr1atlas', 'contexts', true]])
		expect(listCalls).toEqual([])
		expect(clearFocusCount).toBe(0)
		expect(result.current.contextEditorMode).toBe('edit')
		expect(result.current.editingContext).toBe(context)
	})

	test('falls back to the matching catalog when an edit target cannot be addressed', async () => {
		const story = { id: 'story-event' } as unknown as Article
		const listCalls: string[] = []
		let latest: ReturnType<typeof useStoryEditor> | null = null

		function Probe(): ReactNode {
			latest = useStoryEditor({
				isMobile: false,
				ensureInfoPanelVisible: () => {},
				encodeStoryNaddr: () => null,
				navigateTo: () => {
					throw new Error('focused navigation must not receive an unaddressable Story')
				},
				navigateToView: (view) => listCalls.push(view),
				clearFocus: () => {},
			})
			return null
		}

		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)
		await flush(() => root.render(createElement(Probe)))

		await flush(() => latest?.handleEditStory(story))
		expect(listCalls).toEqual(['stories'])
	})
})
