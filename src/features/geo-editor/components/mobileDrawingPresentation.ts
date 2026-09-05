import type { EditorMode } from '../core'

export function mobileDrawingHint(
	mode: EditorMode,
	pointCount: number,
	selectionCount: number,
): string {
	if (pointCount > 0)
		return mode === 'draw_polygon'
			? 'Tap corners, then Finish'
			: 'Tap points along the line, then Finish'
	if (mode === 'draw_point') return 'Tap the map to add a point'
	if (mode === 'draw_annotation') return 'Tap the map to place a label'
	if (mode.startsWith('draw_')) return 'Tap the map to start'
	if (mode === 'edit' && selectionCount > 0) return 'Drag selection handles to move or edit'
	if (selectionCount > 0) return 'Drag to pan · tap another feature to switch'
	return 'Select a feature, pick a tool, or tap Ask for AI help'
}

export function mobileDrawingCanFinish(mode: EditorMode, pointCount: number): boolean {
	return (
		(mode === 'draw_linestring' && pointCount >= 2) || (mode === 'draw_polygon' && pointCount >= 3)
	)
}
