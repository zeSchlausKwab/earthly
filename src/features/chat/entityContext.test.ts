import { afterEach, beforeEach, expect, test } from 'bun:test'
import { ReadonlyAccount } from 'applesauce-accounts/accounts'
import { accounts, eventStore } from '@/lib/nostr'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import {
	transferFromTarget,
	startEntityDrag,
	readEntityDrop,
	endEntityDrag,
	ENTITY_TRANSFER_MIME,
} from '@/components/entity-list/entityTransfer'
import { useChatStore } from './store'
import { captureThreadReferences, mapWorkTarget } from './workingSet'
import { setConversationEntityRole, referenceFromTransfer } from './entityContext'
import { nip19, finalizeEvent } from 'nostr-tools'
import { featureToSearchResult } from '@/components/entity-search/types'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'

const initialEditor = useEditorStore.getState()
const initialChat = useChatStore.getState()
const initialAccount = accounts.active
const previousWindow = globalThis.window
let chatId: string
let workspaceId: string
beforeEach(() => {
	const storage = new Map<string, string>()
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
	accounts.active$.next(ReadonlyAccount.fromPubkey('a'.repeat(64)))
	useEditorStore.setState({
		workspaces: {},
		geoEditDrafts: {},
		activeWorkspaceId: null,
		activeGeoEditDraftId: null,
		editor: null,
		features: [],
	})
	useChatStore.setState({
		chatSessions: [],
		activeChatId: null,
		runningChatId: null,
		references: [],
	})
	useChatStore.getState().createChat()
	chatId = useChatStore.getState().activeChatId!
	const state = useEditorStore.getState()
	const draftId = state.createGeoEditDraft(
		'session:source',
		{
			collectionMeta: { ...createDefaultCollectionMeta(), name: 'Survey' },
			features: [
				{
					type: 'Feature',
					id: 'one',
					properties: {},
					geometry: { type: 'Point', coordinates: [0, 0] },
				},
				{
					type: 'Feature',
					id: 'two',
					properties: {},
					geometry: { type: 'Point', coordinates: [1, 1] },
				},
			],
			publishChannel: { kind: 'public' },
			contextRefs: [],
			blobReferences: [],
		},
		{ activate: false },
	)
	workspaceId = state.createWorkspace({
		sourceId: 'session:source',
		kind: 'scratch',
		label: 'Survey',
		activeDraftId: draftId,
		activate: false,
	})
})
afterEach(() => {
	endEntityDrag()
	useEditorStore.setState(initialEditor, true)
	useChatStore.setState(initialChat, true)
	accounts.active$.next(initialAccount)
	if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: previousWindow })
})
const chat = () => useChatStore.getState().chatSessions.find((item) => item.id === chatId)!
const item = () => ({
	id: 'map-source',
	type: 'dataset' as const,
	name: 'Survey',
	localWorkspaceId: workspaceId,
})

test('search adapters preserve whole-map references and encoded feature selectors', () => {
	const address = nip19.naddrEncode({ kind: 37515, pubkey: 'a'.repeat(64), identifier: 'survey' })
	expect(
		featureToSearchResult({ id: 'map', name: 'Survey', address, entityType: 'dataset' }).type,
	).toBe('dataset')
	const reference = referenceFromTransfer({
		id: 'point',
		name: 'Point',
		type: 'feature',
		address: `${address}#one`,
	})
	expect(reference.featureId).toBe('one')
	expect(reference.address).toBe(address)
})

test('references do not grant writes or activate the map; promotion and demotion keep the saved draft', async () => {
	await setConversationEntityRole(chatId, item(), 'reference')
	expect(chat().workingSet ?? []).toHaveLength(0)
	expect(chat().references).toHaveLength(1)
	await setConversationEntityRole(chatId, item(), 'edit')
	expect(chat().workingSet).toHaveLength(1)
	expect(chat().references).toHaveLength(0)
	await setConversationEntityRole(chatId, transferFromTarget(chat().workingSet![0]!), 'reference')
	expect(chat().workingSet).toHaveLength(0)
	expect(chat().references).toHaveLength(1)
	expect(mapWorkTarget(workspaceId)).not.toBeNull()
	expect(useEditorStore.getState().activeWorkspaceId).toBeNull()
	expect(useEditorStore.getState().features).toEqual([])
})

test('feature permissions never widen when transferring between sections', async () => {
	const feature = { ...item(), type: 'feature' as const, featureId: 'one' }
	await setConversationEntityRole(chatId, feature, 'reference')
	expect(captureThreadReferences(chat().references!)[0]!.localSnapshot!.features).toHaveLength(1)
	await setConversationEntityRole(chatId, feature, 'edit')
	expect(chat().workingSet![0]!.featureIds).toEqual(['one'])
	await setConversationEntityRole(chatId, transferFromTarget(chat().workingSet![0]!), 'edit')
	expect(chat().workingSet![0]!.featureIds).toEqual(['one'])
	await setConversationEntityRole(chatId, transferFromTarget(chat().workingSet![0]!), 'reference')
	expect(chat().workingSet).toHaveLength(0)
	expect(chat().references![0]!.featureId).toBe('one')
	await expect(
		setConversationEntityRole(chatId, { ...feature, featureId: 'gone' }, 'edit'),
	).rejects.toThrow('no longer')
})

test('local Story reference captures the narrative immutably without granting edits', async () => {
	writeStoryDraft('thread-story:source', { title: 'Story', content: 'Original text', updatedAt: 1 })
	await setConversationEntityRole(
		chatId,
		{ id: 'story-source', type: 'story', name: 'Story', localStoryDraftKey: 'thread-story:source' },
		'reference',
	)
	const captured = captureThreadReferences(chat().references!)
	writeStoryDraft('thread-story:source', { title: 'Story', content: 'Changed text', updatedAt: 2 })
	expect(captured[0]!.localStorySnapshot!.content).toBe('Original text')
	expect(chat().workingSet ?? []).toHaveLength(0)
	expect(readStoryDraft('thread-story:source')!.content).toBe('Changed text')
})

test('profile references are immutable read-only snapshots', async () => {
	const profile = finalizeEvent(
		{ kind: 0, created_at: 1720000000, tags: [], content: JSON.stringify({ name: 'Surveyor' }) },
		new Uint8Array(32).fill(9),
	)
	eventStore.add(profile)
	await setConversationEntityRole(
		chatId,
		{ id: profile.pubkey, type: 'person', name: 'Surveyor', pubkey: profile.pubkey },
		'reference',
	)
	const snapshot = captureThreadReferences(chat().references!)[0]!
	expect(snapshot.profileSnapshot).toEqual({ pubkey: profile.pubkey, content: profile.content })
	expect(chat().workingSet).toEqual([])
})

test('Stories with the same identifier but different authors never share edit access', async () => {
	const foreign = finalizeEvent(
		{
			kind: 37520,
			created_at: 1720000000,
			tags: [
				['d', 'colliding-story'],
				['title', 'Foreign Story'],
			],
			content: JSON.stringify({
				modelVersion: MODEL_VERSION,
				title: 'Foreign Story',
				content: 'Foreign narrative',
			}),
		},
		new Uint8Array(32).fill(7),
	)
	eventStore.add(foreign)
	writeStoryDraft('colliding-story', {
		title: 'Keep my Story',
		content: 'My narrative',
		publication: {
			reference: nip19.naddrEncode({
				kind: 37520,
				pubkey: accounts.active!.pubkey,
				identifier: 'colliding-story',
			}),
			eventId: 'c'.repeat(64),
			fingerprint: 'baseline',
		},
	})
	await expect(
		setConversationEntityRole(
			chatId,
			{
				id: foreign.id,
				type: 'story',
				name: 'Foreign Story',
				address: nip19.naddrEncode({
					kind: foreign.kind,
					pubkey: foreign.pubkey,
					identifier: 'colliding-story',
				}),
			},
			'edit',
		),
	).rejects.toThrow('different Story')
	expect(readStoryDraft('colliding-story')!.content).toBe('My narrative')
	expect(chat().workingSet ?? []).toEqual([])
})

test('cannot change a running conversation or use an unreadable source', async () => {
	useChatStore.setState({ runningChatId: chatId })
	await expect(setConversationEntityRole(chatId, item(), 'edit')).rejects.toThrow('Stop')
	useChatStore.setState({ runningChatId: null })
	await expect(
		setConversationEntityRole(
			chatId,
			{ id: 'unknown', type: 'dataset', name: 'Unknown' },
			'reference',
		),
	).rejects.toThrow('readable')
	expect(chat().workingSet ?? []).toHaveLength(0)
})

test('drops must carry an active same-document token, never arbitrary JSON', () => {
	const payload = new Map<string, string>()
	const data = {
		setData: (key: string, value: string) => payload.set(key, value),
		getData: (key: string) => payload.get(key) ?? '',
	} as unknown as DataTransfer
	startEntityDrag(data, item())
	expect(readEntityDrop(data)).toEqual(item())
	payload.set(ENTITY_TRANSFER_MIME, JSON.stringify(item()))
	expect(readEntityDrop(data)).toBeNull()
	endEntityDrag()
	expect(readEntityDrop(data)).toBeNull()
})
