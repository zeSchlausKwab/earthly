import { describe, expect, test } from 'bun:test'
import type { MapMouseEvent } from 'maplibre-gl'
import type { EditorEvent, EditorFeature } from './types'
import { createHeadlessEditor, createMockMap } from './test-harness'

function makePoint(id: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [13.4, 52.5] },
		properties: { name: 'Smoke Point' },
	}
}

describe('headless GeoEditor harness', () => {
	test('createMockMap exposes the editor-facing map surface', () => {
		const map = createMockMap()
		// Sanity-check a representative sample of the methods GeoEditor touches.
		expect(typeof map.addSource).toBe('function')
		expect(typeof map.getStyle).toBe('function')
		expect(typeof map.dragPan.isEnabled).toBe('function')
		expect(typeof map.on).toBe('function')
	})

	test('createHeadlessEditor constructs a GeoEditor without throwing', () => {
		expect(() => createHeadlessEditor()).not.toThrow()
	})

	test('addFeature then getAllFeatures round-trips a single feature', () => {
		const editor = createHeadlessEditor()
		editor.addFeature(makePoint('smoke-1'))
		const all = editor.getAllFeatures()
		expect(all).toHaveLength(1)
		expect(all[0]?.id).toBe('smoke-1')
	})

	test('subscribing to "create" fires on addFeature', () => {
		const editor = createHeadlessEditor()
		const received: EditorEvent[] = []
		editor.on('create', (event) => {
			received.push(event)
		})
		editor.addFeature(makePoint('smoke-2'))
		expect(received).toHaveLength(1)
		expect(received[0]?.type).toBe('create')
		expect(received[0]?.features?.[0]?.id).toBe('smoke-2')
	})

	test('setFeatures replaces the feature set', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('a'), makePoint('b')])
		expect(editor.getAllFeatures()).toHaveLength(2)
	})

	test('read-only interaction gate blocks map mutations without changing the mode', () => {
		const editor = createHeadlessEditor()
		editor.setMode('draw_point')
		const click = {
			lngLat: { lng: 13.4, lat: 52.5 },
			point: { x: 13.4, y: 52.5 },
			originalEvent: {},
			preventDefault: () => {},
		} as unknown as MapMouseEvent
		const invokeMapClick = () => {
			;(editor as unknown as { onClick: (event: MapMouseEvent) => void }).onClick(click)
		}

		editor.setInteractionEnabled(false)
		invokeMapClick()
		expect(editor.getAllFeatures()).toHaveLength(0)
		expect(editor.getMode()).toBe('draw_point')

		editor.setInteractionEnabled(true)
		invokeMapClick()
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(editor.getMode()).toBe('draw_point')
	})

	test('reorderFeatures persists order and participates in undo/redo', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('a'), makePoint('b'), makePoint('c')])

		expect(editor.reorderFeatures(['c', 'a', 'b'])).toBe(true)
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['c', 'a', 'b'])
		expect(editor.history.canUndo()).toBe(true)

		editor.undo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['a', 'b', 'c'])

		editor.redo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['c', 'a', 'b'])
	})

	test('reorderFeatures rejects incomplete feature orders', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([makePoint('a'), makePoint('b')])
		expect(() => editor.reorderFeatures(['a'])).toThrow(
			'Feature order must contain every geometry exactly once.',
		)
	})
})
