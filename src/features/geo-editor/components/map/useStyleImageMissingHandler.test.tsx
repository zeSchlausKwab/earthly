import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { Map as MapLibreMap, MissingStyleImageResolver } from 'maplibre-gl'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { FALLBACK_ICON_IMAGE_ID } from '../../icons/displayIcon'
import {
	GIZMO_MOVE_IMAGE_ID,
	GIZMO_ROTATE_IMAGE_ID,
	GIZMO_SCALE_IMAGE_ID,
	LINE_ARROW_IMAGE_ID,
} from '../../icons/registerDisplayIconImages'
import { useStyleImageMissingHandler } from './useStyleImageMissingHandler'

type Bitmap = { width: number; height: number; data: Uint8Array | Uint8ClampedArray }
type RegisteredImage = { bitmap: Bitmap; options?: { sdf?: boolean; pixelRatio?: number } }

function mapHarness() {
	const images = new Map<string, RegisteredImage>()
	let resolver: MissingStyleImageResolver | null = null
	let removed = false
	const map = {
		setMissingStyleImageResolver(next: MissingStyleImageResolver | null) {
			resolver = next
		},
		hasImage(id: string) {
			if (removed) throw new Error('Map removed')
			return images.has(id)
		},
		addImage(id: string, bitmap: Bitmap, options?: RegisteredImage['options']) {
			if (images.has(id)) throw new Error(`Duplicate image ${id}`)
			images.set(id, { bitmap, options })
		},
		removeImage(id: string) {
			images.delete(id)
		},
	} as unknown as MapLibreMap
	return {
		map,
		images,
		getResolver: () => resolver,
		remove: () => {
			removed = true
		},
		resolve(id: string) {
			if (!resolver) throw new Error('Missing-image resolver was not installed')
			return resolver(id)
		},
	}
}

// Control SVG decoding without mocking our icon registration or SDF conversion.
class PendingImage {
	static pending: PendingImage[] = []
	onload: (() => void) | null = null
	onerror: (() => void) | null = null
	set src(_value: string) {
		PendingImage.pending.push(this)
	}
}

class TestImageData implements Bitmap {
	constructor(
		readonly data: Uint8ClampedArray,
		readonly width: number,
		readonly height: number,
	) {}
}

const originalGlobals = new Map(
	[
		'window',
		'document',
		'HTMLElement',
		'Node',
		'Image',
		'ImageData',
		'IS_REACT_ACT_ENVIRONMENT',
	].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const),
)
let createRoot: typeof import('react-dom/client').createRoot
let root: Root | null
let container: HTMLElement

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const createElement = window.document.createElement.bind(window.document)
	window.document.createElement = (name: string, options?: ElementCreationOptions) => {
		const element = createElement(name, options)
		if (name === 'canvas') {
			Object.assign(element, {
				getContext: () => ({
					beginPath() {},
					arc() {},
					fill() {},
					moveTo() {},
					lineTo() {},
					closePath() {},
					stroke() {},
					drawImage() {},
					getImageData(_x: number, _y: number, width: number, height: number) {
						const data = new Uint8ClampedArray(width * height * 4)
						// A covered pixel guarantees a visible SDF without requiring native canvas.
						data[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3] = 255
						return new TestImageData(data, width, height)
					},
				}),
			})
		}
		return element
	}
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		Image: PendingImage,
		ImageData: TestImageData,
		IS_REACT_ACT_ENVIRONMENT: true,
	})
	;({ createRoot } = await import('react-dom/client'))
})

beforeEach(() => {
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	PendingImage.pending = []
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

function Probe({ map }: { map: MapLibreMap | null }) {
	useStyleImageMissingHandler(map)
	return null
}

async function mount(map: MapLibreMap | null) {
	await act(() => root?.render(<Probe map={map} />))
}

async function decodePendingImages(fail = false) {
	await act(async () => {
		for (const image of PendingImage.pending.splice(0)) {
			if (fail) image.onerror?.()
			else image.onload?.()
		}
	})
}

function expectVisibleSdf(image: RegisteredImage | undefined) {
	expect(image).toBeDefined()
	expect(image?.options).toEqual({ sdf: true, pixelRatio: 2 })
	expect(image?.bitmap.width).toBeGreaterThan(1)
	expect(image?.bitmap.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
}

describe('MapLibre missing-image resolution', () => {
	test('supplies an unavailable basemap sprite before the resolver returns and preserves existing images', async () => {
		const harness = mapHarness()
		await mount(harness.map)
		expect(harness.resolve('missing-basemap-icon')).toBeUndefined()
		const image = harness.images.get('missing-basemap-icon')
		expect(image?.bitmap).toEqual({ width: 1, height: 1, data: new Uint8ClampedArray(4) })
		harness.resolve('missing-basemap-icon')
		expect(harness.images.get('missing-basemap-icon')).toBe(image)
		harness.resolve('')
		expect(harness.images.size).toBe(1)
	})

	test('keeps bundled Lucide points visible while decoding and replaces their temporary dot', async () => {
		const harness = mapHarness()
		await mount(harness.map)
		harness.resolve('lucide:anchor')
		const fallback = harness.images.get('lucide:anchor')
		expectVisibleSdf(fallback)
		expect(PendingImage.pending).toHaveLength(1)
		await decodePendingImages()
		const glyph = harness.images.get('lucide:anchor')
		expectVisibleSdf(glyph)
		expect(glyph?.bitmap).not.toBe(fallback?.bitmap)

		// setStyle clears MapLibre's images, while the same map and hook survive.
		harness.images.clear()
		harness.resolve('lucide:anchor')
		expect(harness.images.get('lucide:anchor')?.bitmap).toBe(fallback?.bitmap)
		await act(async () => {})
		expect(harness.images.get('lucide:anchor')?.bitmap).toBe(glyph?.bitmap)
		expect(PendingImage.pending).toHaveLength(0)
	})

	test('uses visible SDF images for unknown glyphs, fallback markers, arrows and gizmos', async () => {
		const harness = mapHarness()
		await mount(harness.map)
		for (const id of [
			'lucide:unavailable-glyph',
			FALLBACK_ICON_IMAGE_ID,
			LINE_ARROW_IMAGE_ID,
			GIZMO_MOVE_IMAGE_ID,
			GIZMO_ROTATE_IMAGE_ID,
			GIZMO_SCALE_IMAGE_ID,
		]) {
			harness.resolve(id)
			expectVisibleSdf(harness.images.get(id))
		}
		expect(PendingImage.pending).toHaveLength(0)
	})

	test('leaves the visible fallback in place when SVG decoding fails', async () => {
		const harness = mapHarness()
		await mount(harness.map)
		harness.resolve('lucide:camera')
		const fallback = harness.images.get('lucide:camera')
		expectVisibleSdf(fallback)
		await decodePendingImages(true)
		expect(harness.images.get('lucide:camera')).toBe(fallback)
	})

	test('clears the old resolver and cancels pending replacements when maps change or unmount', async () => {
		const previous = mapHarness()
		const next = mapHarness()
		await mount(previous.map)
		const staleResolver = previous.getResolver()
		previous.resolve('lucide:flag')
		const fallback = previous.images.get('lucide:flag')
		await mount(next.map)
		expect(previous.getResolver()).toBeNull()
		expect(next.getResolver()).toBeFunction()
		staleResolver?.('old-basemap-icon')
		expect(previous.images.has('old-basemap-icon')).toBe(false)
		await decodePendingImages()
		expect(previous.images.get('lucide:flag')).toBe(fallback)
		await mount(null)
		expect(next.getResolver()).toBeNull()
	})

	test('ignores a late resolution after map removal', async () => {
		const harness = mapHarness()
		await mount(harness.map)
		harness.remove()
		expect(() => harness.resolve('removed-map-icon')).not.toThrow()
		expect(harness.images.size).toBe(0)
	})
})
