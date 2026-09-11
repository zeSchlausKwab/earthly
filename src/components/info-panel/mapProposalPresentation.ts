export type MapAuthoringIntent = 'edit' | 'propose' | 'fork'

export interface DatasetEditOptions {
	intent?: MapAuthoringIntent
}

/** Durable local provenance; this is not a new event kind or protocol field. */
export interface MapDraftSource {
	address: string
	pubkey: string
	identifier: string
	eventId: string
}

export function resolveMapAuthoringIntent(
	intent: MapAuthoringIntent | undefined,
	isOwner: boolean,
	privateScope = false,
): MapAuthoringIntent {
	if (intent) return intent
	return isOwner ? 'edit' : privateScope ? 'fork' : 'propose'
}

export function mapDraftSourceId(datasetKey: string, intent: MapAuthoringIntent): string {
	return `${intent === 'fork' ? 'fork' : 'dataset'}:${datasetKey}`
}

export function mapIntentAllowsPublication(
	intent: MapAuthoringIntent,
	action: 'update' | 'copy' | 'propose',
	isOwner: boolean,
	privateScope: boolean,
): boolean {
	if (action === 'update') return intent === 'edit' && isOwner
	if (action === 'copy') return intent === 'fork' || (intent === 'edit' && isOwner)
	return intent === 'propose' && !isOwner && !privateScope
}

export interface MapEditPresentation {
	actionLabel: 'Edit map' | 'Propose changes' | 'Fork map'
	workspaceStatus: 'proposing' | 'fork' | null
}

/**
 * Names the selected local workflow without implying that entry publishes it.
 */
export function getMapEditPresentation(
	isOwner: boolean,
	intent?: MapAuthoringIntent,
): MapEditPresentation {
	const resolved = resolveMapAuthoringIntent(intent, isOwner)
	if (resolved === 'fork') return { actionLabel: 'Fork map', workspaceStatus: 'fork' }
	return resolved === 'edit'
		? { actionLabel: 'Edit map', workspaceStatus: null }
		: { actionLabel: 'Propose changes', workspaceStatus: 'proposing' }
}
