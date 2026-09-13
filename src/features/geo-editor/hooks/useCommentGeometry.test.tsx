import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import type * as maplibregl from 'maplibre-gl'
import { useCommentGeometry, type CommentGeometryRecord } from './useCommentGeometry'

type Listener = (...args: never[]) => void

function mapHarness() {
	const sources = new Map<string, unknown>()
	const layers = new Map<string, { id: string }>()
	const events = new Map<string, Set<Listener>>()
	const layerEvents = new Map<string, Set<Listener>>()
	let styleLoaded = false
	let addedSources = 0
	let addedLayers = 0
	let addedLayerHandlers = 0
	const map = {
		isStyleLoaded: () => styleLoaded,
		getStyle: () => ({ version: 8, sources: {}, layers: [] }),
		getCanvas: () => ({ style: { cursor: '' } }),
		getSource: (id: string) => sources.get(id),
		getLayer: (id: string) => layers.get(id),
		addSource(id: string, source: unknown) {
			if (sources.has(id)) throw new Error(`Duplicate source ${id}`)
			addedSources += 1
			sources.set(id, source)
		},
		addLayer(layer: { id: string }) {
			if (layers.has(layer.id)) throw new Error(`Duplicate layer ${layer.id}`)
			addedLayers += 1
			layers.set(layer.id, layer)
		},
		removeSource: (id: string) => sources.delete(id),
		removeLayer: (id: string) => layers.delete(id),
		on(event: string, layerOrListener: string | Listener, listener?: Listener) {
			const registry = typeof layerOrListener === 'string' ? layerEvents : events
			const key = typeof layerOrListener === 'string' ? `${event}:${layerOrListener}` : event
			const callback = typeof layerOrListener === 'string' ? listener : layerOrListener
			if (!callback) throw new Error('Missing listener')
			if (typeof layerOrListener === 'string') addedLayerHandlers += 1
			const listeners = registry.get(key) ?? new Set<Listener>()
			listeners.add(callback)
			registry.set(key, listeners)
		},
		off(event: string, layerOrListener: string | Listener, listener?: Listener) {
			const registry = typeof layerOrListener === 'string' ? layerEvents : events
			const key = typeof layerOrListener === 'string' ? `${event}:${layerOrListener}` : event
			const callback = typeof layerOrListener === 'string' ? listener : layerOrListener
			if (callback) registry.get(key)?.delete(callback)
		},
	}
	return {
		map: map as unknown as maplibregl.Map,
		sources,
		layers,
		events,
		layerEvents,
		setStyleLoaded(value: boolean) {
			styleLoaded = value
		},
		emit(event: string) {
			for (const listener of [...(events.get(event) ?? [])]) listener()
		},
		counts: () => ({ addedSources, addedLayers, addedLayerHandlers }),
	}
}

function annotation(id = 'place-note'): CommentGeometryRecord {
	return {
		id,
		commentId: id,
		pubkey: 'author',
		text: 'The crossing is here',
		created_at: 1,
		geojson: {
			type: 'FeatureCollection',
			features: [
				{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [16, 48] } },
			],
		},
	}
}

let createRoot: typeof import('react-dom/client').createRoot
let root: Root | null
let container: HTMLElement
let latest: ReturnType<typeof useCommentGeometry> | undefined
const originalGlobals = new Map(
	['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'].map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
	),
)

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	;({ createRoot } = await import('react-dom/client'))
})
beforeEach(() => {
	latest = undefined
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	await act(() => root?.unmount())
	root = null
	container.remove()
})
afterAll(() => {
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
})

async function mount(harness: ReturnType<typeof mapHarness>) {
	const mapRef = { current: harness.map }
	function Probe() {
		latest = useCommentGeometry(mapRef, true)
		return null
	}
	await act(() => root?.render(<Probe />))
	return () => {
		if (!latest) throw new Error('Hook did not mount')
		return latest
	}
}

describe('comment geometry readiness', () => {
	test('restores Show requested during source loading when the map becomes idle without another style.load', async () => {
		const harness = mapHarness()
		const current = await mount(harness)
		await act(() => current().handleCommentGeometryVisibility(annotation(), true))
		expect(harness.sources.size).toBe(0)
		harness.setStyleLoaded(true)
		await act(() => harness.emit('idle'))
		expect(harness.sources.has('comment-geo-place-note')).toBe(true)
		expect(current().commentGeometryLayers.current.has('place-note')).toBe(true)
	})

	test('retries missing annotations without duplicating sources, layers or delegated handlers on later idle events', async () => {
		const harness = mapHarness()
		harness.setStyleLoaded(true)
		const current = await mount(harness)
		await act(() => current().handleCommentGeometryVisibility(annotation(), true))
		const shown = harness.counts()
		await act(() => {
			harness.emit('idle')
			harness.emit('idle')
			harness.emit('idle')
		})
		expect(harness.counts()).toEqual(shown)
		expect(harness.sources.size).toBe(1)
		expect(harness.layers.size).toBe(4)
		expect([...harness.layerEvents.values()].every((listeners) => listeners.size === 1)).toBe(true)
	})

	test.each([
		'hide',
		'prune',
	] as const)('does not resurrect an annotation removed by %s while its Show was queued', async (operation) => {
		const harness = mapHarness()
		const current = await mount(harness)
		await act(() => {
			current().handleCommentGeometryVisibility(annotation(), true)
			if (operation === 'hide') current().handleCommentGeometryVisibility(annotation(), false)
			else current().pruneCommentGeometry(() => false)
		})
		harness.setStyleLoaded(true)
		await act(() => harness.emit('idle'))
		expect(harness.sources.size).toBe(0)
		expect(harness.layers.size).toBe(0)
		expect(harness.counts().addedLayerHandlers).toBe(0)
	})

	test('replays only still-visible annotations after a real style replacement', async () => {
		const harness = mapHarness()
		harness.setStyleLoaded(true)
		const current = await mount(harness)
		await act(() => {
			current().handleCommentGeometryVisibility(annotation('visible'), true)
			current().handleCommentGeometryVisibility(annotation('hidden'), true)
			current().handleCommentGeometryVisibility(annotation('hidden'), false)
		})
		harness.sources.clear()
		harness.layers.clear()
		await act(() => harness.emit('style.load'))
		expect([...harness.sources.keys()]).toEqual(['comment-geo-visible'])
	})

	test('removes readiness and style listeners on unmount so a queued annotation cannot be replayed later', async () => {
		const harness = mapHarness()
		const current = await mount(harness)
		await act(() => current().handleCommentGeometryVisibility(annotation(), true))
		expect(harness.events.get('idle')?.size).toBe(1)
		expect(harness.events.get('style.load')?.size).toBe(1)
		await act(() => root?.unmount())
		root = null
		expect(harness.events.get('idle')?.size).toBe(0)
		expect(harness.events.get('style.load')?.size).toBe(0)
		harness.setStyleLoaded(true)
		harness.emit('idle')
		harness.emit('style.load')
		expect(harness.sources.size).toBe(0)
	})
})
