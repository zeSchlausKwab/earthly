import { describe, expect, test } from 'bun:test'
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
})
