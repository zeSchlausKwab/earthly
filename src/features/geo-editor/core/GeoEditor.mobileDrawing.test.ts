import { describe, expect, test } from 'bun:test'
import type { MapMouseEvent } from 'maplibre-gl'
import { createHeadlessEditor } from './test-harness'
import type { GeoEditor } from './GeoEditor'

function tap(editor: GeoEditor, lng: number, lat: number) {
	const interactive = editor as unknown as { onClick: (event: MapMouseEvent) => void }
	interactive.onClick({
		lngLat: { lng, lat },
		point: { x: lng, y: lat },
		originalEvent: { shiftKey: false },
	} as MapMouseEvent)
}

describe('phone drawing controls', () => {
	test('counts committed vertices and undoes only the pending point', () => {
		const editor = createHeadlessEditor()
		editor.setMode('draw_linestring')
		tap(editor, 10, 20)
		tap(editor, 11, 21)
		expect(editor.getDrawingPointCount()).toBe(2)
		expect(editor.canFinishDrawing()).toBe(true)
		let changes = 0
		editor.on('draw.change', () => {
			changes += 1
		})
		expect(editor.undoDrawingPoint()).toBe(true)
		expect(editor.getDrawingPointCount()).toBe(1)
		expect(editor.canFinishDrawing()).toBe(false)
		expect(changes).toBe(1)
		expect(editor.undoDrawingPoint()).toBe(true)
		expect(editor.undoDrawingPoint()).toBe(false)
	})
	test('Cancel clears the active gesture but retains completed draft geometry', () => {
		const editor = createHeadlessEditor()
		editor.setMode('draw_linestring')
		tap(editor, 10, 20)
		tap(editor, 11, 21)
		expect(editor.finishDrawing()).not.toBeNull()
		tap(editor, 12, 22)
		editor.cancelDrawing()
		expect(editor.getDrawingPointCount()).toBe(0)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(editor.getMode()).toBe('select')
	})
})
