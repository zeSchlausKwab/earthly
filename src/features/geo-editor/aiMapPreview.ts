import type { Feature } from 'geojson'
import { isGeoJsonGeometry } from '@/lib/geo/normalizeGeoJSON'
import { useEditorStore } from './store'
import type { EditorState, GeoCollectionEditDraft, MapStackEntry } from './store/types'

type AiMapPreviewState = Pick<
	EditorState,
	| 'workspaces'
	| 'geoEditDrafts'
	| 'activeWorkspaceId'
	| 'activeGeoEditDraftId'
	| 'mapStackEntries'
	| 'mapStackOrder'
>

export function resolveAiMapPreviewDraft(
	state: Pick<AiMapPreviewState, 'workspaces' | 'geoEditDrafts'>,
	entry: MapStackEntry,
): GeoCollectionEditDraft | null {
	if (entry.entityType !== 'ai-result' || !entry.draftId) return null
	const workspace = state.workspaces[entry.entityKey]
	const draft = state.geoEditDrafts[entry.draftId]
	if (!workspace || !draft) return null
	return workspace.activeDraftId === draft.id && workspace.sourceId === draft.sourceId
		? draft
		: null
}

export function aiMapPreviewTitle(draft: GeoCollectionEditDraft): string {
	return draft.collectionMeta.name?.trim() || draft.name?.trim() || 'Untitled Map'
}

function hasGeometry(feature: Feature): boolean {
	if (feature.properties?.externalPlaceholder === true || !isGeoJsonGeometry(feature.geometry)) {
		return false
	}
	const geometry = feature.geometry
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.some((child) => hasGeometry({ ...feature, geometry: child }))
	}
	const containsPosition = (coordinates: unknown[]): boolean =>
		coordinates.some(
			(coordinate) =>
				typeof coordinate === 'number' ||
				(Array.isArray(coordinate) && containsPosition(coordinate)),
		)
	return containsPosition(geometry.coordinates)
}

function hasManualDraftRow(state: AiMapPreviewState, entry: MapStackEntry): boolean {
	return (
		state.activeWorkspaceId === entry.entityKey &&
		state.activeGeoEditDraftId === entry.draftId &&
		state.mapStackEntries['draft:active']?.entityType === 'draft' &&
		state.mapStackOrder.includes('draft:active')
	)
}

/** Consume the first geometry-bearing new Map once per run, even if later hidden or removed. */
export function createAiMapPreviewRevealer() {
	const revealedRuns = new Set<string>()
	return (
		state: EditorState,
		runId: string,
		chatId: string,
		workspaceId: string,
		draftId: string,
	): boolean => {
		const runKey = `${chatId}:${runId}`
		if (revealedRuns.has(runKey)) return false
		const workspace = state.workspaces[workspaceId]
		const entry: MapStackEntry = {
			id: `ai-result:${workspaceId}`,
			entityType: 'ai-result',
			entityKey: workspaceId,
			draftId,
			title: '',
			source: 'chat',
			visible: true,
			pinned: false,
			isolated: false,
			exclusions: [],
			addedAt: Date.now(),
		}
		const draft = resolveAiMapPreviewDraft(state, entry)
		if (!draft || workspace?.chatSessionId !== chatId) return false
		if (!draft.features.some(hasGeometry)) return false
		revealedRuns.add(runKey)
		if (hasManualDraftRow(state, entry) || state.mapStackEntries[entry.id]) return false
		state.addMapStackEntry({ ...entry, title: aiMapPreviewTitle(draft) })
		return true
	}
}

const revealAiMapPreview = createAiMapPreviewRevealer()

export function revealFirstAiMapGeometry(
	runId: string,
	chatId: string,
	workspaceId: string,
	draftId: string,
): boolean {
	return revealAiMapPreview(useEditorStore.getState(), runId, chatId, workspaceId, draftId)
}

/** Local geometry joins the styled canvas source without manufacturing a Nostr event. */
export function deriveAiMapPreviewFeatures(state: AiMapPreviewState): Feature[] {
	const isolatedId = state.mapStackOrder.find((id) => state.mapStackEntries[id]?.isolated)
	return state.mapStackOrder.flatMap((id) => {
		const entry = state.mapStackEntries[id]
		if (!entry || (isolatedId ? isolatedId !== id : !entry.visible)) return []
		const draft = resolveAiMapPreviewDraft(state, entry)
		if (!draft || hasManualDraftRow(state, entry)) return []
		return draft.features.filter(hasGeometry).map((feature) => {
			const properties = { ...feature.properties }
			delete properties.sourceEventId
			delete properties.datasetId
			delete properties.meta
			return {
				...feature,
				id: `${entry.id}:${feature.id}`,
				properties: {
					...properties,
					color: feature.properties?.color ?? draft.collectionMeta.color,
					localDraftId: draft.id,
					localWorkspaceId: entry.entityKey,
				},
			}
		})
	})
}

/** Refresh surviving previews only; background writes cannot undo a canvas choice. */
export function reconcileAiMapPreviews(state: EditorState): void {
	for (const id of state.mapStackOrder) {
		const entry = state.mapStackEntries[id]
		if (entry?.entityType !== 'ai-result') continue
		const draft = resolveAiMapPreviewDraft(state, entry)
		if (!draft || hasManualDraftRow(state, entry)) {
			state.removeMapStackEntry(id)
		} else if (entry.title !== aiMapPreviewTitle(draft)) {
			state.addMapStackEntry({ ...entry, title: aiMapPreviewTitle(draft) })
		}
	}
}
