import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let StrictMode: typeof import('react').StrictMode
let useState: typeof import('react').useState
let createRoot: typeof import('react-dom/client').createRoot
let useRetainedEditorDraft: typeof import('./useRetainedEditorDraft').useRetainedEditorDraft

const storedDrafts = new Map<string, { value: string }>()
const mountedRoots: Root[] = []

interface ProbeApi {
	change(value: string): void
	discard(): void
	published(): void
}

let probeApi: ProbeApi | null = null

function persist(identity: string, snapshot: { value: string }): void {
	storedDrafts.set(identity, { ...snapshot })
}

function clear(identity: string): void {
	storedDrafts.delete(identity)
}

function Probe({ identity, fallback }: { identity: string; fallback: string }): ReactNode {
	const [value, setValue] = useState(() => storedDrafts.get(identity)?.value ?? fallback)
	const controls = useRetainedEditorDraft({
		identity,
		snapshot: { value },
		persist,
		clear,
	})
	probeApi = {
		change(next) {
			controls.setDirty(true)
			setValue(next)
		},
		discard: controls.clearRetainedDraft,
		published: controls.clearRetainedDraft,
	}
	return createElement('span', null, value)
}

async function flush(action?: () => void | Promise<void>): Promise<void> {
	await act(async () => {
		await action?.()
		await Promise.resolve()
	})
}

function getApi(): ProbeApi {
	if (!probeApi) throw new Error('Probe did not render')
	return probeApi
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const browserStorage = new Map<string, string>()
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => browserStorage.get(key) ?? null,
			setItem: (key: string, value: string) => browserStorage.set(key, value),
			removeItem: (key: string) => browserStorage.delete(key),
			clear: () => browserStorage.clear(),
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
	StrictMode = react.StrictMode
	useState = react.useState
	;({ createRoot } = await import('react-dom/client'))
	;({ useRetainedEditorDraft } = await import('./useRetainedEditorDraft'))
})

beforeEach(() => {
	storedDrafts.clear()
	probeApi = null
})

afterEach(async () => {
	await flush(() => {
		for (const root of mountedRoots.splice(0)) root.unmount()
	})
	for (const child of Array.from(document.body.children)) child.remove()
})

describe('useRetainedEditorDraft', () => {
	test('retains a dirty form through surface unmount and restores it on remount', async () => {
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)

		await flush(() =>
			root.render(
				createElement(
					StrictMode,
					null,
					createElement(Probe, { identity: 'story:new', fallback: 'published baseline' }),
				),
			),
		)
		await flush(() => getApi().change('unsaved narrative'))
		await flush(() => root.render(createElement('span', null, 'Inspector')))

		expect(storedDrafts.get('story:new')?.value).toBe('unsaved narrative')

		await flush(() =>
			root.render(createElement(Probe, { identity: 'story:new', fallback: 'published baseline' })),
		)
		expect(container.textContent).toBe('unsaved narrative')
	})

	test('discard clears storage and suppresses the pending unmount write', async () => {
		storedDrafts.set('context:new', { value: 'older local draft' })
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)

		await flush(() =>
			root.render(createElement(Probe, { identity: 'context:new', fallback: 'empty context' })),
		)
		await flush(() => getApi().change('edited context'))
		await flush(() => getApi().discard())
		await flush(() => root.render(createElement('span', null, 'Datasets')))

		expect(storedDrafts.has('context:new')).toBe(false)
	})

	test('successful publish cleanup cannot resurrect a dirty draft during navigation', async () => {
		const container = document.createElement('div')
		document.body.append(container)
		const root = createRoot(container)
		mountedRoots.push(root)

		await flush(() =>
			root.render(createElement(Probe, { identity: 'story:existing', fallback: 'published' })),
		)
		await flush(() => getApi().change('ready to publish'))
		await flush(() => getApi().published())
		await flush(() => root.render(createElement('span', null, 'Published Story')))

		expect(storedDrafts.has('story:existing')).toBe(false)
	})
})
