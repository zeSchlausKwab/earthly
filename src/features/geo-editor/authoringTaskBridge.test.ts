import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	ensureDatasetDraftForMutation,
	registerDatasetDraftEnsurer,
	startDatasetDraftForActiveChat,
} from './authoringTaskBridge'
import { useEditorStore } from './store'

let unregister: (() => void) | null = null
const initialEditorState = useEditorStore.getState()

afterEach(() => {
	unregister?.()
	unregister = null
	useEditorStore.setState(initialEditorState, true)
})

describe('Dataset authoring target intent', () => {
	test('ordinary mutations reuse the owned target while New map explicitly forces a fresh draft', async () => {
		const ensure = mock(() => {})
		unregister = registerDatasetDraftEnsurer(ensure)

		await ensureDatasetDraftForMutation()
		await startDatasetDraftForActiveChat('chat-test')

		expect(ensure).toHaveBeenNthCalledWith(1)
		expect(ensure).toHaveBeenNthCalledWith(2, {
			forceNew: true,
			activate: false,
			chatSessionId: 'chat-test',
		})
	})

	test('New map binds a retained draft without stealing the visible Dataset or Inspector', async () => {
		const visibleDataset = { id: 'visible-dataset' } as GeoDataset
		const visibleFeature = {
			type: 'Feature' as const,
			id: 'visible-feature',
			geometry: { type: 'Point' as const, coordinates: [16.37, 48.21] },
			properties: {},
		}
		useEditorStore.setState({
			activeWorkspaceId: 'visible-workspace',
			activeGeoEditDraftId: 'visible-draft',
			features: [visibleFeature],
			viewMode: 'view',
			stance: 'focus',
			viewDataset: visibleDataset,
			inspectionSubject: { kind: 'dataset', entity: visibleDataset },
			workspaces: {
				'visible-workspace': {
					id: 'visible-workspace',
					sourceId: 'dataset:visible',
					label: 'Visible dataset',
					kind: 'dataset',
					datasetKey: 'author:visible',
					activeDraftId: 'visible-draft',
					chatSessionId: null,
					createdAt: 1,
					updatedAt: 1,
				},
			},
		})
		const inspectionSubject = useEditorStore.getState().inspectionSubject
		unregister = registerDatasetDraftEnsurer((request) => {
			expect(request).toMatchObject({ forceNew: true, activate: false })
			const state = useEditorStore.getState()
			const draftId = state.createGeoEditDraft(
				'scratch:new',
				{
					features: [],
					selectedFeatureIds: [],
					publishChannel: { kind: 'public' },
				},
				{ activate: false },
			)
			return state.createWorkspace({
				sourceId: 'scratch:new',
				label: 'New map',
				kind: 'scratch',
				activeDraftId: draftId,
				activate: false,
			})
		})

		const newWorkspaceId = await startDatasetDraftForActiveChat('chat-origin')

		const state = useEditorStore.getState()
		expect(newWorkspaceId).not.toBeNull()
		expect(state.workspaces[newWorkspaceId as string]?.chatSessionId).toBe('chat-origin')
		expect(state.activeWorkspaceId).toBe('visible-workspace')
		expect(state.activeGeoEditDraftId).toBe('visible-draft')
		expect(state.features).toEqual([visibleFeature])
		expect(state.viewMode).toBe('view')
		expect(state.stance).toBe('focus')
		expect(state.viewDataset).toBe(visibleDataset)
		expect(state.inspectionSubject).toBe(inspectionSubject)
	})
})
