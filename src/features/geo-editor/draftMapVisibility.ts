import type { MapStackEntry } from './store'

/**
 * The interactive editor keeps a retained feature model even while its map
 * materialization is hidden. While Dataset authoring is active its ordered row
 * is always visible; isolating another layer does not make the edit disappear.
 */
export function isDraftGeometryVisible(
	entries: Record<string, MapStackEntry>,
	order: string[],
	{ activeAuthoring = false }: { activeAuthoring?: boolean } = {},
): boolean {
	const draft = entries['draft:active']
	if (draft?.entityType !== 'draft') return false
	if (!order.includes(draft.id)) return false
	if (activeAuthoring) return true

	const isolatedId = order.find((id) => entries[id]?.isolated)
	if (isolatedId !== undefined) return isolatedId === draft.id
	return draft.visible !== false
}
