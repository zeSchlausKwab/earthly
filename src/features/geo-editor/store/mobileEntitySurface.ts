import type {
	EditorState,
	GeoCollectionEditDraft,
	GeoEditorWorkspace,
	MobileEntitySurface,
	MobileEntitySurfaceAvailability,
} from './types'

type RetainedDatasetState = Pick<
	EditorState,
	'activeWorkspaceId' | 'activeGeoEditDraftId' | 'workspaces' | 'geoEditDrafts'
>

export interface RetainedDatasetSurfaceTarget {
	workspace: GeoEditorWorkspace
	draft: GeoCollectionEditDraft
}

/**
 * Resolve a Dataset editor from the durable workspace -> draft relationship.
 * Map Stack membership is intentionally absent: it controls what is rendered,
 * not whether saved work remains available in the Edit sheet.
 */
export function getRetainedDatasetSurfaceTarget(
	state: RetainedDatasetState,
	workspaceId: string | null = state.activeWorkspaceId,
): RetainedDatasetSurfaceTarget | null {
	if (!workspaceId) return null
	const workspace = state.workspaces[workspaceId]
	if (!workspace) return null

	const workspaceDraft = workspace.activeDraftId
		? state.geoEditDrafts[workspace.activeDraftId]
		: null
	if (workspaceDraft?.sourceId === workspace.sourceId) {
		return { workspace, draft: workspaceDraft }
	}

	// During migration and the short atomic hand-off between workspace/draft
	// writers, the active draft can be the repaired pointer before the workspace
	// record catches up. Only accept it for the active workspace and only when its
	// source identity proves that it belongs there.
	if (workspaceId !== state.activeWorkspaceId || !state.activeGeoEditDraftId) return null
	const activeDraft = state.geoEditDrafts[state.activeGeoEditDraftId]
	return activeDraft?.sourceId === workspace.sourceId ? { workspace, draft: activeDraft } : null
}

export function hasRetainedDatasetSurface(state: RetainedDatasetState): boolean {
	return getRetainedDatasetSurfaceTarget(state) !== null
}

export interface DraftEditorOpenPlan {
	workspaceId: string
	switchWorkspace: boolean
	navigateToEditRoute: boolean
}

/**
 * Validate a Dataset editor-open request before any workspace, route, or Map
 * Stack mutation occurs. An explicit missing ID never falls back to the active
 * workspace. Mobile opens the map-bound Edit sheet without rewriting the URL.
 */
export function resolveDraftEditorOpenPlan(
	state: RetainedDatasetState,
	requestedWorkspaceId: string | undefined,
	isMobile: boolean,
): DraftEditorOpenPlan | null {
	const workspaceId = requestedWorkspaceId ?? state.activeWorkspaceId
	if (!workspaceId || !getRetainedDatasetSurfaceTarget(state, workspaceId)) return null

	const switchWorkspace = state.activeWorkspaceId !== workspaceId
	return {
		workspaceId,
		switchWorkspace,
		navigateToEditRoute: !isMobile,
	}
}

/**
 * Keep the last explicit choice when it still exists, otherwise choose one
 * deterministic available surface. Consumers must use the returned value for
 * both their title and body instead of maintaining independent priority lists.
 */
export function resolveMobileEntitySurface(
	selected: MobileEntitySurface | null,
	available: MobileEntitySurfaceAvailability,
): MobileEntitySurface | null {
	if (selected && available[selected]) return selected

	// Transient flows are already explicit, so they only win while selected.
	// Durable work falls back to the active Dataset first, then the other retained
	// editors, and finally the read-only Inspector.
	for (const candidate of ['dataset', 'story', 'context', 'inspector'] as const) {
		if (available[candidate]) return candidate
	}
	return null
}
