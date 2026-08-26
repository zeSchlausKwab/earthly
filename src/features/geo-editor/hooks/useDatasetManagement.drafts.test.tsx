import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { GeoEditor, EditorFeature } from '../core'
import type { GeoCollectionEditDraft, GeoEditorWorkspace } from '../store'
import type { GeoDataset } from '@/lib/nostr/geo-event'

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let useDatasetManagement: typeof import('./useDatasetManagement').useDatasetManagement
let useEditorStore: typeof import('../store').useEditorStore
let initialEditorState: ReturnType<typeof import('../store').useEditorStore.getState>

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []
const chatCalls: string[] = []
const chatState = {
	activeChatId: null as string | null,
	createChat() {
		chatCalls.push('create')
		this.activeChatId = 'test-chat'
	},
	switchChat(chatId: string) {
		chatCalls.push(`switch:${chatId}`)
	},
	deleteChat(chatId: string) {
		chatCalls.push(`delete:${chatId}`)
	},
}

mock.module('@/features/chat', () => ({
	useChatStore: { getState: () => chatState },
}))
mock.module('@/platform/registry', () => ({
	getAccountSessionService: async () => null,
	getLocalBlobRevision: () => 0,
	getLocalNodeService: async () => null,
	getPublishOutboxService: async () => null,
	getSavedRegionService: async () => null,
	notifyPublishOutboxChanged: () => {},
}))

function point(id: string, longitude: number): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [longitude, 48] },
		properties: { name: id },
	}
}

function draft(id: string, feature: EditorFeature, updatedAt: number): GeoCollectionEditDraft {
	return {
		persistenceVersion: 2,
		id,
		sourceId: 'session:private-survey',
		name: id,
		description: '',
		collectionMeta: {
			name: id,
			description: '',
			color: '#1d4ed8',
			customProperties: {},
		},
		features: [feature],
		selectedFeatureIds: [],
		publishChannel: { kind: 'private-group', id: 'group-1' },
		contextRefs: [],
		blobReferences: [],
		createdAt: updatedAt,
		updatedAt,
	}
}

function workspace(
	activeDraftId: string | null,
	datasetKey: string | null = null,
	chatSessionId: string | null = null,
): GeoEditorWorkspace {
	return {
		id: 'workspace-1',
		sourceId: 'session:private-survey',
		label: 'Private survey',
		kind: 'scratch',
		datasetKey,
		activeDraftId,
		chatSessionId,
		createdAt: 1,
		updatedAt: 1,
	}
}

async function flush(action?: () => void | Promise<void>) {
	await act(async () => {
		await action?.()
		await Promise.resolve()
	})
}

async function mountHook(geoEvents: GeoDataset[] = []) {
	let latest: ReturnType<typeof useDatasetManagement> | null = null
	function Probe(): ReactNode {
		latest = useDatasetManagement({ current: null }, geoEvents)
		return null
	}
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mountedRoots.push({ root, container })
	await flush(() => root.render(createElement(Probe)))
	return () => {
		if (!latest) throw new Error('Dataset-management hook did not render')
		return latest
	}
}

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>')
	const storage = new Map<string, string>()
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
			clear: () => storage.clear(),
		},
	})
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		MutationObserver: window.MutationObserver,
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true

	const react = await import('react')
	act = react.act
	createElement = react.createElement
	;({ createRoot } = await import('react-dom/client'))
	;({ useDatasetManagement } = await import('./useDatasetManagement'))
	;({ useEditorStore } = await import('../store'))
	initialEditorState = useEditorStore.getState()
})

beforeEach(() => {
	chatCalls.length = 0
	useEditorStore.setState(initialEditorState, true)
})

afterEach(async () => {
	await flush(() => {
		for (const { root } of mountedRoots.splice(0)) root.unmount()
	})
	for (const container of Array.from(document.body.children)) container.remove()
})

describe('local draft transitions', () => {
	test('creates an AI New map as retained work without changing the visible Dataset or Inspector', async () => {
		const visibleFeature = point('visible-feature', 16.37)
		const visibleDraft = draft('visible-draft', visibleFeature, 1)
		const visibleDataset = { id: 'visible-dataset' } as GeoDataset
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			features: [visibleFeature],
			geoEditDrafts: { [visibleDraft.id]: visibleDraft },
			activeGeoEditDraftId: visibleDraft.id,
			workspaces: { 'workspace-1': workspace(visibleDraft.id) },
			activeWorkspaceId: 'workspace-1',
			viewMode: 'view',
			stance: 'focus',
			viewDataset: visibleDataset,
			inspectionSubject: { kind: 'dataset', entity: visibleDataset },
		})
		const inspectionSubject = useEditorStore.getState().inspectionSubject
		const current = await mountHook()
		let newWorkspaceId: string | null | undefined

		await flush(() => {
			newWorkspaceId = current().startNewDataset({
				publishChannel: { kind: 'private-group', id: 'group-new' },
				chatSessionId: 'chat-origin',
				activate: false,
			})
		})

		const state = useEditorStore.getState()
		expect(typeof newWorkspaceId).toBe('string')
		const retainedWorkspace = state.workspaces[newWorkspaceId as string]
		const retainedDraft = retainedWorkspace?.activeDraftId
			? state.geoEditDrafts[retainedWorkspace.activeDraftId]
			: null
		expect(retainedWorkspace?.chatSessionId).toBe('chat-origin')
		expect(retainedDraft?.features).toEqual([])
		expect(retainedDraft?.publishChannel).toEqual({
			kind: 'private-group',
			id: 'group-new',
		})
		expect(state.activeWorkspaceId).toBe('workspace-1')
		expect(state.activeGeoEditDraftId).toBe(visibleDraft.id)
		expect(state.features).toEqual([visibleFeature])
		expect(state.viewMode).toBe('view')
		expect(state.stance).toBe('focus')
		expect(state.viewDataset).toBe(visibleDataset)
		expect(state.inspectionSubject).toBe(inspectionSubject)
	})

	test('editing a stacked dataset replaces its published map row with the draft row', async () => {
		const feature = point('feature-a', 14)
		const dataset = {
			id: 'event-1',
			pubkey: 'owner',
			datasetId: 'dataset-1',
			dTag: 'dataset-1',
			hashtags: [],
			contextReferences: [],
			blobReferences: [],
			featureCollection: {
				type: 'FeatureCollection',
				name: 'Callout dataset',
				features: [feature],
			},
			event: { id: 'event-1', pubkey: 'owner', kind: 37515, created_at: 1, tags: [], content: '' },
		} as unknown as GeoDataset
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({ editor, features: [] })
		useEditorStore.getState().addMapStackEntry({
			entityType: 'dataset',
			entityKey: 'owner:dataset-1',
			title: 'Callout dataset',
			source: 'route',
			visible: true,
			pinned: false,
		})
		const current = await mountHook([dataset])

		await flush(() => current().loadDatasetForEditing(dataset))

		const state = useEditorStore.getState()
		expect(state.mapStackEntries['dataset:owner:dataset-1']).toBeUndefined()
		expect(state.mapStackEntries['draft:active']?.entityType).toBe('draft')
		expect(state.mapStackOrder).toContain('draft:active')
		expect(state.features).toHaveLength(1)
	})

	test('loading a revision changes the persisted channel and the actual editor geometry together', async () => {
		const featureA = point('feature-a', 14)
		const featureB = point('feature-b', 15)
		const draftA = draft('draft-a', featureA, 1)
		const draftB = draft('draft-b', featureB, 2)
		let editorFeatures = [featureA]
		const editor = {
			setFeatures: (features: EditorFeature[]) => {
				editorFeatures = features
			},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor

		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA, [draftB.id]: draftB },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id, 'owner:dataset-1') },
			activeWorkspaceId: 'workspace-1',
		})
		const current = await mountHook()

		await flush(() => current().loadDraftInWorkspace('workspace-1', draftB.id))

		expect(editorFeatures).toEqual([featureB])
		expect(useEditorStore.getState().features).toEqual([featureB])
		expect(useEditorStore.getState().activeGeoEditDraftId).toBe(draftB.id)
		expect(useEditorStore.getState().workspaces['workspace-1']?.activeDraftId).toBe(draftB.id)
		expect(useEditorStore.getState().isDirty).toBe(true)
		expect(useEditorStore.getState().geoEditDrafts[draftB.id]?.publishChannel).toEqual({
			kind: 'private-group',
			id: 'group-1',
		})
	})

	test('loading saved work never switches or creates a conversation', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			geoEditDrafts: { [draftA.id]: draftA },
			workspaces: { 'workspace-1': workspace(draftA.id, null, 'legacy-chat') },
		})
		const current = await mountHook()

		await flush(() => current().loadDraftInWorkspace('workspace-1', draftA.id))

		expect(chatCalls).toEqual([])
		expect(useEditorStore.getState().workspaces['workspace-1']?.chatSessionId).toBe('legacy-chat')
	})

	test('exact target activation leaves Map Stack visibility unchanged', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			geoEditDrafts: { [draftA.id]: draftA },
			workspaces: { 'workspace-1': workspace(draftA.id) },
			activeWorkspaceId: null,
			activeGeoEditDraftId: null,
		})
		useEditorStore.getState().addMapStackEntry({
			id: 'dataset:other',
			entityType: 'dataset',
			entityKey: 'other',
			title: 'Other visible Dataset',
			source: 'manual',
			visible: true,
			pinned: false,
		})
		const current = await mountHook()

		await flush(() => current().switchToWorkspace('workspace-1', { syncMapStackVisibility: false }))

		const state = useEditorStore.getState()
		expect(state.activeWorkspaceId).toBe('workspace-1')
		expect(state.activeGeoEditDraftId).toBe(draftA.id)
		expect(state.mapStackOrder).toEqual(['dataset:other'])
		expect(state.mapStackEntries['draft:active']).toBeUndefined()
	})

	test('deleting the active revision selects a sibling without manufacturing a public draft', async () => {
		const featureA = point('feature-a', 14)
		const featureB = point('feature-b', 15)
		const draftA = draft('draft-a', featureA, 2)
		const draftB = draft('draft-b', featureB, 1)
		let editorFeatures = [featureA]
		const editor = {
			setFeatures: (features: EditorFeature[]) => {
				editorFeatures = features
			},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor

		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA, [draftB.id]: draftB },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id) },
			activeWorkspaceId: 'workspace-1',
		})
		const current = await mountHook()

		await flush(() => current().deleteDraftInWorkspace('workspace-1', draftA.id))

		const state = useEditorStore.getState()
		expect(Object.keys(state.geoEditDrafts)).toEqual([draftB.id])
		expect(state.workspaces['workspace-1']?.activeDraftId).toBe(draftB.id)
		expect(state.activeGeoEditDraftId).toBe(draftB.id)
		expect(editorFeatures).toEqual([featureB])
		expect(state.geoEditDrafts[draftB.id]?.publishChannel).toEqual({
			kind: 'private-group',
			id: 'group-1',
		})
	})

	test('deleting the last revision ends editing and leaves the saved-work index empty', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		let editorFeatures = [featureA]
		const editor = {
			setFeatures: (features: EditorFeature[]) => {
				editorFeatures = features
			},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor

		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id) },
			activeWorkspaceId: 'workspace-1',
		})
		const current = await mountHook()

		await flush(() => current().deleteDraftInWorkspace('workspace-1', draftA.id))

		const state = useEditorStore.getState()
		expect(state.geoEditDrafts).toEqual({})
		expect(state.workspaces['workspace-1']?.activeDraftId).toBeNull()
		expect(state.activeGeoEditDraftId).toBeNull()
		expect(state.activeWorkspaceId).toBeNull()
		expect(editorFeatures).toEqual([])
	})

	test('deleting saved work never deletes its legacy conversation', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id, null, 'legacy-chat') },
			activeWorkspaceId: 'workspace-1',
		})
		const current = await mountHook()

		await flush(() => current().deleteWorkspace('workspace-1'))

		expect(chatCalls).toEqual([])
		expect(useEditorStore.getState().workspaces['workspace-1']).toBeUndefined()
	})

	test('an empty saved-work index cannot create a draft without an explicit channel', async () => {
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			features: [],
			geoEditDrafts: {},
			activeGeoEditDraftId: null,
			workspaces: { 'workspace-1': workspace(null) },
			activeWorkspaceId: 'workspace-1',
			publishError: null,
		})
		const current = await mountHook()

		await flush(() => current().createDraftInWorkspace('workspace-1'))

		expect(useEditorStore.getState().geoEditDrafts).toEqual({})
		expect(useEditorStore.getState().workspaces['workspace-1']?.activeDraftId).toBeNull()
		expect(useEditorStore.getState().publishError).toContain('destination')
	})

	test('a new revision inherits the existing private channel instead of the open route', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id) },
			activeWorkspaceId: 'workspace-1',
		})
		const current = await mountHook()

		await flush(() =>
			current().createDraftInWorkspace('workspace-1', { publishChannel: { kind: 'public' } }),
		)

		const state = useEditorStore.getState()
		const newDraft = Object.values(state.geoEditDrafts).find(
			(candidate) => candidate.id !== draftA.id,
		)
		expect(newDraft?.publishChannel).toEqual({ kind: 'private-group', id: 'group-1' })
		expect(state.workspaces['workspace-1']?.activeDraftId).toBe(newDraft?.id)
	})

	test('does not create an empty update revision while a scoped source is unresolved', async () => {
		const featureA = point('feature-a', 14)
		const draftA = draft('draft-a', featureA, 1)
		const editor = {
			setFeatures: (_features: EditorFeature[]) => {},
			setInteractionEnabled: (_enabled: boolean) => {},
		} as unknown as GeoEditor
		useEditorStore.setState({
			editor,
			features: [featureA],
			geoEditDrafts: { [draftA.id]: draftA },
			activeGeoEditDraftId: draftA.id,
			workspaces: { 'workspace-1': workspace(draftA.id, 'owner:dataset-1') },
			activeWorkspaceId: 'workspace-1',
			publishError: null,
		})
		const current = await mountHook()

		await flush(() =>
			current().createDraftInWorkspace('workspace-1', {
				publishChannel: { kind: 'private-group', id: 'group-1' },
			}),
		)

		const state = useEditorStore.getState()
		expect(Object.keys(state.geoEditDrafts)).toEqual([draftA.id])
		expect(state.workspaces['workspace-1']?.activeDraftId).toBe(draftA.id)
		expect(state.features).toEqual([featureA])
		expect(state.publishError).toContain('restore the original dataset')
	})
})
