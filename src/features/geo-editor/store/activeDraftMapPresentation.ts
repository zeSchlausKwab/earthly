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
 * pair owns `draft:active`. Whenever that pair is surfaced for authoring, this
 * row is present and visible so the editor and the map cannot contradict each
 * other.
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
			visible: true,
			pinned: false,
			isolated: existing?.isolated ?? false,
			exclusions: existing?.exclusions ?? [],
			addedAt: existing?.addedAt ?? Date.now(),
		},
	}
}

/** Restore the active edit's single visible row and suspend its published twin. */
export function ensureActiveDraftMapPresentation(state: EditorState): boolean {
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

	const current = state.mapStackEntries[presentation.entry.id]
	const isCanonical =
		state.mapStackOrder.includes(presentation.entry.id) &&
		current?.entityType === presentation.entry.entityType &&
		current.entityKey === presentation.entry.entityKey &&
		current.title === presentation.entry.title &&
		current.source === presentation.entry.source &&
		current.visible === true &&
		current.pinned === false
	if (!isCanonical) {
		state.addMapStackEntry(presentation.entry)
		changed = true
	}
	return changed
}
