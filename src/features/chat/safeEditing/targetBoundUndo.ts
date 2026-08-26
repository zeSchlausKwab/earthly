import { useEditorStore } from '@/features/geo-editor/store'
import type { ToolExecutionTarget } from '@/features/chat/tools/types'
import { planPendingDatasetUndo } from './pendingDiffCommit'
import { getPendingDiff, settlePendingDiffUndo } from './pendingDiffStore'

export type TargetBoundUndoResult = 'undone' | 'undo-unavailable'

function targetDraftIsAvailable(target: ToolExecutionTarget): boolean {
	if (
		target.entityType !== 'dataset' ||
		!target.workspaceId ||
		!target.draftId ||
		!target.sourceId
	) {
		return false
	}
	const state = useEditorStore.getState()
	const workspace = state.workspaces[target.workspaceId]
	const draft = state.geoEditDrafts[target.draftId]
	return Boolean(
		workspace &&
			workspace.sourceId === target.sourceId &&
			draft &&
			draft.sourceId === target.sourceId,
	)
}

export function isPendingDiffTargetVisible(target: ToolExecutionTarget): boolean {
	if (!targetDraftIsAvailable(target) || !target.workspaceId || !target.draftId) return false
	const state = useEditorStore.getState()
	const workspace = state.workspaces[target.workspaceId]
	return (
		state.activeWorkspaceId === target.workspaceId &&
		state.activeGeoEditDraftId === target.draftId &&
		workspace?.activeDraftId === target.draftId
	)
}

/**
 * Undo one exact, durably attached AI commit. This never consults the visible
 * editor history: it CASes only the fields the commit changed on its owning draft,
 * restores their preimages, and leaves disjoint later fields/features untouched.
 */
export function undoPendingDiff(id: string): TargetBoundUndoResult {
	const entry = getPendingDiff(id)
	const commit = entry?.commit
	const target = commit?.target
	if (entry?.status !== 'applied' || !commit || !target || !targetDraftIsAvailable(target)) {
		settlePendingDiffUndo(id, 'undo-unavailable')
		return 'undo-unavailable'
	}

	const state = useEditorStore.getState()
	const draft = target.draftId ? state.geoEditDrafts[target.draftId] : undefined
	if (!draft) {
		settlePendingDiffUndo(id, 'undo-unavailable')
		return 'undo-unavailable'
	}
	const plan = planPendingDatasetUndo(commit, entry.diff, draft)
	if (!plan.ok) {
		settlePendingDiffUndo(id, 'undo-unavailable')
		return 'undo-unavailable'
	}

	const updates: Parameters<typeof state.saveGeoEditDraft>[1] = {}
	if (plan.updates.features) updates.features = plan.updates.features
	if (plan.updates.collectionMeta) {
		updates.collectionMeta = plan.updates.collectionMeta
		updates.name = plan.updates.collectionMeta.name
		updates.description = plan.updates.collectionMeta.description
	}
	if (plan.updates.selectedFeatureIds) {
		updates.selectedFeatureIds = plan.updates.selectedFeatureIds
	}
	state.saveGeoEditDraft(draft.id, updates)

	// Surface only when the exact workspace/draft/source tuple is still visible.
	// A background Undo updates its owning local draft without touching whichever
	// unrelated Dataset the user currently has open.
	if (isPendingDiffTargetVisible(target)) {
		const latest = useEditorStore.getState()
		if (plan.updates.features) {
			latest.editor?.setFeatures(plan.updates.features)
			latest.setFeatures(plan.updates.features)
			const preservedSelection =
				useEditorStore.getState().geoEditDrafts[draft.id]?.selectedFeatureIds
			if (!plan.updates.selectedFeatureIds && preservedSelection) {
				useEditorStore.getState().editor?.selectFeatures([...preservedSelection])
			}
		}
		if (plan.updates.selectedFeatureIds) {
			useEditorStore.getState().editor?.selectFeatures([...plan.updates.selectedFeatureIds])
			useEditorStore.getState().setSelectedFeatureIds([...plan.updates.selectedFeatureIds])
		}
		if (plan.updates.collectionMeta) {
			useEditorStore.getState().setCollectionMeta(plan.updates.collectionMeta)
		}
	}

	settlePendingDiffUndo(id, 'undone')
	return 'undone'
}
