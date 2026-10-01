import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { useChatStore } from '@/features/chat/store'
import { useEditorStore } from '@/features/geo-editor/store'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { registry } from '@/features/chat/tools/registry'
import { readGroupEditorDraft } from '@/features/groups/editorDraft'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import { canonicalDocumentReference } from '@/features/chat/tools/document-authoring'
import { registerDocumentDraftForm } from '@/features/chat/tools/documentDraftForms'
import { createBrowserToolService } from './service'
import { useWebMcpStore } from './state'
import {
	clearDocumentReviews,
	getDocumentReviews,
	resolveDocumentReview,
	subscribeDocumentReviews,
	undoDocumentReview,
} from './documentReviews'
import type { BrowserTool } from './platform'
import { finalizeEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

const backing = new Map<string, string>()
const originalEditor = useEditorStore.getState()
const originalChat = useChatStore.getState()
const originalBridge = useWebMcpStore.getState()
let priorWindow: unknown
let controller: AbortController
let tools: BrowserTool[]
beforeAll(() => {
	priorWindow = globalThis.window
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => backing.get(key) ?? null,
				setItem: (key: string, value: string) => backing.set(key, value),
				removeItem: (key: string) => backing.delete(key),
			},
		},
	})
})
afterAll(() => {
	if (priorWindow === undefined) delete (globalThis as Record<string, unknown>).window
	else Object.assign(globalThis, { window: priorWindow })
})
beforeEach(() => {
	backing.clear()
	clearDocumentReviews()
	useEditorStore.setState({ workspaces: {}, geoEditDrafts: {}, editor: null })
	useChatStore.setState({ isStreaming: false, safetyLevel: 3 })
	setSafetyLevelProvider(() => useChatStore.getState().safetyLevel)
	useWebMcpStore.setState({ enabled: true, externalQueriesEnabled: false, activities: [] })
	controller = new AbortController()
	tools = createBrowserToolService(controller.signal)
})
afterEach(() => {
	controller.abort()
	clearDocumentReviews()
	useEditorStore.setState(originalEditor, true)
	useChatStore.setState(originalChat, true)
	useWebMcpStore.setState(originalBridge, true)
})
async function call(name: string, args: Record<string, unknown> = {}) {
	const tool = tools.find((tool) => tool.name === `earthly_${name}`)!
	return (await tool.execute(args)) as any
}
async function createStory(title = 'A retained Story') {
	const inventory = await call('list_local_drafts')
	return call('write_story_draft', {
		createNew: true,
		creationToken: inventory.creationToken,
		title,
		markdown: 'The narrative.',
	})
}
function pending() {
	return new Promise<string>((resolve) => {
		const check = () => {
			const entry = getDocumentReviews().find((entry) => entry.status === 'pending')
			if (entry) {
				stop()
				resolve(entry.id)
			}
		}
		const stop = subscribeDocumentReviews(check)
		check()
	})
}

test('discovers and creates distinct documents without requiring an open Map', async () => {
	const first = await createStory()
	const second = await createStory()
	expect(first.ok).toBe(true)
	expect(second.draftKey).not.toBe(first.draftKey)
	expect(getDocumentReviews()).toHaveLength(2)
	const list = await call('list_local_drafts')
	const atlas = await call('write_atlas_draft', {
		createNew: true,
		creationToken: list.creationToken,
		name: 'A companion Atlas',
		description: 'A curated overview.',
		curatedReferences: [first.reference],
	})
	expect(atlas.ok).toBe(true)
	expect(readGroupEditorDraft(atlas.draftKey, null)?.curatedReferences).toEqual([first.reference])
	expect((await call('list_local_drafts')).drafts).toHaveLength(3)
	expect(await call('write_atlas_draft', { createNew: true, name: 'No token' })).toMatchObject({
		ok: false,
		code: 'creation_token_required',
	})
})

test('verified public reads grant exact document sources without widening feature-only access', async () => {
	const secret = new Uint8Array(32).fill(53) // Disposable fixture identity.
	const identifier = crypto.randomUUID()
	const map = finalizeEvent(
		{
			kind: 37515,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', identifier]],
			content: JSON.stringify({
				modelVersion: MODEL_VERSION,
				type: 'FeatureCollection',
				name: 'Public source',
				features: [
					{
						type: 'Feature',
						id: 'one',
						geometry: { type: 'Point', coordinates: [16, 48] },
						properties: {},
					},
					{
						type: 'Feature',
						id: 'two',
						geometry: { type: 'Point', coordinates: [17, 49] },
						properties: {},
					},
				],
			}),
		},
		secret,
	)
	eventStore.add(map)
	const reference = `37515:${map.pubkey}:${identifier}`
	const first = await call('read_entity', { reference, featureId: 'one' })
	expect(first.ok).toBe(true)
	let inventory = await call('list_local_drafts')
	const scoped = inventory.sources.find(
		(source: { reference: string }) => source.reference === reference,
	)
	expect(scoped.wholeSource).toBe(false)
	expect(scoped.citeReference).toEndWith('#one')
	const base = {
		createNew: true,
		creationToken: inventory.creationToken,
		title: 'Source-bound Story',
	}
	expect((await call('write_story_draft', { ...base, markdown: scoped.citeReference })).ok).toBe(
		true,
	)
	expect(
		(
			await call('write_story_draft', {
				...base,
				markdown: scoped.citeReference.replace('#one', ''),
			})
		).code,
	).toBe('source_not_granted')
	expect(
		(
			await call('write_story_draft', {
				...base,
				markdown: scoped.citeReference.replace('#one', '#two'),
			})
		).code,
	).toBe('feature_not_granted')
	expect((await call('read_entity', { reference })).ok).toBe(true)
	inventory = await call('list_local_drafts')
	const whole = inventory.sources.find(
		(source: { reference: string }) => source.reference === reference,
	)
	expect(whole.wholeSource).toBe(true)
	expect(whole.citeReference).not.toContain('#')
	expect(
		(
			await call('write_story_draft', {
				...base,
				markdown: whole.citeReference,
				presentation: {
					version: 1,
					layers: [{ id: 'places', source: reference, featureIds: ['two'] }],
				},
			})
		).ok,
	).toBe(true)
	const storyId = crypto.randomUUID()
	const story = finalizeEvent(
		{
			kind: 37520,
			created_at: map.created_at,
			tags: [['d', storyId]],
			content: JSON.stringify({
				modelVersion: MODEL_VERSION,
				title: 'Public Story',
				content: whole.citeReference,
			}),
		},
		secret,
	)
	eventStore.add(story)
	const storyRef = `37520:${story.pubkey}:${storyId}`
	expect((await call('read_entity', { reference: storyRef })).ok).toBe(true)
	expect(
		(
			await call('write_atlas_draft', {
				createNew: true,
				creationToken: inventory.creationToken,
				name: 'Public source Atlas',
				curatedReferences: [reference, storyRef],
			})
		).ok,
	).toBe(true)
	// Public grants are tied to the exact read revision, rather than silently adopting new content.
	eventStore.add(
		finalizeEvent(
			{ kind: map.kind, created_at: map.created_at + 1, tags: map.tags, content: map.content },
			secret,
		),
	)
	expect((await call('write_story_draft', { ...base, markdown: whole.citeReference })).code).toBe(
		'source_not_granted',
	)
})

test('published source discovery supplies a citable Map without inventing published feature references', async () => {
	const feature = {
		type: 'Feature' as const,
		id: 'relation/62504.!',
		geometry: { type: 'Point' as const, coordinates: [4, 50] },
		properties: { name: 'A battlefield' },
	}
	const event = finalizeEvent(
		{
			kind: 37515,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', `western:front:${crypto.randomUUID()}`]],
			content: JSON.stringify({
				modelVersion: MODEL_VERSION,
				type: 'FeatureCollection',
				features: [feature],
			}),
		},
		new Uint8Array(32).fill(54),
	)
	eventStore.add(event)
	const datasetKey = `${event.pubkey}:${event.tags[0]![1]}`
	const coordinate = `37515:${datasetKey}`
	useEditorStore.setState({
		workspaces: {
			map: {
				id: 'map',
				sourceId: `dataset:${datasetKey}`,
				label: 'Front',
				kind: 'dataset',
				datasetKey,
				baseRevisionId: null,
				activeDraftId: 'map-draft',
				chatSessionId: null,
				createdAt: 1,
				updatedAt: 1,
			},
		},
		geoEditDrafts: {
			'map-draft': {
				persistenceVersion: 2,
				id: 'map-draft',
				sourceId: `dataset:${datasetKey}`,
				name: 'Front',
				description: '',
				collectionMeta: createDefaultCollectionMeta(),
				features: [feature],
				selectedFeatureIds: [],
				publishChannel: { kind: 'public' },
				contextRefs: [],
				blobReferences: [],
				createdAt: 1,
				updatedAt: 1,
			},
		},
	})
	const inventory = await call('list_local_drafts')
	const published = inventory.sources.find(
		(source: { reference: string }) => source.reference === coordinate,
	)
	expect(published.citeReference).toStartWith('nostr:naddr1')
	expect(canonicalDocumentReference(published.citeReference)).toBe(coordinate)
	expect(published.featureIds).toEqual([])
	expect(published.retainedFeatureIds).toEqual([feature.id])
	expect(published.featureReferences).toBeUndefined()
	expect(
		inventory.sources.find(
			(source: { reference: string }) => source.reference === 'earthly-draft:map',
		).citeReference,
	).toBeUndefined()
	const content = {
		createNew: true,
		creationToken: inventory.creationToken,
		title: 'A source-led Story',
		markdown: published.citeReference,
		presentation: {
			version: 1,
			layers: [{ id: 'battle', source: coordinate, featureIds: [feature.id] }],
		},
	}
	expect((await call('write_story_draft', content)).code).toBe('feature_not_granted')
	// A dirty retained Map neither grants its unpublished IDs nor hides published features.
	const draft = useEditorStore.getState().geoEditDrafts['map-draft']!
	useEditorStore.setState({
		geoEditDrafts: { 'map-draft': { ...draft, features: [{ ...feature, id: 'unpublished' }] } },
	})
	expect((await call('read_entity', { reference: coordinate })).ok).toBe(true)
	const created = await call('write_story_draft', content)
	expect(created.ok).toBe(true)
	expect(created.draft.mapAuthoring.presentationStatus).toBe('valid')
	expect(
		(
			await call('write_story_draft', {
				...content,
				markdown: `${published.citeReference}#unpublished`,
				presentation: undefined,
			})
		).code,
	).toBe('feature_not_granted')
})

test('updates require a kind-specific exact read token and preserve omitted fields', async () => {
	const created = await createStory()
	expect(
		await call('write_story_draft', { draftTarget: created.draftKey, title: 'No read' }),
	).toMatchObject({ ok: false, code: 'draft_token_required' })
	const read = await call('read_story_draft', { draftTarget: created.draftKey })
	const saved = await call('write_story_draft', {
		draftTarget: read.draftKey,
		draftToken: read.draftToken,
		description: 'Named description',
	})
	expect(saved.ok).toBe(true)
	expect(readStoryDraft(created.draftKey, null)).toMatchObject({
		title: 'A retained Story',
		content: 'The narrative.',
		summary: 'Named description',
	})
	expect(
		await call('write_story_draft', {
			draftTarget: read.draftKey,
			draftToken: read.draftToken,
			title: 'Stale',
		}),
	).toMatchObject({ ok: false, code: 'stale_draft' })
	expect(
		await call('write_atlas_draft', {
			draftTarget: read.draftKey,
			draftToken: saved.draftToken,
			name: 'Wrong kind',
		}),
	).toMatchObject({ ok: false, code: 'draft_token_required' })
	const noOp = await call('write_story_draft', {
		draftTarget: saved.draftKey,
		draftToken: saved.draftToken,
		description: 'Named description',
	})
	expect(noOp.status).toBe('unchanged')
	expect(getDocumentReviews()).toHaveLength(2)
})

test('unknown sources and account-private slots are never accepted implicitly', async () => {
	const list = await call('list_local_drafts')
	expect(
		await call('write_story_draft', {
			createNew: true,
			creationToken: list.creationToken,
			title: 'Hidden Map',
			markdown: 'earthly-draft:missing',
		}),
	).toMatchObject({ ok: false, code: 'source_not_granted' })
	writeStoryDraft(
		'thread-story:hidden',
		{ title: 'Other account', content: 'Private' },
		'a'.repeat(64),
	)
	expect(await call('read_story_draft', { draftTarget: 'thread-story:hidden' })).toMatchObject({
		ok: false,
		code: 'draft_not_granted',
	})
	expect(getDocumentReviews()).toHaveLength(0)
})

test('preview cancel and revocation settle writes before they become durable', async () => {
	useChatStore.setState({ safetyLevel: 1 })
	const ready = pending()
	const write = createStory('Cancelled Story')
	resolveDocumentReview(await ready, false)
	expect((await write).ok).toBe(false)
	expect((await call('list_local_drafts')).drafts).toHaveLength(0)
	const ready2 = pending()
	const revoked = createStory('Revoked Story')
	const id = await ready2
	useWebMcpStore.getState().setEnabled(false)
	resolveDocumentReview(id, true)
	expect((await revoked).ok).toBe(false)
	expect(getDocumentReviews().at(-1)?.status).toBe('failed')
})

test('human edits made during review and after commit are protected by CAS', async () => {
	const created = await createStory()
	useChatStore.setState({ safetyLevel: 2 })
	const read = await call('read_story_draft', { draftTarget: created.draftKey })
	const ready = pending()
	const updating = call('write_story_draft', {
		draftTarget: read.draftKey,
		draftToken: read.draftToken,
		title: 'AI replacement',
	})
	const id = await ready
	writeStoryDraft(read.draftKey, { title: 'Human edit', content: 'User prose' }, null)
	resolveDocumentReview(id, true)
	expect((await updating).code).toBe('stale_draft')
	expect(readStoryDraft(read.draftKey, null)?.title).toBe('Human edit')
	expect(undoDocumentReview(getDocumentReviews()[0]!.id)).toBe(false)
})

test('pending mounted human input is read and invalidates a previous native token', async () => {
	const created = await createStory()
	let pendingTitle: string | null = 'Human input before read'
	const unregister = registerDocumentDraftForm({
		kind: 'story',
		draftKey: created.draftKey,
		ownerPubkey: null,
		flush: () => {
			if (pendingTitle === null) return
			writeStoryDraft(
				created.draftKey,
				{ ...readStoryDraft(created.draftKey, null)!, title: pendingTitle },
				null,
			)
			pendingTitle = null
		},
		suppress: () => {},
	})
	try {
		const read = await call('read_story_draft', { draftTarget: created.draftKey })
		expect(read.draft.title).toBe('Human input before read')
		pendingTitle = 'Human input after read'
		expect(
			await call('write_story_draft', {
				draftTarget: read.draftKey,
				draftToken: read.draftToken,
				title: 'AI replacement',
			}),
		).toMatchObject({ ok: false, code: 'stale_draft' })
		expect(readStoryDraft(created.draftKey, null)?.title).toBe('Human input after read')
		expect(getDocumentReviews()).toHaveLength(1)
	} finally {
		unregister()
	}
})

test('Undo removes only the exact created slot and cancellation releases the global execution lease', async () => {
	const first = await createStory('First')
	const second = await createStory('Second')
	expect(undoDocumentReview(getDocumentReviews()[0]!.id)).toBe(true)
	expect(readStoryDraft(first.draftKey, null)).toBeNull()
	expect(readStoryDraft(second.draftKey, null)?.title).toBe('Second')
	useChatStore.setState({ safetyLevel: 1 })
	const ready = pending()
	const writing = createStory('Interrupted')
	await ready
	controller.abort()
	expect((await writing).ok).toBe(false)
	controller = new AbortController()
	tools = createBrowserToolService(controller.signal)
	expect((await call('list_local_drafts')).ok).toBe(true)
})

test('a document token cannot redirect into another granted Map operation', async () => {
	const created = await createStory()
	const original = registry.get('read_story_draft')!
	try {
		registry.set('read_story_draft', {
			...original,
			handler: () => ({
				ok: false,
				kind: 'tool_redirect',
				toolName: 'read_story_draft',
				message: 'test',
				redirectTool: 'set_dataset_metadata',
				redirectArguments: { name: 'Implicit Map edit' },
			}),
		})
		tools = createBrowserToolService(controller.signal)
		expect(await call('read_story_draft', { draftTarget: created.draftKey })).toMatchObject({
			ok: false,
			code: 'tool_not_granted',
		})
	} finally {
		registry.set('read_story_draft', original)
	}
})
