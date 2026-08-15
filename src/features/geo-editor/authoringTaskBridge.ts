/**
 * Imperative seam used by non-React authoring tools to request a durable local
 * Dataset draft at the moment they actually mutate the editor. GeoEditorView
 * owns the route-aware implementation; chat tools only know that a mutation
 * must have a recoverable target.
 */
export interface DatasetDraftRequest {
	/** Start a fresh map even when this conversation already owns a target. */
	forceNew?: boolean
}

type DatasetDraftEnsurer = (request?: DatasetDraftRequest) => void | Promise<void>

let datasetDraftEnsurer: DatasetDraftEnsurer | null = null

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
export async function startDatasetDraftForActiveChat(): Promise<void> {
	await datasetDraftEnsurer?.({ forceNew: true })
}
