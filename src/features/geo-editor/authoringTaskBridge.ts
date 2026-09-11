/**
 * Imperative seam used by non-React authoring tools to request a durable local
 * Dataset draft at the moment they actually mutate the editor. GeoEditorView
 * owns the route-aware implementation; chat tools only know that a mutation
 * must have a recoverable target.
 */
import { useEditorStore } from './store'
import type { GeoDataset } from '@/lib/nostr/geo-event'

type MapPreparer = (dataset: GeoDataset, fork: boolean) => Promise<string>
let mapPreparer: MapPreparer | null = null
export function registerChatMapPreparer(prepare: MapPreparer) {
	mapPreparer = prepare
	return () => { if (mapPreparer === prepare) mapPreparer = null }
}
export async function prepareChatMap(dataset: GeoDataset, fork = false) {
	if (!mapPreparer) throw new Error('The map editor is not ready yet. Please try again.')
	return mapPreparer(dataset, fork)
}

export interface DatasetDraftRequest {
	/** Start a fresh map even when this conversation already owns a target. */
	forceNew?: boolean
	/** Retain the new target without changing the currently presented surface. */
	activate?: boolean
	chatSessionId?: string | null
}

type DatasetDraftEnsurer = (
	request?: DatasetDraftRequest,
) => string | null | undefined | Promise<string | null | undefined>

let datasetDraftEnsurer: DatasetDraftEnsurer | null = null
let workspaceOpener: ((workspaceId: string) => Promise<void>) | null = null

export function registerChatWorkspaceOpener(opener: (workspaceId: string) => Promise<void>): () => void {
	workspaceOpener = opener
	return () => { if (workspaceOpener === opener) workspaceOpener = null }
}

export async function openChatWorkspace(workspaceId: string): Promise<void> {
	if (!workspaceOpener || !useEditorStore.getState().workspaces[workspaceId]) throw new Error('This map draft is unavailable.')
	await workspaceOpener(workspaceId)
}

export function registerDatasetDraftEnsurer(ensurer: DatasetDraftEnsurer): () => void {
	datasetDraftEnsurer = ensurer
	return () => {
		if (datasetDraftEnsurer === ensurer) datasetDraftEnsurer = null
	}
}

export async function ensureDatasetDraftForMutation(): Promise<void> {
	await datasetDraftEnsurer?.()
}

/** Explicit UI intent: attach the active conversation to a brand-new map. */
export async function startDatasetDraftForActiveChat(
	chatSessionId: string,
): Promise<string | null> {
	const workspaceId =
		(await datasetDraftEnsurer?.({ forceNew: true, activate: false, chatSessionId })) ?? null
	if (!workspaceId) return null
	const state = useEditorStore.getState()
	if (state.workspaces[workspaceId]) {
		// Keep the legacy reverse pointer populated for persisted-session migration.
		// New code owns the binding on ChatSession.targetWorkspaceId, allowing more
		// than one conversation to reference this same workspace.
		state.updateWorkspace(workspaceId, { chatSessionId })
	}
	return workspaceId
}
