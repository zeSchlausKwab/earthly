import type { EditorMode } from './core'

const DRAWING_MODES = new Set<EditorMode>([
	'draw_point',
	'draw_linestring',
	'draw_polygon',
	'draw_annotation',
])

export function isDrawingEditorMode(mode: EditorMode): boolean {
	return DRAWING_MODES.has(mode)
}

export function getMobileDrawingGuidance(mode: EditorMode): string | null {
	switch (mode) {
		case 'draw_point':
			return 'Tap the flashing lock, then press and drag briefly on the map to place a point.'
		case 'draw_linestring':
			return 'Tap the flashing lock, then press and drag briefly to place each vertex. Press Finish when the line is complete.'
		case 'draw_polygon':
			return 'Tap the flashing lock, then press and drag briefly to place each vertex. Press Finish when the shape is complete.'
		case 'draw_annotation':
			return 'Tap the flashing lock, then press and drag briefly on the map to place the label.'
		default:
			return null
	}
}
