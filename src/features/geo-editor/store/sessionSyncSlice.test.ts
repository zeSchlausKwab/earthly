import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveChatTargetWorkspace, useChatStore } from '@/features/chat/store'
import { setCurrentPubkey } from '@/lib/wallet/currentUser'
import { createDefaultCollectionMeta } from '../utils'
import { useEditorStore, type GeoCollectionEditDraft, type GeoEditorWorkspace } from './index'
import { flushPersistedGeoCollectionDraftState } from './editorCoreSlice'
import { readPersistedGeoCollectionDraftState } from './draftSlice'
import { writeScopedStorage } from './persistence'
import { readPersistedWorkspaceState } from './workspaceSlice'

const DRAFT_STORAGE_KEY = 'earthly:geo-editor:collection-drafts:v1'
const WORKSPACE_STORAGE_KEY = 'earthly:geo-editor:workspaces:v1'
const ACCOUNT_A = 'a'.repeat(64)
const ACCOUNT_B = 'b'.repeat(64)
const ACCOUNT_C = 'c'.repeat(64)
const ACCOUNT_D = 'd'.repeat(64)

const globalWithWindow = globalThis as unknown as { window?: Window }
const originalWindow = globalWithWindow.window
const originalState = useEditorStore.getState()

let stored = new Map<string, string>()

function makeDraft(id: string, sourceId: string, updatedAt: number): GeoCollectionEditDraft {
	return {
		persistenceVersion: 2,
		id,
		sourceId,
		name: id,
		description: '',
		collectionMeta: createDefaultCollectionMeta(),
		features: [],
		selectedFeatureIds: [],
		publishChannel: { kind: 'public' },
		contextRefs: [],
		blobReferences: [],
		createdAt: 1,
		updatedAt,
	}
}

function makeWorkspace(
	id: string,
	sourceId: string,
	activeDraftId: string | null,
): GeoEditorWorkspace {
	return {
		id,
		sourceId,
		label: id,
		kind: 'scratch',
		datasetKey: null,
		baseRevisionId: null,
		activeDraftId,
		chatSessionId: null,
		createdAt: 1,
		updatedAt: 1,
	}
}

beforeEach(() => {
	stored = new Map()
	globalWithWindow.window = {
		localStorage: {
			get length() {
				return stored.size
			},
			getItem: (key: string) => stored.get(key) ?? null,
			key: (index: number) => [...stored.keys()][index] ?? null,
			setItem: (key: string, value: string) => {
				stored.set(key, value)
			},
			removeItem: (key: string) => {
				stored.delete(key)
			},
			clear: () => stored.clear(),
		} as Storage,
	} as Window
	setCurrentPubkey(null)
	useChatStore.getState().reset()
	useEditorStore.setState({ ...originalState, editor: null }, true)
})

afterEach(() => {
	flushPersistedGeoCollectionDraftState()
	useChatStore.getState().reset()
	setCurrentPubkey(null)
	useEditorStore.setState({ ...originalState, editor: null }, true)
	globalWithWindow.window = originalWindow
})

describe('geo editor account hydration', () => {
	test('keeps a Chat bound to a migrated legacy draft across a full rehydration', async () => {
		const legacyDraft = makeDraft('legacy-bound-draft', 'session:legacy-bound', 20)
		writeScopedStorage(
			DRAFT_STORAGE_KEY,
			{ drafts: { [legacyDraft.id]: legacyDraft }, activeDraftId: legacyDraft.id },
			ACCOUNT_D,
		)

		useEditorStore.getState().hydrateEditorSessionForPubkey(ACCOUNT_D)
		const firstEditorState = useEditorStore.getState()
		const migratedWorkspaceId = firstEditorState.activeWorkspaceId
		const chatId = useChatStore.getState().activeChatId
		if (!migratedWorkspaceId || !chatId) throw new Error('Expected migrated editor and Chat state')

		useChatStore.getState().setChatTargetWorkspace(chatId, migratedWorkspaceId)
		const persistedChat = stored.get('chat-store')
		if (!persistedChat) throw new Error('Expected the bound Chat to be persisted')

		// Recreate both stores from their browser persistence boundaries. Keep the
		// original Chat blob because reset represents the fresh in-memory page state.
		useChatStore.getState().reset()
		stored.set('chat-store', persistedChat)
		useEditorStore.getState().hydrateEditorSessionForPubkey(ACCOUNT_D)
		await useChatStore.persist.rehydrate()

		const rehydratedChatState = useChatStore.getState()
		const rehydratedEditorState = useEditorStore.getState()
		expect(rehydratedEditorState.activeWorkspaceId).toBe(migratedWorkspaceId)
		expect(
			resolveChatTargetWorkspace(
				chatId,
				rehydratedChatState.chatSessions,
				rehydratedEditorState.workspaces,
			)?.id,
		).toBe(migratedWorkspaceId)
	})

	test('flushes a queued re-identity to account A before hydrating account B', () => {
		const sourceBeforePublish = 'session:queued-publication'
		const sourceAfterPublish = `dataset:${ACCOUNT_A}:published`

		useEditorStore.getState().hydrateEditorSessionForPubkey(ACCOUNT_A)
		const draftId = useEditorStore.getState().createGeoEditDraft(sourceBeforePublish, {
			publishChannel: { kind: 'public' },
		})
		const workspaceId = useEditorStore.getState().createWorkspace({
			sourceId: sourceBeforePublish,
			label: 'Queued publication',
			kind: 'scratch',
			activeDraftId: draftId,
		})
		flushPersistedGeoCollectionDraftState()

		// This mirrors reference-publication reconciliation: the large draft snapshot
		// is queued while the small workspace record is persisted immediately.
		useEditorStore.getState().saveGeoEditDraft(draftId, { sourceId: sourceAfterPublish })
		useEditorStore.getState().updateWorkspace(workspaceId, {
			sourceId: sourceAfterPublish,
			kind: 'dataset',
			datasetKey: `${ACCOUNT_A}:published`,
		})

		useEditorStore.getState().hydrateEditorSessionForPubkey(ACCOUNT_B)
		// Force any surviving queued write to run now; it must not target account B.
		flushPersistedGeoCollectionDraftState()

		const accountADrafts = readPersistedGeoCollectionDraftState(ACCOUNT_A)
		const accountAWorkspaces = readPersistedWorkspaceState(ACCOUNT_A)
		const accountBDrafts = readPersistedGeoCollectionDraftState(ACCOUNT_B)

		expect(accountADrafts.drafts[draftId]?.sourceId).toBe(sourceAfterPublish)
		expect(accountAWorkspaces.workspaces[workspaceId]).toMatchObject({
			sourceId: sourceAfterPublish,
			activeDraftId: draftId,
		})
		expect(accountBDrafts.drafts).toEqual({})
		expect(useEditorStore.getState().geoEditDrafts).toEqual({})
	})

	test('repairs stale workspace pointers from hydrated drafts without changing draft identity', () => {
		const matchingOld = makeDraft('matching-old', 'session:matching', 10)
		const matchingNewest = makeDraft('matching-newest', 'session:matching', 30)
		const wrongSource = makeDraft('wrong-source', 'session:other', 40)
		const repairable = makeWorkspace('repairable', 'session:matching', wrongSource.id)
		const noMatch = makeWorkspace('no-match', 'session:missing', wrongSource.id)
		const drafts = {
			[matchingOld.id]: matchingOld,
			[matchingNewest.id]: matchingNewest,
			[wrongSource.id]: wrongSource,
		}
		const workspaces = {
			[repairable.id]: repairable,
			[noMatch.id]: noMatch,
		}

		writeScopedStorage(DRAFT_STORAGE_KEY, { drafts, activeDraftId: wrongSource.id }, ACCOUNT_C)
		writeScopedStorage(
			WORKSPACE_STORAGE_KEY,
			{ workspaces, activeWorkspaceId: repairable.id },
			ACCOUNT_C,
		)

		useEditorStore.getState().hydrateEditorSessionForPubkey(ACCOUNT_C)

		const hydrated = useEditorStore.getState()
		const recoveredWorkspace = Object.values(hydrated.workspaces).find(
			(workspace) => workspace.sourceId === wrongSource.sourceId,
		)
		expect(hydrated.workspaces[repairable.id]?.activeDraftId).toBe(matchingNewest.id)
		expect(hydrated.activeGeoEditDraftId).toBe(matchingNewest.id)
		expect(hydrated.workspaces[noMatch.id]?.activeDraftId).toBeNull()
		expect(hydrated.activeWorkspaceId).toBe(repairable.id)
		expect(recoveredWorkspace).toMatchObject({
			label: 'Recovered wrong-source',
			activeDraftId: wrongSource.id,
		})
		expect(hydrated.geoEditDrafts).toEqual(drafts)

		flushPersistedGeoCollectionDraftState()
		const persistedRepair = readPersistedWorkspaceState(ACCOUNT_C)
		const persistedDraftRepair = readPersistedGeoCollectionDraftState(ACCOUNT_C)
		expect(persistedRepair.workspaces[repairable.id]?.activeDraftId).toBe(matchingNewest.id)
		expect(persistedRepair.workspaces[noMatch.id]?.activeDraftId).toBeNull()
		expect(
			Object.values(persistedRepair.workspaces).find(
				(workspace) => workspace.sourceId === wrongSource.sourceId,
			)?.activeDraftId,
		).toBe(wrongSource.id)
		expect(persistedDraftRepair.activeDraftId).toBe(matchingNewest.id)
	})
})
