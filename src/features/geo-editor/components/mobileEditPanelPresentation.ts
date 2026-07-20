export interface MobileEditPanelPresentationInput {
	contextEditorMode?: 'none' | 'create' | 'edit'
	storyEditorMode?: 'none' | 'create' | 'edit'
	sightingEditorMode?: 'none' | 'create' | 'edit'
	beaconControlMode?: 'none' | 'create' | 'adjust'
	hasViewedDataset?: boolean
	hasViewedContext?: boolean
	hasViewedStory?: boolean
	hasViewedSighting?: boolean
	hasViewedBeacon?: boolean
}

export interface MobileEditPanelPresentation {
	label: string
	intent: 'author' | 'inspect'
}

/**
 * The mobile `edit` tab hosts several different product surfaces. Give the
 * shell an honest title so inspecting an entity is not announced as editing it.
 */
export function resolveMobileEditPanelPresentation({
	contextEditorMode = 'none',
	storyEditorMode = 'none',
	sightingEditorMode = 'none',
	beaconControlMode = 'none',
	hasViewedDataset = false,
	hasViewedContext = false,
	hasViewedStory = false,
	hasViewedSighting = false,
	hasViewedBeacon = false,
}: MobileEditPanelPresentationInput): MobileEditPanelPresentation {
	if (contextEditorMode === 'create') return { label: 'New context', intent: 'author' }
	if (contextEditorMode === 'edit') return { label: 'Edit context', intent: 'author' }
	if (storyEditorMode === 'create') return { label: 'New story', intent: 'author' }
	if (storyEditorMode === 'edit') return { label: 'Edit story', intent: 'author' }
	if (sightingEditorMode === 'create') return { label: 'New sighting', intent: 'author' }
	if (sightingEditorMode === 'edit') return { label: 'Edit sighting', intent: 'author' }
	if (beaconControlMode === 'create') return { label: 'Share live location', intent: 'author' }
	if (beaconControlMode === 'adjust') return { label: 'Adjust live location', intent: 'author' }

	if (hasViewedDataset) return { label: 'Dataset', intent: 'inspect' }
	if (hasViewedContext) return { label: 'Context', intent: 'inspect' }
	if (hasViewedStory) return { label: 'Story', intent: 'inspect' }
	if (hasViewedSighting) return { label: 'Sighting', intent: 'inspect' }
	if (hasViewedBeacon) return { label: 'Live location', intent: 'inspect' }

	return { label: 'Inspect', intent: 'inspect' }
}
