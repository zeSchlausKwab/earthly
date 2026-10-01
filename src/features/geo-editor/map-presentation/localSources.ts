import type { FeatureCollection } from 'geojson'
import {
	authorizePresentationLayer,
	getUsableMapPresentation,
	mapPresentationSourceKey,
	type MapPresentationAuthorization,
	type MapPresentationParseResult,
	type PresentationSourceResolution,
} from '@/lib/map-presentation'
import type { EditorState } from '../store'
import { buildFeatureCollection } from '../datasetDraftPayload'

type LocalSourceState = Pick<
	EditorState,
	| 'workspaces'
	| 'geoEditDrafts'
	| 'activeWorkspaceId'
	| 'activeGeoEditDraftId'
	| 'pendingHydratedDraftId'
	| 'features'
	| 'collectionMeta'
	| 'viewMode'
>

/** Retained Map names are the author-facing title; workspace labels may still be placeholders. */
export function localMapPresentationLabel(
	state: Pick<EditorState, 'workspaces' | 'geoEditDrafts'>,
	workspaceId: string,
): string {
	const workspace = state.workspaces[workspaceId]
	const draft = state.geoEditDrafts[workspace?.activeDraftId ?? '']
	return draft?.name.trim() || workspace?.label.trim() || 'Local Map'
}

/** Resolve only explicitly authorized sources in the already-hydrated account partition. */
export function resolveLocalPresentationSources(options: {
	presentation: MapPresentationParseResult
	authorization: MapPresentationAuthorization
	state: LocalSourceState
	activeAccount: string | null
	hydratedAccount: string | null
}): ReadonlyMap<string, PresentationSourceResolution> {
	const states = new Map<string, PresentationSourceResolution>()
	const presentation = getUsableMapPresentation(options.presentation)
	if (!presentation) return states
	for (const layer of presentation.layers) {
		if (
			typeof layer.source === 'string' ||
			authorizePresentationLayer(layer, options.authorization).status !== 'authorized'
		)
			continue
		const key = mapPresentationSourceKey(layer.source)
		if (states.has(key)) continue
		if (options.activeAccount !== options.hydratedAccount) {
			states.set(key, { status: 'missing-source' })
			continue
		}
		const { state } = options
		const workspace = state.workspaces[layer.source.workspaceId]
		const draft = state.geoEditDrafts[workspace?.activeDraftId ?? '']
		if (!workspace || !draft || draft.sourceId !== workspace.sourceId) {
			states.set(key, { status: 'missing-source' })
			continue
		}
		if (state.pendingHydratedDraftId === draft.id) {
			states.set(key, { status: 'loading' })
			continue
		}
		// Live edits win over the debounced retained snapshot only for its exact active pair.
		const active =
			state.viewMode === 'edit' &&
			state.activeWorkspaceId === workspace.id &&
			state.activeGeoEditDraftId === draft.id
		const current = active
			? { ...draft, features: state.features, collectionMeta: state.collectionMeta }
			: draft
		const featureCollection = buildFeatureCollection(current) as FeatureCollection
		states.set(key, { status: 'resolved', featureCollection })
	}
	return states
}
