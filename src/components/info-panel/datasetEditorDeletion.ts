export type DatasetEditorDeleteMode = 'published-dataset' | 'local-workspace' | null

interface DatasetEditorDeleteState {
	hasActiveDataset: boolean
	isDatasetOwner: boolean
	hasActiveWorkspace: boolean
	canDeleteWorkspace: boolean
}

/**
 * Selects the destructive action exposed by the Dataset editor.
 *
 * An owned published Dataset is deleted through Nostr. A scratch draft or an
 * edit of somebody else's Dataset can only discard its local saved workspace.
 * The two operations deliberately never masquerade as one another.
 */
export function resolveDatasetEditorDeleteMode({
	hasActiveDataset,
	isDatasetOwner,
	hasActiveWorkspace,
	canDeleteWorkspace,
}: DatasetEditorDeleteState): DatasetEditorDeleteMode {
	if (hasActiveDataset && isDatasetOwner) return 'published-dataset'
	if (hasActiveWorkspace && canDeleteWorkspace) return 'local-workspace'
	return null
}
