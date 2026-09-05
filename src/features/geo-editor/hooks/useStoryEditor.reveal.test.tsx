import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { Article } from '@/lib/nostr/article'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useStoryEditor: typeof import('./useStoryEditor').useStoryEditor
let useEditorStore: typeof import('../store').useEditorStore
let bridge: typeof import('../storyEditorBridge')
let initialEditorState: ReturnType<typeof import('../store').useEditorStore.getState>
const roots: Root[] = []

async function flush(action?: () => void): Promise<void> {
	await act(async () => {
		action?.()
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
		IS_REACT_ACT_ENVIRONMENT: true,
	})
	;({ act, createElement } = await import('react'))
	;({ createRoot } = await import('react-dom/client'))
	;({ useStoryEditor } = await import('./useStoryEditor'))
	;({ useEditorStore } = await import('../store'))
	bridge = await import('../storyEditorBridge')
	initialEditorState = useEditorStore.getState()
})

beforeEach(() => {
	useEditorStore.setState(initialEditorState, true)
	bridge.resetStoryEditorOpenRequests()
})

afterEach(async () => {
	await flush(() => {
		for (const root of roots.splice(0)) root.unmount()
	})
	for (const child of Array.from(document.body.children)) child.remove()
})

async function renderEditor() {
	const current: { value: ReturnType<typeof useStoryEditor> | null } = { value: null }
	const navigation: string[] = []
	function Probe(): ReactNode {
		current.value = useStoryEditor({
			isMobile: true,
			ensureInfoPanelVisible: () => {},
			encodeStoryNaddr: () => 'naddr1story',
			navigateTo: (_kind, naddr) => navigation.push(naddr),
			navigateToView: (view) => navigation.push(view),
			clearFocus: () => {},
		})
		return null
	}
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	roots.push(root)
	await flush(() => root.render(createElement(Probe)))
	const get = () => {
		if (!current.value) throw new Error('Story hook did not mount.')
		return current.value
	}
	return { get, navigation }
}

describe('explicit Story editor reveal requests', () => {
	test('background writes retain create/edit targets without revealing or navigating, including mount replay', async () => {
		bridge.requestOpenStoryEditor()
		const editor = await renderEditor()
		expect(editor.get().storyEditorMode).toBe('create')
		expect(editor.get().storyEditorRevealNonce).toBe(0)
		const story = { id: 'story-event', dTag: 'western-front' } as unknown as Article
		await flush(() => bridge.requestOpenStoryEditor(story))
		expect(editor.get().storyEditorMode).toBe('edit')
		expect(editor.get().editingStory).toBe(story)
		expect(editor.get().storyEditorRevealNonce).toBe(0)
		await flush(() => bridge.requestOpenStoryEditor())
		expect(editor.get().storyEditorMode).toBe('create')
		expect(editor.get().storyEditorRevealNonce).toBe(0)
		expect(editor.navigation).toEqual([])
	})

	test('only explicit create/edit increments, including a repeated explicit entry into the same target', async () => {
		const editor = await renderEditor()
		expect(editor.get().storyEditorRevealNonce).toBe(0)
		await flush(() => editor.get().handleCreateStory())
		expect(editor.get().storyEditorRevealNonce).toBe(1)
		await flush(() => bridge.requestOpenStoryEditor())
		expect(editor.get().storyEditorRevealNonce).toBe(1)
		const story = { id: 'story-event', dTag: 'western-front' } as unknown as Article
		await flush(() => editor.get().handleEditStory(story))
		expect(editor.get().storyEditorRevealNonce).toBe(2)
		await flush(() => editor.get().handleEditStory(story))
		expect(editor.get().storyEditorRevealNonce).toBe(3)
		await flush(() => bridge.requestOpenStoryEditor(story))
		expect(editor.get().storyEditorRevealNonce).toBe(3)
		await flush(() => editor.get().handleInspectStory(story))
		expect(editor.get().storyEditorRevealNonce).toBe(3)
		await flush(() => editor.get().handleCloseStoryEditor())
		expect(editor.get().storyEditorRevealNonce).toBe(3)
		expect(editor.get().storyEditorMode).toBe('none')
	})
})
