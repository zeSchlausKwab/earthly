import type { GeoDataset } from '@/lib/nostr/geo-event'
import { useEditorStore } from './store'

/**
 * The retained editor identity captured before an asynchronous Dataset publish.
 *
 * Workspace and draft ids are deliberately absent from the published Nostr
 * address. Keeping them in this binding lets publication promote the same local
 * authoring task instead of creating a second workspace for the permanent
 * `dataset:<pubkey>:<d>` source.
 */
export interface DatasetPublicationBinding {
	workspaceId: string
	draftId: string
	sourceId: string
	draftUpdatedAt: number
}

export type DatasetPublicationReconciliation =
	| { status: 'unbound' }
	| { status: 'stale-binding' }
	| {
			status: 'reconciled'
			stillDisplayed: boolean
			draftWasUnchanged: boolean
	  }

/** Capture only a coherent, currently active Dataset authoring task. */
export function captureActiveDatasetPublicationBinding(): DatasetPublicationBinding | null {
	const state = useEditorStore.getState()
	const workspaceId = state.activeWorkspaceId
	const draftId = state.activeGeoEditDraftId
	if (!workspaceId || !draftId) return null

	const workspace = state.workspaces[workspaceId]
	const draft = state.geoEditDrafts[draftId]
	if (
		!workspace ||
		!draft ||
		workspace.activeDraftId !== draftId ||
		workspace.sourceId !== draft.sourceId
	) {
		return null
	}

	return {
		workspaceId,
		draftId,
		sourceId: draft.sourceId,
		draftUpdatedAt: draft.updatedAt,
	}
}

/**
 * Promote a retained local authoring identity to its published Dataset address.
 *
 * The exact captured workspace/draft relationship must still exist. This is an
 * identity reconciliation, not an automatic editor or Chat retarget. If the
 * user activated another sibling draft while publishing, that sibling remains
 * visible in a recovery workspace while the captured workspace, draft, and Chat
 * binding follow the published identity. If they navigated elsewhere, the
 * inactive authoring identity is promoted without disturbing the visible editor.
 */
export function reconcilePublishedDatasetIdentity(
	binding: DatasetPublicationBinding | null,
	dataset: GeoDataset,
	title?: string,
): DatasetPublicationReconciliation {
	if (!binding) return { status: 'unbound' }

	const state = useEditorStore.getState()
	const currentDraft = state.geoEditDrafts[binding.draftId]
	const currentWorkspace = state.workspaces[binding.workspaceId]
	if (
		!currentDraft ||
		!currentWorkspace ||
		currentDraft.sourceId !== binding.sourceId ||
		currentWorkspace.sourceId !== binding.sourceId ||
		(state.activeWorkspaceId === binding.workspaceId &&
			state.activeGeoEditDraftId !== currentWorkspace.activeDraftId)
	) {
		return { status: 'stale-binding' }
	}

	const selectedSibling =
		currentWorkspace.activeDraftId !== binding.draftId
			? state.geoEditDrafts[currentWorkspace.activeDraftId ?? '']
			: undefined
	if (
		currentWorkspace.activeDraftId !== binding.draftId &&
		(!selectedSibling || selectedSibling.sourceId !== binding.sourceId)
	) {
		// The captured task was deleted/rebound, or the active workspace is
		// internally incoherent. Do not guess which task owns the publication.
		return { status: 'stale-binding' }
	}

	const draftWasUnchanged = currentDraft.updatedAt === binding.draftUpdatedAt
	const datasetKey = `${dataset.pubkey}:${dataset.dTag}`
	const sourceId = `dataset:${datasetKey}`
	const siblingDraft =
		selectedSibling ??
		Object.values(state.geoEditDrafts)
			.filter((draft) => draft.id !== currentDraft.id && draft.sourceId === binding.sourceId)
			.sort((a, b) => b.updatedAt - a.updatedAt)[0]
	const previousWorkspaceIdentity = {
		sourceId: currentWorkspace.sourceId,
		kind: currentWorkspace.kind,
		datasetKey: currentWorkspace.datasetKey,
		baseRevisionId: currentWorkspace.baseRevisionId,
	}

	state.saveGeoEditDraft(currentDraft.id, { sourceId })
	const selectedSiblingStaysInWorkspace =
		Boolean(selectedSibling) && previousWorkspaceIdentity.sourceId === sourceId
	const workspaceActiveDraftId =
		selectedSiblingStaysInWorkspace && selectedSibling ? selectedSibling.id : currentDraft.id
	state.updateWorkspace(currentWorkspace.id, {
		sourceId,
		kind: 'dataset',
		datasetKey,
		baseRevisionId: dataset.event.id,
		activeDraftId: workspaceActiveDraftId,
		label: title || currentDraft.collectionMeta.name || currentDraft.name || currentWorkspace.label,
	})

	if (siblingDraft && previousWorkspaceIdentity.sourceId !== sourceId) {
		// A new/copy address moves only the published revision. Preserve the
		// remaining local revisions under their old source and without a Chat
		// binding, so neither history nor the active conversation is duplicated.
		const recoveryWorkspaceId = state.createWorkspace({
			sourceId: previousWorkspaceIdentity.sourceId,
			label: siblingDraft.collectionMeta.name || siblingDraft.name || currentWorkspace.label,
			kind: previousWorkspaceIdentity.kind,
			datasetKey: previousWorkspaceIdentity.datasetKey,
			baseRevisionId: previousWorkspaceIdentity.baseRevisionId,
			activeDraftId: siblingDraft.id,
			chatSessionId: null,
			activate: false,
		})
		// createWorkspace intentionally preserves an existing binding when its
		// input is null. A recovery task must never duplicate the captured Chat.
		useEditorStore.getState().updateWorkspace(recoveryWorkspaceId, { chatSessionId: null })
		if (selectedSibling && state.activeWorkspaceId === binding.workspaceId) {
			useEditorStore.getState().setActiveWorkspaceId(recoveryWorkspaceId)
		}
	}

	const latest = useEditorStore.getState()
	const siblingStillDisplayed =
		selectedSiblingStaysInWorkspace &&
		latest.activeWorkspaceId === binding.workspaceId &&
		latest.activeGeoEditDraftId === selectedSibling?.id &&
		latest.workspaces[binding.workspaceId]?.activeDraftId === selectedSibling?.id
	const stillDisplayed =
		latest.activeWorkspaceId === binding.workspaceId &&
		latest.activeGeoEditDraftId === binding.draftId &&
		latest.workspaces[binding.workspaceId]?.activeDraftId === binding.draftId
	if (siblingStillDisplayed) {
		// A same-address update advances the shared published base, but the user
		// continued on another local revision. Refresh only that base identity;
		// never replace the sibling's visible geometry or clear its dirty state.
		latest.setActiveDataset(dataset)
		latest.setIsDirty(true)
	} else if (stillDisplayed) {
		// The published event becomes this draft's new base. Edits made while the
		// async publish was running stay dirty against that base.
		latest.setActiveDataset(dataset)
		latest.setIsDirty(!draftWasUnchanged)
	}

	return { status: 'reconciled', stillDisplayed, draftWasUnchanged }
}
