import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MapPresentationLayerV1, StoryViewBlockV1 } from '@/lib/map-presentation'
import { StoryViewBlockEditor, StoryViewLayersContext } from './StoryViewBlockEditor'

const originalGlobals = new Map(
	['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'].map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
	),
)
let container: HTMLDivElement
let root: Root
let saved: StoryViewBlockV1[]
const view: StoryViewBlockV1 = {
	version: 1,
	type: 'view',
	id: 'front-view',
	title: 'The line freezes',
	caption: 'Before the offensive',
	display: 'both',
	layers: { front: { visible: true, opacityMultiplier: 0.4, style: { strokeColor: '#225577' } } },
}
const layer: MapPresentationLayerV1 = {
	id: 'front',
	source: `37515:${'a'.repeat(64)}:western-front`,
	visible: false,
	opacityMultiplier: 1,
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
	saved = []
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	await act(() => root.unmount())
	container.remove()
})
afterAll(() => {
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
})

function Harness({
	initial = view,
	layers = [layer],
	editable = true,
}: {
	initial?: StoryViewBlockV1
	layers?: readonly MapPresentationLayerV1[]
	editable?: boolean
}) {
	const [current, setCurrent] = useState(initial)
	return (
		<StoryViewLayersContext.Provider value={layers}>
			<StoryViewBlockEditor
				view={current}
				editable={editable}
				canMoveUp
				canMoveDown
				onChange={(next) => {
					saved.push(next)
					setCurrent(next)
				}}
				onCapture={() => ({
					camera: { center: [4.4, 49.6], zoom: 7 },
					layers: { front: { visible: false } },
				})}
				onActivate={() => {}}
			/>
		</StoryViewLayersContext.Provider>
	)
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
	await act(() => root.render(<Harness {...props} />))
}
function button(name: string) {
	const result = Array.from(container.querySelectorAll('button')).find(
		(candidate) =>
			candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
	)
	if (!result) throw new Error(`Missing button: ${name}`)
	return result
}
async function click(name: string) {
	await act(() => button(name).click())
}
function select(label: string) {
	const result = Array.from(container.querySelectorAll('label'))
		.find((candidate) => candidate.querySelector('span')?.textContent === label)
		?.querySelector('select')
	if (!result) throw new Error(`Missing select: ${label}`)
	return result
}
async function choose(label: string, value: string) {
	await act(() => {
		const field = select(label)
		for (const option of Array.from(field.options)) option.removeAttribute('selected')
		field.querySelector(`option[value="${value}"]`)?.setAttribute('selected', '')
		field.dispatchEvent(new window.Event('change', { bubbles: true }))
	})
}

describe('manual Story view controls', () => {
	test('opens current stable layers without materializing inherited values or changing the body', async () => {
		await render()
		await click('Camera and layers')
		expect(container.textContent).toContain('front')
		expect(container.textContent).toContain('Use the preceding main-map cue or opening camera.')
		expect(select('Visibility').value).toBe('show')
		expect(saved).toHaveLength(0)
		await render({ layers: [layer, { ...layer, id: 'battles' }] })
		expect(
			Array.from(container.querySelectorAll('legend')).map((legend) => legend.textContent),
		).toContain('battles')
		expect(saved).toHaveLength(0)
	})

	test('changes cue/figure/both and makes figure-only behavior explicit', async () => {
		await render()
		await choose('Display', 'figure')
		expect(saved.at(-1)?.display).toBe('figure')
		expect(container.textContent).toContain('does not change the main map or later views')
		expect(button('Preview figure')).toBeDefined()
		await choose('Display', 'cue')
		expect(saved.at(-1)?.display).toBe('cue')
		await choose('Display', 'both')
		expect(saved.at(-1)?.display).toBe('both')
		expect(saved.at(-1)?.caption).toBe(view.caption)
	})

	test('visibility and style inheritance remove only those sparse keys', async () => {
		await render()
		await click('Camera and layers')
		await choose('Visibility', 'inherit')
		expect(saved.at(-1)?.layers?.front).toEqual({
			opacityMultiplier: 0.4,
			style: { strokeColor: '#225577' },
		})
		await click('Style overrides · 1')
		expect(container.textContent).toContain('Point radius')
		expect(container.textContent).toContain('Display icon')
		await choose('Line dash', 'dashed')
		expect(saved.at(-1)?.layers?.front?.style).toEqual({
			strokeColor: '#225577',
			lineDash: 'dashed',
		})
		await click('Inherit styling')
		expect(saved.at(-1)?.layers?.front).toEqual({ opacityMultiplier: 0.4 })
		await click('Inherit all layer settings')
		expect(saved.at(-1)).not.toHaveProperty('layers')
	})

	test('captures and clears camera without losing caption, identity or unrelated layer changes', async () => {
		await render()
		await click('Capture current map')
		expect(saved.at(-1)?.camera).toEqual({ center: [4.4, 49.6], zoom: 7 })
		await click('Camera and layers')
		expect(container.textContent).toContain('Longitude')
		expect(container.textContent).toContain('Bearing')
		await click('Inherit camera')
		expect(saved.at(-1)).not.toHaveProperty('camera')
		expect(saved.at(-1)?.layers).toEqual({ front: { visible: false } })
		expect(saved.at(-1)?.id).toBe(view.id)
		expect(saved.at(-1)?.caption).toBe(view.caption)
	})

	test('retains orphaned layer changes with an explanation instead of silently dropping them', async () => {
		await render({ layers: [] })
		await click('Camera and layers')
		expect(container.textContent).toContain('missing from the opening map')
		expect(select('Visibility').value).toBe('show')
		expect(saved).toHaveLength(0)
	})

	test('read-only blocks expose inspection but not mutation actions', async () => {
		await render({ editable: false })
		await click('Camera and layers')
		expect(select('Display').disabled).toBe(true)
		expect(select('Visibility').disabled).toBe(true)
		expect(container.querySelector('button[aria-label="Remove Story view"]')).toBeNull()
		expect(container.querySelector('button[aria-label="Move Story view up"]')).toBeNull()
		expect(container.textContent).not.toContain('Capture current map')
	})
})
