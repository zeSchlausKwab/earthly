import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DeferredMapFigure } from './DeferredMapFigure'

const originalGlobals = new Map(
	[
		'window',
		'document',
		'HTMLElement',
		'Node',
		'IntersectionObserver',
		'IS_REACT_ACT_ENVIRONMENT',
	].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const),
)
let container: HTMLDivElement
let root: Root | undefined
let observers: FigureObserver[]
let mounts: number
let cleanups: number

class FigureObserver implements IntersectionObserver {
	readonly root = null
	readonly rootMargin: string
	readonly thresholds = [0]
	disconnected = false
	private targets = new Set<Element>()

	constructor(
		private callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit,
	) {
		this.rootMargin = options?.rootMargin ?? '0px'
		observers.push(this)
	}

	observe(target: Element) {
		this.targets.add(target)
	}

	unobserve(target: Element) {
		this.targets.delete(target)
	}

	disconnect() {
		this.disconnected = true
		this.targets.clear()
	}

	takeRecords(): IntersectionObserverEntry[] {
		return []
	}

	emit(target: Element, isIntersecting: boolean) {
		if (!this.targets.has(target)) return
		this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this)
	}
}

beforeAll(() => {
	const { window } = parseHTML('<html><body></body></html>')
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		IS_REACT_ACT_ENVIRONMENT: true,
	})
})
beforeEach(() => {
	observers = []
	mounts = 0
	cleanups = 0
	Object.assign(globalThis, { IntersectionObserver: FigureObserver })
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	if (root) await act(() => root?.unmount())
	container.remove()
})
afterAll(() => {
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
})

function MapResource() {
	useEffect(() => {
		mounts += 1
		return () => {
			cleanups += 1
		}
	}, [])
	return <section aria-label="Map figure">Map</section>
}

async function renderFigure() {
	await act(() =>
		root?.render(
			<DeferredMapFigure>
				<MapResource />
			</DeferredMapFigure>,
		),
	)
	const wrapper = container.querySelector('.earthly-reader__figure-map')
	if (!wrapper) throw new Error('Missing reserved map figure space')
	return wrapper
}

async function intersect(wrapper: Element, isIntersecting: boolean) {
	await act(() => {
		for (const observer of observers) observer.emit(wrapper, isIntersecting)
	})
}

describe('deferred Story map figures', () => {
	test('releases the offscreen map and recreates it on return without replacing its reserved space', async () => {
		const wrapper = await renderFigure()
		await intersect(wrapper, false)
		expect(mounts).toBe(0)
		expect(container.querySelector('[aria-label="Map figure"]')).toBeNull()

		await intersect(wrapper, true)
		expect(mounts).toBe(1)
		expect(cleanups).toBe(0)
		expect(container.querySelector('[aria-label="Map figure"]')).not.toBeNull()

		await intersect(wrapper, false)
		expect(cleanups).toBe(1)
		expect(container.querySelector('[aria-label="Map figure"]')).toBeNull()
		expect(container.querySelector('.earthly-reader__figure-map')).toBe(wrapper)

		await intersect(wrapper, true)
		expect(mounts).toBe(2)
		expect(cleanups).toBe(1)
		expect(container.querySelector('[aria-label="Map figure"]')).not.toBeNull()
		expect(container.querySelector('.earthly-reader__figure-map')).toBe(wrapper)
	})

	test('continues observing mounted figures and disconnects when the reader removes them', async () => {
		const wrapper = await renderFigure()
		const observer = observers[0]
		expect(observer).toBeDefined()
		await intersect(wrapper, true)
		expect(observer?.disconnected).toBe(false)
		await intersect(wrapper, false)
		expect(observer?.disconnected).toBe(false)

		await act(() => root?.unmount())
		root = undefined
		expect(observers.every((item) => item.disconnected)).toBe(true)
	})

	test('renders a readable figure when IntersectionObserver is unavailable', async () => {
		Reflect.deleteProperty(globalThis, 'IntersectionObserver')
		await renderFigure()
		expect(mounts).toBe(1)
		expect(container.querySelector('[aria-label="Map figure"]')).not.toBeNull()
		expect(observers).toHaveLength(0)
	})
})
