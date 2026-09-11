import type { EditorState, MapStackEntry } from './types'
import { getRetainedDatasetSurfaceTarget } from './mobileEntitySurface'

type ActiveDraftMapState = Pick<
	EditorState,
	| 'activeWorkspaceId'
	| 'activeGeoEditDraftId'
	| 'viewMode'
	| 'stance'
	| 'workspaces'
	| 'geoEditDrafts'
	| 'mapStackEntries'
	| 'mapStackOrder'
>

export interface ActiveDraftMapPresentation {
	workspaceId: string
	draftId: string
	datasetKey: string | null
	entry: MapStackEntry
}

/**
 * Resolve the canonical Map Stack row for the active Dataset edit.
 *
 * A retained background draft is not enough: only the active workspace/draft
 * pair owns `draft:active`. Opening an edit reveals it initially; subsequent
 * visibility choices belong to the user, independently of the retained editor.
 */
export function resolveActiveDraftMapPresentation(
	state: ActiveDraftMapState,
): ActiveDraftMapPresentation | null {
	if (state.viewMode !== 'edit' || state.stance !== 'author') return null
	const target = getRetainedDatasetSurfaceTarget(state)
	if (!target || target.draft.id !== state.activeGeoEditDraftId) return null

	const existing = state.mapStackEntries['draft:active']
	const title =
		target.draft.collectionMeta?.name?.trim() ||
		target.draft.name?.trim() ||
		target.workspace.label?.trim() ||
		'Untitled draft'

	return {
		workspaceId: target.workspace.id,
		draftId: target.draft.id,
		datasetKey: target.workspace.datasetKey,
		entry: {
			id: 'draft:active',
			entityType: 'draft',
			entityKey: 'draft:active',
			title,
			source: 'workspace',
			visible: existing?.visible ?? true,
			pinned: false,
			isolated: existing?.isolated ?? false,
			exclusions: existing?.exclusions ?? [],
			addedAt: existing?.addedAt ?? Date.now(),
		},
	}
}

/** Keep the active edit's row in sync without undoing explicit Hide/Remove. */
export function ensureActiveDraftMapPresentation(
	state: EditorState,
	{ reveal = false }: { reveal?: boolean } = {},
): boolean {
	const presentation = resolveActiveDraftMapPresentation(state)
	if (!presentation) return false

	let changed = false
	if (presentation.datasetKey) {
		for (const id of [...state.mapStackOrder]) {
			const entry = state.mapStackEntries[id]
			if (entry?.entityType === 'dataset' && entry.entityKey === presentation.datasetKey) {
				state.removeMapStackEntry(id)
				changed = true
			}
		}
	}

	if (!reveal && state.dismissedDraftMapId === presentation.draftId) return changed
	if (reveal) {
		presentation.entry.visible = true
		presentation.entry.isolated = false
		if (state.mapStackOrder.some((id) => state.mapStackEntries[id]?.isolated)) {
			state.clearMapStackIsolation()
			changed = true
		}
	}
	const current = state.mapStackEntries[presentation.entry.id]
	const isCanonical =
		state.mapStackOrder.includes(presentation.entry.id) &&
		current?.entityType === presentation.entry.entityType &&
		current.entityKey === presentation.entry.entityKey &&
		current.title === presentation.entry.title &&
		current.source === presentation.entry.source &&
		current.visible === presentation.entry.visible &&
		current.pinned === false
	if (!isCanonical) {
		state.addMapStackEntry(presentation.entry)
		changed = true
	}
	return changed
}
