import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { parseHTML } from 'linkedom'
import type { Root } from 'react-dom/client'
import { DatasetFeaturesList, summarizeFeature } from './DatasetFeaturesList'

let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
const roots: Root[] = []

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
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
	;({ act } = await import('react'))
	;({ createRoot } = await import('react-dom/client'))
})

afterEach(async () => {
	await act(async () => {
		for (const root of roots.splice(0)) root.unmount()
	})
	document.body.innerHTML = ''
})

function point(id: string, properties = {}): Feature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [12, 47] },
		properties: { name: `Point ${id}`, ...properties },
	}
}

async function renderList(
	features: Feature[],
	onZoomToFeature = (_feature: Feature<Geometry | null>) => {},
	onCommentOnFeature = (_feature: Feature<Geometry | null>) => {},
) {
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	roots.push(root)
	const featureCollection: FeatureCollection = { type: 'FeatureCollection', features }
	await act(async () =>
		root.render(
			<DatasetFeaturesList
				featureCollection={featureCollection}
				onZoomToFeature={onZoomToFeature}
				onCommentOnFeature={onCommentOnFeature}
			/>,
		),
	)
	return container
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
	const result = Array.from(container.querySelectorAll('button')).find(
		(item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text,
	)
	if (!result) throw new Error(`Button not found: ${text}`)
	return result
}

describe('Map inspect feature list', () => {
	test('caps the initial list without losing access to the rest', async () => {
		const container = await renderList(
			Array.from({ length: 15 }, (_, index) => point(String(index))),
		)
		expect(container.textContent).not.toContain('Point 14')
		await act(async () => button(container, 'Show all 15').click())
		expect(container.textContent).toContain('Point 14')
	})
	test('focuses by name and attaches geometry through a separate comment action', async () => {
		const feature = point('gate')
		const zoomed: Feature<Geometry | null>[] = []
		const commented: Feature<Geometry | null>[] = []
		const container = await renderList(
			[feature],
			(item) => zoomed.push(item),
			(item) => commented.push(item),
		)
		await act(async () => button(container, 'Point gate1 point').click())
		await act(async () => button(container, 'Comment on Point gate').click())
		expect(zoomed).toEqual([feature])
		expect(commented).toEqual([feature])
		expect(
			container.querySelector('[aria-label="Expand Point gate"]')?.getAttribute('aria-expanded'),
		).toBe('false')
	})
	test('keeps expansion tied to the original feature when a type filter changes', async () => {
		const line: Feature = {
			type: 'Feature',
			id: 'route',
			geometry: {
				type: 'LineString',
				coordinates: [
					[12, 47],
					[13, 47],
				],
			},
			properties: { name: 'Fallback route', access: 'crew' },
		}
		const container = await renderList([point('gate'), line])
		await act(async () => button(container, 'Expand Fallback route').click())
		await act(async () => button(container, 'LineString 1').click())
		expect(
			container
				.querySelector('[aria-label="Collapse Fallback route"]')
				?.getAttribute('aria-expanded'),
		).toBe('true')
		expect(container.textContent).toContain('crew')
		expect(container.textContent).not.toContain('Point gate')
	})
	test('summarizes vertices and custom properties without counting display metadata', () => {
		expect(summarizeFeature(point('gate', { access: 'crew' }))).toBe('1 point · 1 property')
		expect(
			summarizeFeature({
				type: 'Feature',
				geometry: {
					type: 'GeometryCollection',
					geometries: [
						{ type: 'Point', coordinates: [1, 2] },
						{
							type: 'LineString',
							coordinates: [
								[1, 2],
								[2, 3],
							],
						},
					],
				},
				properties: {},
			}),
		).toBe('3 points')
	})
})
