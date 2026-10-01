import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import Ajv from 'ajv'
import { finalizeEvent, getPublicKey, type NostrEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { GEO_EVENT_KIND, ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { registerDocumentDraftForm } from '@/features/chat/tools/documentDraftForms'
import { getCurrentPubkey, setCurrentPubkey } from '@/lib/wallet/currentUser'
import { registry, type ToolEntry } from '@/features/chat/tools/registry'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	registerChatMapPreparer,
	registerChatWorkspaceOpener,
} from '@/features/geo-editor/authoringTaskBridge'
import {
	resetStoryEditorOpenRequests,
	getStoryEditorTarget,
} from '@/features/geo-editor/storyEditorBridge'
import {
	resetAtlasEditorOpenRequests,
	getAtlasEditorTarget,
} from '@/features/groups/atlasEditorBridge'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { readGroupEditorDraft, writeGroupEditorDraft } from '@/features/groups/editorDraft'
import { useWebMcpStore } from './state'
import { BrowserToolError } from './mapContext'
import { createLifecycleTools, type BrowserPublicDocumentSource } from './lifecycleService'
import type { BrowserTool } from './platform'

// Deterministic development fixtures; never a user account or relay.
const secret = new Uint8Array(32).fill(37)
const owner = getPublicKey(secret)
const originalEditor = useEditorStore.getState()
const originalBridge = useWebMcpStore.getState()
const originalOwner = getCurrentPubkey()
const storage = new Map<string, string>()
const changedEntries = new Map<string, ToolEntry>()
let priorWindow: unknown
let controller: AbortController
let account: string | null
let tools: BrowserTool[]
let cleanupOpener: () => void
let cleanupPreparer: () => void
let opened: string[]
const ajv = new Ajv({ strict: false })

function createTools(
	bindMap?: () => unknown,
	onPublicSource?: (source: BrowserPublicDocumentSource) => void,
) {
	return createLifecycleTools({
		owner,
		getOwner: () => account,
		sessionSignal: controller.signal,
		bindMap,
		onPublicSource,
		tool(name, description, inputSchema, readOnly, handler) {
			const validate = ajv.compile(inputSchema)
			return {
				name,
				description,
				inputSchema,
				annotations: {
					readOnlyHint: readOnly,
					untrustedContentHint: true,
					consequentialHint: !readOnly,
				},
				async execute(input, context) {
					try {
						if (!validate(input)) throw new BrowserToolError('invalid_input', 'Invalid input')
						return await handler(
							input as Record<string, unknown>,
							context?.signal ?? controller.signal,
							crypto.randomUUID(),
						)
					} catch (error) {
						return {
							ok: false,
							code:
								error instanceof BrowserToolError
									? error.code
									: error instanceof Error
										? error.name
										: 'error',
							message: String(error),
						}
					}
				},
			}
		},
	})
}
function call(name: string, args: Record<string, unknown> = {}) {
	return tools.find((tool) => tool.name === `earthly_${name}`)!.execute(args) as Promise<any>
}
function fixture(kind: number, content: Record<string, unknown>, tags: string[][] = []) {
	const identifier = crypto.randomUUID()
	const event = finalizeEvent(
		{
			kind,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', identifier], ...tags],
			content: JSON.stringify({ modelVersion: MODEL_VERSION, ...content }),
		},
		secret,
	)
	eventStore.add(event)
	return { event, reference: `${kind}:${owner}:${identifier}`, identifier }
}
function replace(source: NostrEvent) {
	const next = finalizeEvent(
		{
			kind: source.kind,
			created_at: source.created_at + 1,
			tags: source.tags,
			content: source.content,
		},
		secret,
	)
	eventStore.add(next)
	return next
}
function mapFixture(tags: string[][] = []) {
	return fixture(
		GEO_EVENT_KIND,
		{
			type: 'FeatureCollection',
			name: 'Published Map',
			features: [
				{
					type: 'Feature',
					id: 'one',
					geometry: { type: 'Point', coordinates: [16, 48] },
					properties: { name: 'A point' },
				},
			],
		},
		tags,
	)
}
function stubEntry(name: string, handler: ToolEntry['handler']) {
	const prior = registry.get(name)!
	if (!changedEntries.has(name)) changedEntries.set(name, prior)
	registry.set(name, { ...prior, handler })
}
beforeAll(() => {
	priorWindow = globalThis.window
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
		},
	})
})
afterAll(() => {
	if (priorWindow === undefined) delete (globalThis as Record<string, unknown>).window
	else Object.assign(globalThis, { window: priorWindow })
})
beforeEach(() => {
	storage.clear()
	account = owner
	setCurrentPubkey(owner)
	controller = new AbortController()
	opened = []
	useWebMcpStore.setState({ enabled: true })
	useEditorStore.setState({
		workspaces: {},
		geoEditDrafts: {},
		editor: null,
		mode: 'static',
		features: [],
		canFinishDrawing: false,
		geometryOperation: null,
		activeWorkspaceId: null,
		activeGeoEditDraftId: null,
		pendingHydratedDraftId: null,
	})
	cleanupOpener = registerChatWorkspaceOpener(async (id) => {
		opened.push(id)
	})
	cleanupPreparer = registerChatMapPreparer(async () => {
		throw new Error('Unexpected reseeding')
	})
	tools = createTools()
})
afterEach(() => {
	controller.abort()
	cleanupOpener()
	cleanupPreparer()
	resetStoryEditorOpenRequests()
	resetAtlasEditorOpenRequests()
	for (const [name, entry] of changedEntries) registry.set(name, entry)
	changedEntries.clear()
	setCurrentPubkey(originalOwner)
	useEditorStore.setState(originalEditor, true)
	useWebMcpStore.setState(originalBridge, true)
})

test('creates distinct recoverable empty Maps and uses the host binding', async () => {
	const source = mapFixture()
	useEditorStore.setState({
		features: [
			{
				type: 'Feature',
				id: 'secret-visible',
				geometry: { type: 'Point', coordinates: [0, 0] },
				properties: {},
			},
		],
		activeDatasetContextRefs: [source.reference],
		blobReferences: [
			{
				id: 'visible-blob',
				scope: 'collection',
				url: 'https://example.invalid/visible',
				status: 'ready',
			},
		],
	})
	let bindings = 0
	tools = createTools(() => ({ mapToken: `fresh-${++bindings}` }))
	const first = await call('create_map_draft', { title: 'New Map', audience: 'public' })
	const second = await call('create_map_draft', { title: 'New Map', audience: 'public' })
	expect(first).toMatchObject({ ok: true, kind: 'map', map: { mapToken: 'fresh-1' } })
	expect(second.workspaceId).not.toBe(first.workspaceId)
	expect(opened).toEqual([first.workspaceId, second.workspaceId])
	const draft = useEditorStore.getState().geoEditDrafts[first.draftId]!
	expect(draft.features).toEqual([])
	expect(draft.contextRefs).toEqual([])
	expect(draft.blobReferences).toEqual([])
	expect(draft.publishChannel).toEqual({ kind: 'public' })
	expect(first.source.reference).toBe(`earthly-draft:${first.workspaceId}`)
})

test('opens only retained current-account public drafts and refuses transient drawing', async () => {
	const created = await call('create_map_draft', { title: 'Retained', audience: 'public' })
	expect((await call('open_map_draft', { workspaceId: created.workspaceId })).ok).toBe(true)
	useEditorStore.setState({ mode: 'draw_linestring' })
	expect(await call('open_map_draft', { workspaceId: created.workspaceId })).toMatchObject({
		ok: false,
		code: 'drawing_in_progress',
	})
	useEditorStore.setState({ mode: 'static' })
	useEditorStore
		.getState()
		.saveGeoEditDraft(created.draftId, { publishChannel: { kind: 'private-group', id: 'private' } })
	expect(await call('open_map_draft', { workspaceId: created.workspaceId })).toMatchObject({
		ok: false,
		code: 'draft_unavailable',
	})
	expect(await call('open_map_draft', { workspaceId: 'missing' })).toMatchObject({
		ok: false,
		code: 'draft_unavailable',
	})
	setCurrentPubkey('a'.repeat(64))
	expect(
		await call('create_map_draft', { title: 'Wrong account', audience: 'public' }),
	).toMatchObject({ ok: false, code: 'access_disabled' })
})

test('public search is headless, bounded and never changes its shared schema', async () => {
	const originalSchema = JSON.stringify(registry.get('search_entities')!.schema)
	let received: Record<string, unknown> | undefined
	stubEntry('search_entities', (args) => {
		received = args
		return { ok: true, results: [] }
	})
	tools = createTools()
	expect((await call('search_entities', { query: 'Vienna' })).ok).toBe(true)
	expect(received).toMatchObject({ entityTypes: ['dataset', 'story', 'group'], limit: 20 })
	expect(JSON.stringify(registry.get('search_entities')!.schema)).toBe(originalSchema)
	expect(await call('query_entities_in_area', {})).toMatchObject({
		ok: false,
		code: 'invalid_input',
	})
	expect(await call('search_entities', { query: 'Vienna', limit: 51 })).toMatchObject({
		ok: false,
		code: 'invalid_input',
	})
	expect(await call('search_entities', { query: 'Vienna', entityTypes: ['beacon'] })).toMatchObject(
		{ ok: false, code: 'invalid_input' },
	)
})

test('headless published read grants an exact revision; local/private/unknown references are rejected', async () => {
	const source = mapFixture()
	const result = await call('read_entity', { reference: source.reference })
	expect(result).toMatchObject({
		ok: true,
		revisionId: source.event.id,
		sourceRevisionId: source.event.id,
		source: { reference: source.reference },
	})
	expect(result.source.citeReference).toStartWith('nostr:naddr1')
	expect(await call('read_entity', { reference: 'earthly-draft:local' })).toMatchObject({
		ok: false,
		code: 'invalid_reference',
	})
	expect(await call('read_entity', { reference: `30023:${owner}:unknown` })).toMatchObject({
		ok: false,
		code: 'unsupported_reference',
	})
	const scoped = mapFixture([['h', 'nearby']])
	expect(await call('read_entity', { reference: scoped.reference })).toMatchObject({
		ok: false,
		code: 'public_source_required',
	})
})

test('edit/fork requires a read in this session and rejects a superseded source', async () => {
	const source = mapFixture()
	const args = { reference: source.reference, revisionId: source.event.id, intent: 'edit' }
	expect(await call('edit_entity', args)).toMatchObject({ ok: false, code: 'source_read_required' })
	await call('read_entity', { reference: source.reference })
	replace(source.event)
	expect(await call('edit_entity', args)).toMatchObject({ ok: false, code: 'source_changed' })
	expect(useEditorStore.getState().workspaces).toEqual({})
})

test('public read callback grants a whole Map or exactly the requested feature', async () => {
	const grants: BrowserPublicDocumentSource[] = []
	tools = createTools(undefined, (source) => grants.push(source))
	const featureId = 'north/A.B!'
	const map = fixture(GEO_EVENT_KIND, {
		type: 'FeatureCollection',
		name: 'Public inventory',
		features: [
			{
				type: 'Feature',
				id: featureId,
				geometry: { type: 'Point', coordinates: [16, 48] },
				properties: {},
			},
			{
				type: 'Feature',
				id: 'south',
				geometry: { type: 'Point', coordinates: [17, 47] },
				properties: {},
			},
		],
	})
	const full = await call('read_entity', { reference: map.reference })
	expect(grants).toEqual([
		{
			kind: 'map',
			reference: map.reference,
			title: 'Public inventory',
			revisionId: map.event.id,
			wholeSource: true,
			featureIds: [featureId, 'south'],
			citeReference: full.source.citeReference,
		},
	])
	grants.length = 0
	const selectedReference = `${full.source.citeReference}#${encodeURIComponent(featureId)}`
	expect((await call('read_entity', { reference: selectedReference })).ok).toBe(true)
	expect(grants).toEqual([
		{
			kind: 'map',
			reference: map.reference,
			title: map.identifier,
			revisionId: map.event.id,
			wholeSource: false,
			featureIds: [featureId],
			citeReference: selectedReference,
		},
	])
	grants.length = 0
	expect((await call('read_entity', { reference: selectedReference, featureId: 'south' })).ok).toBe(
		true,
	)
	expect(grants[0]).toMatchObject({
		wholeSource: false,
		featureIds: ['south'],
		citeReference: `${full.source.citeReference}#south`,
	})
	grants.length = 0
	expect((await call('read_entity', { reference: map.reference, featureId: 'missing' })).ok).toBe(
		true,
	)
	expect(grants).toEqual([])
})

test('Story reads grant only the Story; Atlas and oversized reads grant no source', async () => {
	const grants: BrowserPublicDocumentSource[] = []
	tools = createTools(undefined, (source) => grants.push(source))
	const map = mapFixture()
	const mapRead = await call('read_entity', { reference: map.reference })
	grants.length = 0
	const story = fixture(ARTICLE_KIND, {
		title: 'Cites a Map',
		content: `Source: ${mapRead.source.citeReference}`,
	})
	const read = await call('read_entity', { reference: story.reference })
	expect(grants).toEqual([
		{
			kind: 'story',
			reference: story.reference,
			title: 'Cites a Map',
			revisionId: story.event.id,
			wholeSource: true,
			citeReference: read.source.citeReference,
		},
	])
	grants.length = 0
	const atlas = fixture(MAP_CONTEXT_KIND, { name: 'Public Atlas', governance: 'closed' }, [
		['a', map.reference],
	])
	expect((await call('read_entity', { reference: atlas.reference })).ok).toBe(true)
	expect(grants).toEqual([])
	stubEntry('read_entity', () => ({
		ok: true,
		revisionId: map.event.id,
		name: 'x'.repeat(600_000),
	}))
	tools = createTools(undefined, (source) => grants.push(source))
	expect(await call('read_entity', { reference: map.reference })).toMatchObject({
		ok: false,
		code: 'result_too_large',
	})
	expect(grants).toEqual([])
	expect(
		await call('edit_entity', {
			reference: map.reference,
			revisionId: map.event.id,
			intent: 'fork',
		}),
	).toMatchObject({ ok: false, code: 'source_read_required' })
})

test('public read callbacks cannot grant after an account change during the read', async () => {
	const grants: BrowserPublicDocumentSource[] = []
	const map = mapFixture()
	stubEntry('read_entity', () => {
		account = 'a'.repeat(64)
		return { ok: true, revisionId: map.event.id, name: 'Public Map', features: [] }
	})
	tools = createTools(undefined, (source) => grants.push(source))
	expect(await call('read_entity', { reference: map.reference })).toMatchObject({
		ok: false,
		code: 'access_disabled',
	})
	expect(grants).toEqual([])
})

test('repeated public Map forks are independent provenance copies', async () => {
	const source = mapFixture()
	await call('read_entity', { reference: source.reference })
	const args = { reference: source.reference, revisionId: source.event.id, intent: 'fork' }
	const first = await call('edit_entity', args)
	const second = await call('edit_entity', args)
	expect(first.ok).toBe(true)
	expect(second.ok).toBe(true)
	expect(second.workspaceId).not.toBe(first.workspaceId)
	const state = useEditorStore.getState()
	const draft = state.geoEditDrafts[first.draftId]!
	expect(draft).toMatchObject({
		authoringIntent: 'fork',
		sourceDataset: { address: source.reference, eventId: source.event.id },
	})
	expect(state.workspaces[first.workspaceId]!.baseRevisionId).toBe(source.event.id)
	expect(draft.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [16, 48] })
	expect(draft.features[0]!.geometry).not.toBe(
		state.geoEditDrafts[second.draftId]!.features[0]!.geometry,
	)
})

test('owner Map entry reuses a dirty retained draft without reseeding', async () => {
	const source = mapFixture()
	await call('read_entity', { reference: source.reference })
	const entered = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'edit',
	})
	expect(entered.ok).toBe(true)
	useEditorStore.getState().saveGeoEditDraft(entered.draftId, { name: 'Dirty local title' })
	cleanupPreparer()
	cleanupPreparer = registerChatMapPreparer(async () => entered.workspaceId)
	const again = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'edit',
	})
	expect(again.workspaceId).toBe(entered.workspaceId)
	expect(useEditorStore.getState().geoEditDrafts[entered.draftId]!.name).toBe('Dirty local title')
})

test('Story entry retains dirty content, raw presentations and separate attributed forks', async () => {
	const source = fixture(ARTICLE_KIND, {
		title: 'Published Story',
		content: 'Narrative',
		presentation: { version: 999, opaque: ['preserve'] },
	})
	await call('read_entity', { reference: source.reference })
	writeStoryDraft(source.identifier, { title: 'Dirty title', content: 'Dirty narrative' }, owner)
	const edited = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'edit',
	})
	expect(edited).toMatchObject({
		ok: true,
		draftTarget: source.identifier,
		sourceRevisionId: source.event.id,
	})
	expect(readStoryDraft(source.identifier, owner)?.title).toBe('Dirty title')
	expect(getStoryEditorTarget()?.mode).toBe('edit')
	const forked = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'fork',
	})
	expect(forked.draftKey).toStartWith('thread-story:')
	expect(readStoryDraft(forked.draftKey, owner)).toMatchObject({
		title: 'Published Story (my copy)',
		presentation: { version: 999, opaque: ['preserve'] },
	})
	expect(readStoryDraft(forked.draftKey, owner)?.content).toContain(forked.source.citeReference)
	expect(readStoryDraft(forked.draftKey, owner)?.publication).toBeUndefined()
})

test('Atlas entry preserves dirty snapshots and makes independently attributed copies', async () => {
	const source = fixture(
		MAP_CONTEXT_KIND,
		{
			name: 'Published Atlas',
			governance: 'closed',
			description: 'Overview',
			presentation: { version: 999, opaque: true },
		},
		[['a', `${GEO_EVENT_KIND}:${owner}:map`]],
	)
	await call('read_entity', { reference: source.reference })
	const snapshot = {
		name: 'Dirty Atlas',
		description: 'Dirty description',
		curatedReferences: [],
		image: '',
		governance: 'closed' as const,
		schemaMode: 'advanced' as const,
		allowedGeometryTypes: [],
		rows: [],
		advancedJson: '{}',
		sampleJson: '{}',
	}
	const draftKey = `edit:${owner}:${source.identifier}`
	writeGroupEditorDraft(draftKey, snapshot, owner)
	const edited = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'edit',
	})
	expect(edited.ok).toBe(true)
	expect(edited.draftTarget).toBe(draftKey)
	expect(readGroupEditorDraft(draftKey, owner)?.name).toBe('Dirty Atlas')
	expect(readGroupEditorDraft(draftKey, owner)?.sourceRevisionId).toBeUndefined()
	expect(getAtlasEditorTarget()?.context?.id).toBe(source.event.id)
	const forked = await call('edit_entity', {
		reference: source.reference,
		revisionId: source.event.id,
		intent: 'fork',
	})
	expect(readGroupEditorDraft(forked.draftKey, owner)).toMatchObject({
		name: 'Published Atlas (my copy)',
		curatedReferences: [`${GEO_EVENT_KIND}:${owner}:map`],
		presentation: { version: 999, opaque: true },
	})
	expect(readGroupEditorDraft(forked.draftKey, owner)?.description).toContain(
		forked.source.citeReference,
	)
})

test('mounted Story inputs flush before retained edit entry', async () => {
	const source = fixture(ARTICLE_KIND, { title: 'Published', content: 'Original' })
	await call('read_entity', { reference: source.reference })
	const dispose = registerDocumentDraftForm({
		kind: 'story',
		draftKey: source.identifier,
		ownerPubkey: owner,
		suppress() {},
		flush() {
			writeStoryDraft(
				source.identifier,
				{ title: 'Pending human title', content: 'Pending human content' },
				owner,
			)
		},
	})
	try {
		expect(
			(
				await call('edit_entity', {
					reference: source.reference,
					revisionId: source.event.id,
					intent: 'edit',
				})
			).ok,
		).toBe(true)
		expect(readStoryDraft(source.identifier, owner)).toMatchObject({
			title: 'Pending human title',
			content: 'Pending human content',
		})
	} finally {
		dispose()
	}
})

test('new document edit slots retain exact publisher source baselines', async () => {
	const story = fixture(ARTICLE_KIND, { title: 'Published', content: 'Original' })
	await call('read_entity', { reference: story.reference })
	const storyEntry = await call('edit_entity', {
		reference: story.reference,
		revisionId: story.event.id,
		intent: 'edit',
	})
	expect(storyEntry.ok).toBe(true)
	expect(readStoryDraft(story.identifier, owner)?.publication).toMatchObject({
		reference: storyEntry.publishedSource.citeReference,
		eventId: story.event.id,
	})
	const atlas = fixture(MAP_CONTEXT_KIND, { name: 'Published Atlas', governance: 'closed' })
	await call('read_entity', { reference: atlas.reference })
	const atlasEntry = await call('edit_entity', {
		reference: atlas.reference,
		revisionId: atlas.event.id,
		intent: 'edit',
	})
	expect(atlasEntry.ok).toBe(true)
	expect(readGroupEditorDraft(atlasEntry.draftKey, owner)?.sourceRevisionId).toBe(atlas.event.id)
	const latest = replace(atlas.event)
	await call('read_entity', { reference: atlas.reference })
	expect(
		(
			await call('edit_entity', {
				reference: atlas.reference,
				revisionId: latest.id,
				intent: 'edit',
			})
		).ok,
	).toBe(true)
	expect(readGroupEditorDraft(atlasEntry.draftKey, owner)?.sourceRevisionId).toBe(atlas.event.id)
})

test('another author can fork a public entity but cannot enter owner edit mode', async () => {
	const event = finalizeEvent(
		{
			kind: ARTICLE_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', crypto.randomUUID()]],
			content: JSON.stringify({
				modelVersion: MODEL_VERSION,
				title: 'Someone else',
				content: 'Public',
			}),
		},
		new Uint8Array(32).fill(38),
	)
	eventStore.add(event)
	const reference = `${event.kind}:${event.pubkey}:${event.tags[0]![1]}`
	await call('read_entity', { reference })
	expect(
		await call('edit_entity', { reference, revisionId: event.id, intent: 'edit' }),
	).toMatchObject({ ok: false, code: 'owner_required' })
	expect((await call('edit_entity', { reference, revisionId: event.id, intent: 'fork' })).ok).toBe(
		true,
	)
})

test('source CAS after delayed Map blob resolution prevents stale local creation', async () => {
	const source = mapFixture([['blob', 'collection', 'https://example.invalid/lifecycle-cas']])
	await call('read_entity', { reference: source.reference })
	const priorFetch = globalThis.fetch
	let finish!: (value: Response) => void
	let started!: () => void
	const fetching = new Promise<void>((resolve) => {
		started = resolve
	})
	globalThis.fetch = ((input: RequestInfo | URL) => {
		if (String(input).includes('/lifecycle-cas')) {
			started()
			return new Promise<Response>((resolve) => {
				finish = resolve
			})
		}
		return priorFetch(input)
	}) as typeof fetch
	try {
		const pending = call('edit_entity', {
			reference: source.reference,
			revisionId: source.event.id,
			intent: 'fork',
		})
		await fetching
		replace(source.event)
		finish(
			new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
				headers: { 'content-type': 'application/json' },
			}),
		)
		expect(await pending).toMatchObject({ ok: false, code: 'source_changed' })
		expect(useEditorStore.getState().workspaces).toEqual({})
		expect(useEditorStore.getState().geoEditDrafts).toEqual({})
	} finally {
		globalThis.fetch = priorFetch
	}
})

test('read cancellation/account changes and registry replacement cannot grant stale entry', async () => {
	let finish!: (result: unknown) => void
	stubEntry(
		'search_entities',
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	tools = createTools()
	const inFlight = call('search_entities', { query: 'Waiting' })
	await Promise.resolve()
	account = 'a'.repeat(64)
	finish({ ok: true, results: [] })
	expect(await inFlight).toMatchObject({ ok: false, code: 'access_disabled' })
	account = owner
	stubEntry('read_entity', () => ({ ok: true }))
	expect(await call('read_entity', { reference: mapFixture().reference })).toMatchObject({
		ok: false,
		code: 'tool_changed',
	})
	controller.abort()
	expect((await call('create_map_draft', { title: 'Cancelled', audience: 'public' })).ok).toBe(
		false,
	)
	expect(useEditorStore.getState().workspaces).toEqual({})
})
