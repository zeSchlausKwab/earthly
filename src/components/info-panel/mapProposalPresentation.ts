export interface MapEditPresentation {
	actionLabel: 'Edit map' | 'Propose changes'
	workspaceStatus: 'proposing' | null
}

/**
 * Keeps the editor's working-copy implementation honest in the UI: a non-owner
 * is preparing a proposal, not creating an independent copy for its own sake.
 */
export function getMapEditPresentation(isOwner: boolean): MapEditPresentation {
	return isOwner
		? { actionLabel: 'Edit map', workspaceStatus: null }
		: { actionLabel: 'Propose changes', workspaceStatus: 'proposing' }
}
