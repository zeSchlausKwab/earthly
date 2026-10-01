import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { castEvent } from 'applesauce-core/casts'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { accounts, eventStore } from '@/lib/nostr'
import { Article } from '@/lib/nostr/article'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { ARTICLE_KIND, GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import { getCurrentPubkey, setCurrentPubkey } from '@/lib/wallet/currentUser'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { readGroupEditorDraft, writeGroupEditorDraft } from '@/features/groups/editorDraft'
import { registerDocumentDraftForm } from '@/features/chat/tools/documentDraftForms'
import { useEditorStore, type GeoCollectionEditDraft } from '@/features/geo-editor/store'
import { resolveLocalStoryDependencies } from '@/features/chat/referencePublishing/localStoryDependencies'
import type { PublishedDatasetReference } from '@/features/chat/referencePublishing/types'
import { useWebMcpStore } from './state'
import { createPublicationTools } from './publicationService'
import type { BrowserTool } from './platform'

const secret = generateSecretKey(),
	owner = getPublicKey(secret)
const account = PrivateKeyAccount.fromKey<{ ephemeral?: boolean }>(secret)
const originalAccount = accounts.active,
	originalOwner = getCurrentPubkey()
const originalEditor = useEditorStore.getState(),
	originalAccess = useWebMcpStore.getState()
const priorWindow = globalThis.window
const storage = new Map<string, string>()
let controller: AbortController,
	tools: BrowserTool[],
	sequence = 100
let beforeSign: (() => void) | undefined, beforeDelivery: (() => void) | undefined
let acknowledged: boolean,
	storyAcknowledged: boolean,
	failAfterSign: boolean,
	datasetCalls: string[],
	storyCalls: number
beforeAll(() =>
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
				removeItem: (key: string) => storage.delete(key),
			},
		},
	}),
)
afterAll(() => {
	if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: priorWindow })
})
function signed(kind: number, identifier: string, content: unknown) {
	return finalizeEvent(
		{ kind, tags: [['d', identifier]], content: JSON.stringify(content), created_at: sequence++ },
		secret,
	)
}
beforeEach(() => {
	storage.clear()
	accounts.active$.next(account)
	setCurrentPubkey(owner)
	useEditorStore.setState({
		workspaces: {},
		geoEditDrafts: {},
		editor: null,
		pendingHydratedDraftId: null,
		isPublishing: false,
		activeWorkspaceId: null,
		activeGeoEditDraftId: null,
	})
	useWebMcpStore.setState({ enabled: true })
	controller = new AbortController()
	acknowledged = true
	storyAcknowledged = true
	failAfterSign = false
	beforeSign = undefined
	beforeDelivery = undefined
	datasetCalls = []
	storyCalls = 0
	tools = createPublicationTools({
		owner,
		getOwner: () => accounts.active?.pubkey ?? null,
		sessionSignal: controller.signal,
		tool: (name, description, inputSchema, readOnly, handler) => ({
			name,
			description,
			inputSchema,
			annotations: {
				readOnlyHint: readOnly,
				consequentialHint: !readOnly,
				untrustedContentHint: true,
			},
			execute: async (args, context) => {
				try {
					return await handler(
						args as Record<string, unknown>,
						context?.signal ?? controller.signal,
						'unit-test',
					)
				} catch (error) {
					return {
						ok: false,
						code: (error as { code?: string }).code,
						message: (error as Error).message,
					}
				}
			},
		}),
		publishDataset: async (captured, validate, hooks) => {
			beforeSign?.()
			validate?.()
			datasetCalls.push(captured.binding.workspaceId)
			const event = signed(GEO_EVENT_KIND, `published-map-${sequence}`, captured.featureCollection)
			hooks?.onSigned?.(event)
			if (failAfterSign) throw new Error('Connection lost after signing; delivery unknown.')
			beforeDelivery?.()
			hooks?.beforeCommit?.()
			hooks?.onDelivery?.(
				event,
				acknowledged
					? [
							{ from: 'ws://localhost:3334', ok: true },
							{ from: 'ws://localhost:3335', ok: false, message: 'rejected' },
						]
					: [],
			)
			const coordinate = `${event.kind}:${event.pubkey}:${event.tags[0]![1]}`
			return {
				mode: captured.authoringIntent === 'fork' ? 'copy' : captured.baseEvent ? 'update' : 'new',
				datasetCoordinate: coordinate,
				datasetMention: coordinateToNaddrReference(coordinate)!,
				featureIds: captured.featureIds,
				addressChanged: true,
				eventId: event.id,
			} satisfies PublishedDatasetReference
		},
		publishStory: async (target, hooks) => {
			storyCalls++
			const captured = readStoryDraft(target.draftKey, owner)!
			const body = await resolveLocalStoryDependencies(captured.content!, {
				storyDraftKey: target.draftKey,
				validate: hooks?.validate,
				publishDependency: hooks?.publishDependency,
				onProgress: (body) => {
					writeStoryDraft(target.draftKey, { ...captured, content: body }, owner)
					hooks?.onProgress?.()
				},
			})
			hooks?.validate?.()
			const event = signed(ARTICLE_KIND, `published-story-${sequence}`, {
				...captured,
				content: body,
				modelVersion: MODEL_VERSION,
			})
			hooks?.onSigned?.(event)
			beforeDelivery?.()
			hooks?.beforeCommit?.()
			hooks?.onDelivery?.(
				event,
				storyAcknowledged ? [{ from: 'ws://localhost:3334', ok: true }] : [],
			)
			return castEvent(event, Article, eventStore)
		},
		publishEvent: async (event, options) => {
			beforeDelivery?.()
			options?.beforeCommit?.()
			eventStore.add(event)
			return [{ from: 'ws://localhost:3334', ok: true }]
		},
	})
})
afterEach(() => {
	controller.abort()
	accounts.active$.next(originalAccount)
	setCurrentPubkey(originalOwner)
	useEditorStore.setState(originalEditor, true)
	useWebMcpStore.setState(originalAccess, true)
})
async function call(name: string, args: Record<string, unknown>) {
	return (await tools.find((tool) => tool.name === `earthly_${name}`)!.execute(args)) as any
}
function map(id = 'map', patches: Partial<GeoCollectionEditDraft> = {}) {
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: `draft-${id}`,
		sourceId: `scratch:${id}`,
		name: `Map ${id}`,
		description: '',
		collectionMeta: { name: `Map ${id}`, description: '', color: '#123456', customProperties: {} },
		features: [
			{
				type: 'Feature',
				id: 'facility',
				geometry: { type: 'Point', coordinates: [50, 25] },
				properties: { name: 'Facility' },
			},
		],
		selectedFeatureIds: [],
		contextRefs: [],
		blobReferences: [],
		publishChannel: { kind: 'public' },
		createdAt: 1,
		updatedAt: 1,
		...patches,
	}
	const state = useEditorStore.getState()
	useEditorStore.setState({
		geoEditDrafts: { ...state.geoEditDrafts, [draft.id]: draft },
		workspaces: {
			...state.workspaces,
			[id]: {
				id,
				sourceId: draft.sourceId,
				label: draft.name,
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: draft.id,
				chatSessionId: null,
				createdAt: 1,
				updatedAt: 1,
			},
		},
	})
	return draft
}
async function preview(target: Record<string, unknown>) {
	return call('prepare_publication', { target })
}
async function execute(prepared: { previewToken: string }) {
	return call('publish_publication', { previewToken: prepared.previewToken, confirm: true })
}

test('prepare captures an explicit inactive Map without signing or publication; execution reports actual acknowledgements', async () => {
	map('requested')
	map('visible')
	useEditorStore.setState({ activeWorkspaceId: 'visible', activeGeoEditDraftId: 'draft-visible' })
	const prepared = await preview({ kind: 'map', workspaceId: 'requested' })
	expect(prepared).toMatchObject({
		ok: true,
		mode: 'new',
		sideEffectsApplied: false,
		dependencies: [],
	})
	expect(datasetCalls).toHaveLength(0)
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: true, status: 'published', sideEffectsApplied: true })
	expect(datasetCalls).toEqual(['requested'])
	expect(result.receipts[0]).toMatchObject({
		delivery: 'acknowledged',
		relays: [{ ok: true }, { ok: false }],
	})
	expect(useEditorStore.getState().activeWorkspaceId).toBe('visible')
	expect(await execute(prepared)).toEqual(result)
	expect(datasetCalls).toHaveLength(1)
})

test('confirmation, unknown tokens, changed Map revisions and changed publication scope stop execution', async () => {
	const draft = map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	expect(
		await call('publish_publication', { previewToken: prepared.previewToken, confirm: false }),
	).toMatchObject({ ok: false, code: 'confirmation_required' })
	expect(
		await call('publish_publication', { previewToken: 'unknown', confirm: true }),
	).toMatchObject({ ok: false, code: 'preview_required' })
	useEditorStore.setState({
		geoEditDrafts: {
			[draft.id]: { ...draft, publishChannel: { kind: 'field-session', id: 'nearby' } },
		},
	})
	expect(await execute(prepared)).toMatchObject({ ok: false, code: 'stale_map' })
	expect(datasetCalls).toHaveLength(0)
	expect((await preview({ kind: 'map', workspaceId: 'map' })).ok).toBe(false)
})

test('revocation/account switch/session cancellation invalidate the publication capability', async () => {
	map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	useWebMcpStore.setState({ enabled: false })
	expect(await execute(prepared)).toMatchObject({ ok: false, code: 'access_disabled' })
	useWebMcpStore.setState({ enabled: true })
	accounts.active$.next(undefined)
	expect((await execute(prepared)).ok).toBe(false)
	accounts.active$.next(account)
	controller.abort()
	expect((await execute(prepared)).ok).toBe(false)
	expect(datasetCalls).toHaveLength(0)
})

test('a human edit at the immediate pre-sign boundary is refused', async () => {
	const draft = map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	beforeSign = () =>
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: { ...draft, name: 'Changed by human' } },
		})
	expect(await execute(prepared)).toMatchObject({
		ok: false,
		code: 'stale_map',
		sideEffectsApplied: false,
		receipts: [],
	})
	expect(datasetCalls).toHaveLength(0)
})

test('routing-delay revocation preserves signed receipt and never claims no side effects', async () => {
	map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	beforeDelivery = () => useWebMcpStore.setState({ enabled: false })
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: false, code: 'access_disabled', sideEffectsApplied: true })
	expect(result.receipts[0].delivery).toBe('unknown')
})

test('empty delivery responses and post-sign failure are uncertain, idempotent, and block a fresh identical attempt', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: false, code: 'delivery_uncertain', sideEffectsApplied: true })
	expect(await execute(prepared)).toEqual(result)
	expect(datasetCalls).toHaveLength(1)
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	map('second')
	failAfterSign = true
	expect(await execute(await preview({ kind: 'map', workspaceId: 'second' }))).toMatchObject({
		ok: false,
		sideEffectsApplied: true,
		receipts: [{ delivery: 'unknown' }],
	})
})

test('Story preview lists exact Map dependencies, rejects changed dependencies, then converts local references under explicit plan authority', async () => {
	const draft = map()
	writeStoryDraft(
		'thread-story:test',
		{ title: 'The Gulf', content: 'A facility earthly-draft:map#facility' },
		owner,
	)
	const prepared = await preview({ kind: 'story', draftKey: 'thread-story:test' })
	expect(prepared).toMatchObject({
		ok: true,
		dependencies: [{ workspaceId: 'map', title: 'Map map' }],
	})
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: { ...draft, contextRefs: ['changed-context'] } },
	})
	expect(await execute(prepared)).toMatchObject({ ok: false, code: 'stale_map' })
	expect(storyCalls).toBe(0)
	const result = await execute(await preview({ kind: 'story', draftKey: 'thread-story:test' }))
	expect(result.ok).toBe(true)
	expect(result.receipts).toHaveLength(2)
	expect(readStoryDraft('thread-story:test', owner)!.content).toContain('nostr:naddr')
	expect(readStoryDraft('thread-story:test', owner)!.content).not.toContain('earthly-draft:')
})

test('an unacknowledged Map dependency never becomes a signed parent Story reference', async () => {
	map()
	acknowledged = false
	writeStoryDraft(
		'thread-story:unacknowledged',
		{ title: 'The Gulf', content: 'earthly-draft:map' },
		owner,
	)
	const result = await execute(
		await preview({ kind: 'story', draftKey: 'thread-story:unacknowledged' }),
	)
	expect(result).toMatchObject({ ok: false, code: 'delivery_uncertain', sideEffectsApplied: true })
	expect(result.receipts).toHaveLength(1)
	expect(result.receipts[0].coordinate).toStartWith(`${GEO_EVENT_KIND}:`)
	expect(result.receipts[0].delivery).toBe('unknown')
	expect(readStoryDraft('thread-story:unacknowledged', owner)?.content).toBe('earthly-draft:map')
})

test('resolved Map dependencies and later edits cannot bypass an uncertain parent Story receipt', async () => {
	map()
	storyAcknowledged = false
	const draftKey = 'thread-story:uncertain-parent'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'earthly-draft:map' }, owner)
	const prepared = await preview({ kind: 'story', draftKey })
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: false, code: 'delivery_uncertain', sideEffectsApplied: true })
	expect(result.receipts).toHaveLength(2)
	expect(result.receipts.map((receipt: { delivery: string }) => receipt.delivery)).toEqual([
		'acknowledged',
		'unknown',
	])
	expect(readStoryDraft(draftKey, owner)?.content).toContain('nostr:naddr')
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	writeStoryDraft(
		draftKey,
		{ ...readStoryDraft(draftKey, owner)!, title: 'Later human title' },
		owner,
	)
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(await execute(prepared)).toEqual(result)
	expect(storyCalls).toBe(1)
	expect(datasetCalls).toHaveLength(1)
})

test('preview eviction pins uncertain signed receipts and their duplicate-publication guard', async () => {
	map('uncertain')
	failAfterSign = true
	const uncertain = await preview({ kind: 'map', workspaceId: 'uncertain' })
	const result = await execute(uncertain)
	for (let index = 0; index < 25; index++) {
		map(`prepared-${index}`)
		expect((await preview({ kind: 'map', workspaceId: `prepared-${index}` })).ok).toBe(true)
	}
	expect(await execute(uncertain)).toEqual(result)
	expect(await preview({ kind: 'map', workspaceId: 'uncertain' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(datasetCalls).toHaveLength(1)
})

test('capacity fails closed when every retained plan has unresolved signed receipts', async () => {
	failAfterSign = true
	for (let index = 0; index < 16; index++) {
		map(`uncertain-${index}`)
		expect(
			await execute(await preview({ kind: 'map', workspaceId: `uncertain-${index}` })),
		).toMatchObject({ ok: false, sideEffectsApplied: true })
	}
	map('overflow')
	expect(await preview({ kind: 'map', workspaceId: 'overflow' })).toMatchObject({
		ok: false,
		code: 'publication_capacity',
	})
	expect(datasetCalls).toHaveLength(16)
})

test('mounted human Story input is flushed before preview and invalidates an old plan', async () => {
	writeStoryDraft('thread-story:test', { title: 'Before', content: 'Body' }, owner)
	let pendingTitle: string | null = 'Human title'
	const stop = registerDocumentDraftForm({
		kind: 'story',
		draftKey: 'thread-story:test',
		ownerPubkey: owner,
		flush: () => {
			if (pendingTitle) {
				writeStoryDraft('thread-story:test', { title: pendingTitle, content: 'Body' }, owner)
				pendingTitle = null
			}
		},
		suppress: () => {},
	})
	try {
		const prepared = await preview({ kind: 'story', draftKey: 'thread-story:test' })
		expect(prepared.title).toBe('Human title')
		pendingTitle = 'Later human title'
		expect(await execute(prepared)).toMatchObject({ ok: false, code: 'stale_draft' })
		expect(storyCalls).toBe(0)
	} finally {
		stop()
	}
})

test('a later changed dependency stops Story signing and reports the first acknowledged Map as partial', async () => {
	map('first')
	const second = map('second')
	writeStoryDraft(
		'thread-story:partial',
		{ title: 'Two Maps', content: 'earthly-draft:first and earthly-draft:second' },
		owner,
	)
	const prepared = await preview({ kind: 'story', draftKey: 'thread-story:partial' })
	beforeSign = () => {
		if (datasetCalls.length === 1)
			useEditorStore.setState({
				geoEditDrafts: {
					...useEditorStore.getState().geoEditDrafts,
					[second.id]: { ...second, description: 'Changed during first delivery' },
				},
			})
	}
	const result = await execute(prepared)
	expect(result).toMatchObject({
		ok: false,
		code: 'stale_map',
		partial: true,
		sideEffectsApplied: true,
	})
	expect(result.receipts).toHaveLength(1)
	expect(result.receipts[0].coordinate).toStartWith(`${GEO_EVENT_KIND}:`)
	expect(datasetCalls).toEqual(['first'])
	expect(readStoryDraft('thread-story:partial', owner)!.content).toContain('nostr:naddr')
	expect(readStoryDraft('thread-story:partial', owner)!.content).toContain('earthly-draft:second')
})

test('Atlas publishes local Map dependencies, preserves opaque presentation, and retains an owned edit identity', async () => {
	map()
	writeGroupEditorDraft(
		'thread-atlas:test',
		{
			name: 'The Gulf',
			description: 'Overview',
			curatedReferences: ['earthly-draft:map'],
			image: '',
			governance: 'closed',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
			presentation: { version: 99, futureField: 'keep' },
		},
		owner,
	)
	const prepared = await preview({ kind: 'atlas', draftKey: 'thread-atlas:test' })
	expect(prepared.dependencies).toHaveLength(1)
	const result = await execute(prepared)
	expect(result).toMatchObject({
		ok: true,
		receipts: [{ delivery: 'acknowledged' }, { delivery: 'acknowledged' }],
	})
	expect(result.draftTarget).toStartWith(`edit:${owner}:`)
	expect(readGroupEditorDraft('thread-atlas:test', owner)).toBeNull()
	expect(readGroupEditorDraft(result.draftTarget, owner)).toMatchObject({
		governance: 'closed',
		presentation: { version: 99, futureField: 'keep' },
	})
	expect(readGroupEditorDraft(result.draftTarget, owner)!.curatedReferences[0]).toStartWith(
		'nostr:naddr',
	)
	expect((await preview({ kind: 'atlas', draftKey: result.draftTarget })).mode).toBe('update')
})

test('Atlas default-view authorization fails during prepare before any Map is signed', async () => {
	map()
	writeGroupEditorDraft(
		'thread-atlas:test',
		{
			name: 'Invalid view',
			description: '',
			curatedReferences: [],
			image: '',
			governance: 'open',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
			presentation: {
				version: 1,
				layers: [{ id: 'unmentioned', source: { kind: 'local-map', workspaceId: 'map' } }],
			},
		},
		owner,
	)
	expect((await preview({ kind: 'atlas', draftKey: 'thread-atlas:test' })).ok).toBe(false)
	expect(datasetCalls).toHaveLength(0)
})

test('Atlas publishes canonical Map and Story coordinates with its exact authorized default view', async () => {
	const mapSource = signed(GEO_EVENT_KIND, 'published-map', {
		type: 'FeatureCollection',
		features: [],
	})
	const storySource = signed(ARTICLE_KIND, 'published-story', {
		title: 'Published Story',
		content: 'Narrative',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(mapSource)
	eventStore.add(storySource)
	const mapCoordinate = `${GEO_EVENT_KIND}:${owner}:published-map`
	const storyCoordinate = `${ARTICLE_KIND}:${owner}:published-story`
	const presentation = {
		version: 1,
		layers: [
			{
				id: 'route-layer',
				source: mapCoordinate,
				featureIds: ['route'],
				visible: true,
				opacityMultiplier: 1,
			},
		],
	}
	writeGroupEditorDraft(
		'thread-atlas:canonical',
		{
			name: 'Canonical references',
			description: 'Published sources',
			curatedReferences: [
				mapCoordinate,
				storyCoordinate,
				coordinateToNaddrReference(mapCoordinate)!,
			],
			image: '',
			governance: 'open',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
			presentation,
		},
		owner,
	)
	const prepared = await preview({ kind: 'atlas', draftKey: 'thread-atlas:canonical' })
	expect(prepared).toMatchObject({ ok: true, dependencies: [] })
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: true, receipts: [{ delivery: 'acknowledged' }] })
	const published = eventStore.getEvent(result.receipts[0].eventId)!
	expect(published.tags.filter((tag) => tag[0] === 'a')).toEqual([
		['a', mapCoordinate],
		['a', storyCoordinate],
	])
	expect(JSON.parse(published.content).presentation).toEqual(presentation)
	expect(readGroupEditorDraft(result.draftTarget, owner)?.curatedReferences).toEqual([
		mapCoordinate,
		storyCoordinate,
		coordinateToNaddrReference(mapCoordinate)!,
	])
})

test('latest loaded public revision CAS stops a prepared Atlas update', async () => {
	const base = signed(MAP_CONTEXT_KIND, 'existing-atlas', {
		name: 'Published',
		governance: 'open',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(base)
	const draftKey = `edit:${owner}:existing-atlas`
	writeGroupEditorDraft(
		draftKey,
		{
			sourceRevisionId: base.id,
			name: 'Edited',
			description: '',
			curatedReferences: [],
			image: '',
			governance: 'open',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
		},
		owner,
	)
	const prepared = await preview({ kind: 'atlas', draftKey })
	expect(prepared.mode).toBe('update')
	eventStore.add(
		signed(MAP_CONTEXT_KIND, 'existing-atlas', {
			name: 'Newer published revision',
			governance: 'open',
			modelVersion: MODEL_VERSION,
		}),
	)
	expect(await execute(prepared)).toMatchObject({ ok: false, code: 'stale_source' })
})

test('unknown retained edit bases never adopt the latest public Story/Atlas revision silently', async () => {
	const atlas = signed(MAP_CONTEXT_KIND, 'legacy-atlas', {
		name: 'Latest Atlas',
		governance: 'open',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(atlas)
	writeGroupEditorDraft(
		`edit:${owner}:legacy-atlas`,
		{
			name: 'Old unsaved Atlas',
			description: '',
			curatedReferences: [],
			image: '',
			governance: 'open',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
		},
		owner,
	)
	expect(await preview({ kind: 'atlas', draftKey: `edit:${owner}:legacy-atlas` })).toMatchObject({
		ok: false,
		code: 'source_revision_unknown',
	})
	const story = signed(ARTICLE_KIND, 'legacy-story', {
		title: 'Latest Story',
		content: 'Latest body',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(story)
	writeStoryDraft('legacy-story', { title: 'Old unsaved Story', content: 'Older body' }, owner)
	expect(await preview({ kind: 'story', draftKey: 'legacy-story' })).toMatchObject({
		ok: false,
		code: 'source_revision_unknown',
	})
	expect(storyCalls).toBe(0)
})

test('a retained Story opened against an older known public revision is stale even before preparation', async () => {
	const base = signed(ARTICLE_KIND, 'known-story', {
		title: 'Initial',
		content: 'Initial body',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(base)
	writeStoryDraft(
		'known-story',
		{
			title: 'Unsaved edits',
			content: 'Older source plus edits',
			publication: {
				reference: coordinateToNaddrReference(`${ARTICLE_KIND}:${owner}:known-story`)!,
				eventId: base.id,
				fingerprint: 'old baseline',
			},
		},
		owner,
	)
	eventStore.add(
		signed(ARTICLE_KIND, 'known-story', {
			title: 'Newer',
			content: 'Changed elsewhere',
			modelVersion: MODEL_VERSION,
		}),
	)
	expect(await preview({ kind: 'story', draftKey: 'known-story' })).toMatchObject({
		ok: false,
		code: 'stale_source',
	})
	expect(storyCalls).toBe(0)
})

test('a retained Atlas source revision is not rebased merely because a newer version is loaded', async () => {
	const base = signed(MAP_CONTEXT_KIND, 'known-atlas', {
		name: 'Initial',
		governance: 'open',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(base)
	const key = `edit:${owner}:known-atlas`
	writeGroupEditorDraft(
		key,
		{
			sourceRevisionId: base.id,
			name: 'Older edits',
			description: '',
			curatedReferences: [],
			image: '',
			governance: 'open',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
		},
		owner,
	)
	eventStore.add(
		signed(MAP_CONTEXT_KIND, 'known-atlas', {
			name: 'Newer',
			governance: 'open',
			modelVersion: MODEL_VERSION,
		}),
	)
	expect(await preview({ kind: 'atlas', draftKey: key })).toMatchObject({
		ok: false,
		code: 'stale_source',
	})
	expect(readGroupEditorDraft(key, owner)?.sourceRevisionId).toBe(base.id)
})

test('independent explicit Map forks capture safely; malformed or implicit suffixes are refused', async () => {
	const base = signed(GEO_EVENT_KIND, 'original', {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'site',
				geometry: { type: 'Point', coordinates: [1, 2] },
				properties: {},
			},
		],
	})
	eventStore.add(base)
	const sourceDataset = {
		address: `${GEO_EVENT_KIND}:${owner}:original`,
		pubkey: owner,
		identifier: 'original',
		eventId: base.id,
	}
	const sourceId = `fork:${owner}:original:${crypto.randomUUID()}`
	const draft = map('forked', { sourceId, authoringIntent: 'fork', sourceDataset })
	const state = useEditorStore.getState()
	useEditorStore.setState({
		workspaces: {
			forked: {
				...state.workspaces.forked!,
				kind: 'dataset',
				datasetKey: `${owner}:original`,
				baseRevisionId: base.id,
			},
		},
	})
	expect(await preview({ kind: 'map', workspaceId: 'forked' })).toMatchObject({
		ok: true,
		mode: 'copy',
	})
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: { ...draft, authoringIntent: undefined } },
	})
	expect((await preview({ kind: 'map', workspaceId: 'forked' })).ok).toBe(false)
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: { ...draft, sourceId: `fork:${owner}:original:malformed` } },
		workspaces: {
			forked: {
				...useEditorStore.getState().workspaces.forked!,
				sourceId: `fork:${owner}:original:malformed`,
			},
		},
	})
	expect((await preview({ kind: 'map', workspaceId: 'forked' })).ok).toBe(false)
})
