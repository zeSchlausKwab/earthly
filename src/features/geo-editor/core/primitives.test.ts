import { describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from './test-harness'

describe('GeoEditor primitives', () => {
	test.each([
		'rectangle',
		'square',
		'circle',
		'triangle',
		'diamond',
	] as const)('inserts and selects a %s polygon', (shape) => {
		const editor = createHeadlessEditor()

		const feature = editor.insertPrimitive(shape)

		expect(feature.geometry.type).toBe('Polygon')
		expect(feature.properties?.primitiveShape).toBe(shape)
		expect(editor.getSelectedFeatures().map((item) => item.id)).toEqual([feature.id])
		expect(editor.getMode()).toBe('select')
		expect(editor.history.canUndo()).toBe(true)
		editor.destroy()
	})
})
