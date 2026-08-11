export interface GeometrySelectionModifiers {
	additive: boolean
	range: boolean
}

export interface GeometrySelectionResult {
	selectedIds: string[]
	anchorId: string
}

/**
 * Finder-style row selection for an ordered geometry list.
 *
 * - click replaces the selection and moves the anchor
 * - Cmd/Ctrl-click toggles one row and moves the anchor
 * - Shift-click replaces the selection with the inclusive anchor range
 * - Cmd/Ctrl-Shift-click adds the inclusive anchor range
 */
export function resolveGeometryRowSelection(
	orderedIds: readonly string[],
	selectedIds: readonly string[],
	anchorId: string | null,
	clickedId: string,
	modifiers: GeometrySelectionModifiers,
): GeometrySelectionResult {
	const clickedIndex = orderedIds.indexOf(clickedId)
	if (clickedIndex < 0) {
		return { selectedIds: [...selectedIds], anchorId: anchorId ?? clickedId }
	}

	const selectedSet = new Set(selectedIds)
	const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1

	if (modifiers.range && anchorIndex >= 0) {
		const resolvedAnchorId = orderedIds[anchorIndex] ?? clickedId
		const first = Math.min(anchorIndex, clickedIndex)
		const last = Math.max(anchorIndex, clickedIndex)
		const rangeIds = orderedIds.slice(first, last + 1)
		if (!modifiers.additive) {
			return { selectedIds: rangeIds, anchorId: resolvedAnchorId }
		}
		for (const id of rangeIds) selectedSet.add(id)
		return {
			selectedIds: orderedIds.filter((id) => selectedSet.has(id)),
			anchorId: resolvedAnchorId,
		}
	}

	if (modifiers.additive) {
		if (selectedSet.has(clickedId)) selectedSet.delete(clickedId)
		else selectedSet.add(clickedId)
		return {
			selectedIds: orderedIds.filter((id) => selectedSet.has(id)),
			anchorId: clickedId,
		}
	}

	return { selectedIds: [clickedId], anchorId: clickedId }
}

export type GeometryDropPlacement = 'before' | 'after'

export function reorderGeometryIds(
	orderedIds: readonly string[],
	draggedId: string,
	targetId: string,
	placement: GeometryDropPlacement,
): string[] {
	if (draggedId === targetId) return [...orderedIds]
	if (!orderedIds.includes(draggedId) || !orderedIds.includes(targetId)) return [...orderedIds]

	const next = orderedIds.filter((id) => id !== draggedId)
	const targetIndex = next.indexOf(targetId)
	const insertionIndex = placement === 'after' ? targetIndex + 1 : targetIndex
	next.splice(insertionIndex, 0, draggedId)
	return next
}

export function moveGeometryId(
	orderedIds: readonly string[],
	featureId: string,
	offset: -1 | 1,
): string[] {
	const currentIndex = orderedIds.indexOf(featureId)
	const nextIndex = currentIndex + offset
	if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) {
		return [...orderedIds]
	}
	const next = [...orderedIds]
	const current = next[currentIndex]
	const adjacent = next[nextIndex]
	if (current === undefined || adjacent === undefined) return next
	next[currentIndex] = adjacent
	next[nextIndex] = current
	return next
}
