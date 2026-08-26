import type { MapStackEntry } from './store'

/**
 * The interactive editor keeps a retained feature model even while its map
 * materialization is hidden. The Map Stack is the sole visibility authority:
 * the draft renders only while its ordered row is visible, unless another row
 * is isolated.
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
