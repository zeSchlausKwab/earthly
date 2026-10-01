import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useChatStore } from '@/features/chat/store'
import { accounts } from '@/lib/nostr'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { readGroupEditorDraft, writeGroupEditorDraft } from '@/features/groups/editorDraft'
import { getAtlasEditorTarget, resetAtlasEditorOpenRequests } from '@/features/groups/atlasEditorBridge'
import { createDefaultCollectionMeta } from './utils'
import { useEditorStore } from './store'
import {
	discardSavedDraft,
	registerMapDraftActions,
	registerStoryDraftDiscard,
	registerAtlasDraftDiscard,
	openSavedDraft,
} from './draftActions'

const originalChat = useChatStore.getState()
const originalEditor = useEditorStore.getState()
const previousWindow = globalThis.window
const storage = new Map<string, string>()
let unregister: (() => void) | undefined

beforeEach(() => {
	storage.clear()
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
			addEventListener() {},
			removeEventListener() {},
			setTimeout,
			clearTimeout,
		},
	})
	useChatStore.setState({ chatSessions: [], activeChatId: null, runningChatId: null })
	useEditorStore.setState({ workspaces: {}, geoEditDrafts: {}, editor: null })
})
afterEach(() => {
	resetAtlasEditorOpenRequests()
	unregister?.()
	unregister = undefined
	useChatStore.setState(originalChat, true)
	useEditorStore.setState(originalEditor, true)
	if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: previousWindow })
})

test('independent Atlas drafts open and discard only their exact slot and grants', async () => {
	const draft = { name: 'Atlas', description: '', curatedReferences: [], image: '', governance: 'closed' as const, schemaMode: 'builder' as const, allowedGeometryTypes: [], rows: [], advancedJson: '{}', sampleJson: '{}' }
	const target = { id: 'atlas:thread-atlas:one', kind: 'atlas' as const, draftKey: 'thread-atlas:one', title: 'Atlas', intent: 'create' as const }
	writeGroupEditorDraft(target.draftKey, draft)
	writeGroupEditorDraft('thread-atlas:two', { ...draft, name: 'Keep sibling' })
	useChatStore.getState().createChat()
	const chatId = useChatStore.getState().activeChatId!
	useChatStore.getState().setWorkingSet(chatId, [target])
	await openSavedDraft(target)
	expect(getAtlasEditorTarget()?.draftKey).toBe(target.draftKey)
	let suppressed = false
	unregister = registerAtlasDraftDiscard(target.draftKey, () => { suppressed = true })
	await discardSavedDraft(target, accounts.active?.pubkey)
	expect(suppressed).toBe(true)
	expect(readGroupEditorDraft(target.draftKey)).toBeNull()
	expect(readGroupEditorDraft('thread-atlas:two')?.name).toBe('Keep sibling')
	expect(getAtlasEditorTarget()).toBeNull()
	expect(useChatStore.getState().chatSessions.find((chat) => chat.id === chatId)?.workingSet).toEqual([])
})

test('discarding a Story suppresses its mounted form and revokes every grant, not references', async () => {
	const target = {
		id: 'story:thread-story:test',
		kind: 'story' as const,
		draftKey: 'thread-story:test',
		title: 'Story',
		intent: 'create' as const,
	}
	writeStoryDraft(target.draftKey, { title: 'Story', content: 'Keep this until confirmed.' })
	for (let index = 0; index < 2; index++) {
		useChatStore.getState().createChat()
		const id = useChatStore.getState().activeChatId!
		useChatStore.getState().setWorkingSet(id, [target])
		useChatStore
			.getState()
			.addReferenceToChat(id, { id: 'foreign', type: 'dataset', name: 'Foreign Map' })
	}
	let closed = false
	unregister = registerStoryDraftDiscard(target.draftKey, () => {
		closed = true
		expect(readStoryDraft(target.draftKey)).not.toBeNull()
	})
	await discardSavedDraft(target, accounts.active?.pubkey)
	expect(closed).toBe(true)
	expect(readStoryDraft(target.draftKey)).toBeNull()
	for (const chat of useChatStore.getState().chatSessions) {
		expect(chat.workingSet).toEqual([])
		expect(chat.references).toHaveLength(1)
	}
})

test('a running AI or changed account cannot discard a draft', async () => {
	const target = { kind: 'story' as const, draftKey: 'thread-story:test', title: 'Story' }
	writeStoryDraft(target.draftKey, { title: 'Story' })
	useChatStore.setState({ runningChatId: 'running' })
	await expect(discardSavedDraft(target, accounts.active?.pubkey)).rejects.toThrow('Wait for AI')
	useChatStore.setState({ runningChatId: null })
	await expect(discardSavedDraft(target, 'another-account')).rejects.toThrow('account changed')
	expect(readStoryDraft(target.draftKey)?.title).toBe('Story')
})

test('a Map switched while confirmation was open cannot delete a different draft', async () => {
	const store = useEditorStore.getState()
	const draftId = store.createGeoEditDraft(
		'session:test',
		{
			collectionMeta: createDefaultCollectionMeta(),
			features: [],
			publishChannel: { kind: 'public' },
		},
		{ activate: false },
	)
	const workspaceId = store.createWorkspace({
		sourceId: 'session:test',
		label: 'Map',
		kind: 'scratch',
		activeDraftId: draftId,
		activate: false,
	})
	let deleted = false
	unregister = registerMapDraftActions({
		view: async () => {},
		discard: () => {
			deleted = true
		},
	})
	await expect(
		discardSavedDraft(
			{ kind: 'dataset', title: 'Map', workspaceId, draftId: 'previous-draft' },
			accounts.active?.pubkey,
		),
	).rejects.toThrow('different draft')
	expect(deleted).toBe(false)
})
