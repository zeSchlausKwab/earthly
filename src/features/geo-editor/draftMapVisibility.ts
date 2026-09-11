import type { MapStackEntry } from './store'

/**
 * The interactive editor keeps a retained feature model even while its map
 * materialization is hidden. Canvas visibility is controlled by its ordered
 * row, not by which editor or Thread happens to be open.
 */
export function isDraftGeometryVisible(
	entries: Record<string, MapStackEntry>,
	order: string[],
): boolean {
	const draft = entries['draft:active']
	if (draft?.entityType !== 'draft') return false
	if (!order.includes(draft.id)) return false

	const isolatedId = order.find((id) => entries[id]?.isolated)
	if (isolatedId !== undefined) return isolatedId === draft.id
	return draft.visible !== false
}
