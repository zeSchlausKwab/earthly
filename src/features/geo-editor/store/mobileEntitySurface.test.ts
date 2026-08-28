import { describe, expect, test } from 'bun:test'
import type { EditorState, GeoCollectionEditDraft, GeoEditorWorkspace } from './types'
import {
	getRetainedDatasetSurfaceTarget,
	hasRetainedDatasetSurface,
	resolveDraftEditorOpenPlan,
	resolveMobileEntitySurface,
} from './mobileEntitySurface'

const workspace = {
	id: 'workspace-1',
	sourceId: 'dataset:owner:map',
	activeDraftId: 'draft-1',
} as GeoEditorWorkspace
const draft = {
	id: 'draft-1',
	sourceId: workspace.sourceId,
} as GeoCollectionEditDraft

function retainedState(overrides: Partial<EditorState> = {}) {
	return {
		activeWorkspaceId: workspace.id,
		activeGeoEditDraftId: draft.id,
		workspaces: { [workspace.id]: workspace },
		geoEditDrafts: { [draft.id]: draft },
		...overrides,
	} as EditorState
}

describe('mobile entity surface selection', () => {
	test('retained Dataset availability does not depend on Map Stack membership', () => {
		const state = retainedState({ mapStackEntries: {}, mapStackOrder: [] })

		expect(hasRetainedDatasetSurface(state)).toBe(true)
		expect(getRetainedDatasetSurfaceTarget(state)).toEqual({ workspace, draft })
	})

	test('rejects a workspace pointer to a draft owned by another source', () => {
		const mismatched = {
			...workspace,
			activeDraftId: 'foreign-draft',
		} as GeoEditorWorkspace
		const state = retainedState({
			activeGeoEditDraftId: null,
			workspaces: { [workspace.id]: mismatched },
			geoEditDrafts: {
				'foreign-draft': {
					id: 'foreign-draft',
					sourceId: 'dataset:other:map',
				} as GeoCollectionEditDraft,
			},
		})

		expect(getRetainedDatasetSurfaceTarget(state)).toBeNull()
	})

	test('rejects a missing exact workspace instead of falling back to the active target', () => {
		const state = retainedState()

		expect(getRetainedDatasetSurfaceTarget(state, 'workspace-missing')).toBeNull()
		expect(getRetainedDatasetSurfaceTarget(state, workspace.id)).toEqual({ workspace, draft })
	})

	test('plans route-neutral mobile opens without weakening Dataset visibility', () => {
		const secondWorkspace = {
			...workspace,
			id: 'workspace-2',
			sourceId: 'dataset:owner:second',
			activeDraftId: 'draft-2',
		} as GeoEditorWorkspace
		const secondDraft = {
			...draft,
			id: 'draft-2',
			sourceId: secondWorkspace.sourceId,
		} as GeoCollectionEditDraft
		const state = retainedState({
			workspaces: {
				[workspace.id]: workspace,
				[secondWorkspace.id]: secondWorkspace,
			},
			geoEditDrafts: {
				[draft.id]: draft,
				[secondDraft.id]: secondDraft,
			},
		})

		expect(resolveDraftEditorOpenPlan(state, undefined, true)).toEqual({
			workspaceId: workspace.id,
			switchWorkspace: false,
			navigateToEditRoute: false,
		})
		expect(resolveDraftEditorOpenPlan(state, secondWorkspace.id, true)).toEqual({
			workspaceId: secondWorkspace.id,
			switchWorkspace: true,
			navigateToEditRoute: false,
		})
		expect(resolveDraftEditorOpenPlan(state, secondWorkspace.id, false)?.navigateToEditRoute).toBe(
			true,
		)
	})

	test('fails an exact stale open plan without exposing the active Dataset', () => {
		const state = retainedState()

		expect(resolveDraftEditorOpenPlan(state, 'workspace-missing', true)).toBeNull()
	})

	test('keeps an available explicit choice and otherwise uses one shared fallback', () => {
		const available = {
			inspector: true,
			dataset: true,
			story: true,
			context: false,
			sighting: false,
			beacon: false,
		}

		expect(resolveMobileEntitySurface('story', available)).toBe('story')
		expect(resolveMobileEntitySurface('context', available)).toBe('dataset')
	})

	test('does not let an unselected transient flow steal the retained choice', () => {
		const available = {
			inspector: false,
			dataset: true,
			story: false,
			context: false,
			sighting: true,
			beacon: true,
		}

		expect(resolveMobileEntitySurface('dataset', available)).toBe('dataset')
		expect(resolveMobileEntitySurface(null, available)).toBe('dataset')
	})
})
