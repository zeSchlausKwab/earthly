import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { castEvent } from 'applesauce-core/casts'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools'
import { of } from 'rxjs'
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
import { storyPublicationCoordinate } from '@/features/geo-editor/storyPublication'
import { resolveLocalStoryDependencies } from '@/features/chat/referencePublishing/localStoryDependencies'
import type { PublishedDatasetReference } from '@/features/chat/referencePublishing/types'
import { useWebMcpStore } from './state'
import { createPublicationTools } from './publicationService'
import type { BrowserTool } from './platform'
import type { BrowserPublicDocumentSource } from './lifecycleService'
import { observeSignedPublications } from './publicationObservation'

const secret = generateSecretKey(),
	owner = getPublicKey(secret)
const account = PrivateKeyAccount.fromKey<{ ephemeral?: boolean }>(secret)
const originalAccount = accounts.active,
	originalOwner = getCurrentPubkey()
const originalEditor = useEditorStore.getState(),
	originalAccess = useWebMcpStore.getState()
const priorWindow = globalThis.window
const storage = new Map<string, string>()
let storageUnavailable: boolean | string = false
let controller: AbortController,
	tools: BrowserTool[],
	sequence = 100
let beforeSign: (() => void) | undefined,
	beforeDelivery: (() => void) | undefined,
	afterCommit: (() => void) | undefined
let acknowledged: boolean,
	storyAcknowledged: boolean,
	commitStoryBaseline: boolean,
	failAfterSign: boolean,
	failAtlasAfterSign: boolean,
	datasetCalls: string[],
	storyCalls: number
let grantedSources: BrowserPublicDocumentSource[]
let signedEvents: Map<string, NostrEvent>,
	relayEvents: Map<string, NostrEvent>,
	beforeObservation: (() => void) | undefined,
	observationRequests: Array<{ relay: string; ids: string[] }>
let recordExplicitRebase:
	| ((kind: 'story' | 'atlas', draftKey: string, sourceRevisionId: string) => void)
	| undefined
beforeAll(() =>
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => {
					if (
						storageUnavailable === true ||
						(typeof storageUnavailable === 'string' && key.includes(storageUnavailable))
					)
						throw new Error('Browser storage quota exceeded')
					storage.set(key, value)
				},
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
	storageUnavailable = false
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
	commitStoryBaseline = false
	failAfterSign = false
	failAtlasAfterSign = false
	beforeSign = undefined
	beforeDelivery = undefined
	afterCommit = undefined
	datasetCalls = []
	storyCalls = 0
	grantedSources = []
	signedEvents = new Map()
	relayEvents = new Map()
	beforeObservation = undefined
	observationRequests = []
	recordExplicitRebase = undefined
	tools = createPublicationTools({
		owner,
		getOwner: () => accounts.active?.pubkey ?? null,
		sessionSignal: controller.signal,
		onPublicSource: (source) => grantedSources.push(source),
		getObservationRelays: () => ['ws://localhost:3334', 'ws://localhost:3335'],
		registerExplicitRebase: (handler) => {
			recordExplicitRebase = handler
		},
		observeEvents: async (events, relays, signal) => {
			beforeObservation?.()
			return observeSignedPublications(events, relays, signal, {
				request: (relay, ids) => {
					observationRequests.push({ relay, ids })
					return of(...[...relayEvents.values()].filter((event) => ids.includes(event.id)))
				},
			})
		},
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
			const identifier =
				captured.authoringIntent !== 'fork' && captured.baseEvent
					? captured.baseEvent.tags.find((tag) => tag[0] === 'd')?.[1]
					: `published-map-${sequence}`
			if (!identifier) throw new Error('The captured Map has no publication identity')
			const event = signed(GEO_EVENT_KIND, identifier, captured.featureCollection)
			signedEvents.set(event.id, event)
			hooks?.onSigned?.(event)
			if (failAfterSign) throw new Error('Connection lost after signing; delivery unknown.')
			beforeDelivery?.()
			hooks?.beforeCommit?.()
			afterCommit?.()
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
			const coordinate = target.storyReference
				? storyPublicationCoordinate(target.storyReference)
				: null
			const identifier = coordinate
				? coordinate.split(':').slice(2).join(':')
				: `published-story-${sequence}`
			const event = signed(ARTICLE_KIND, identifier, {
				...captured,
				content: body,
				modelVersion: MODEL_VERSION,
			})
			signedEvents.set(event.id, event)
			hooks?.onSigned?.(event)
			beforeDelivery?.()
			hooks?.beforeCommit?.()
			hooks?.onDelivery?.(
				event,
				storyAcknowledged ? [{ from: 'ws://localhost:3334', ok: true }] : [],
			)
			if (commitStoryBaseline && storyAcknowledged) {
				eventStore.add(event)
				writeStoryDraft(
					target.draftKey,
					{
						...readStoryDraft(target.draftKey, owner)!,
						publication: {
							eventId: event.id,
							reference: coordinateToNaddrReference(`${ARTICLE_KIND}:${owner}:${identifier}`)!,
							fingerprint: 'fixture-publication',
						},
					},
					owner,
				)
			}
			return castEvent(event, Article, eventStore)
		},
		publishEvent: async (event, options) => {
			signedEvents.set(event.id, event)
			if (failAtlasAfterSign) throw new Error('Atlas delivered without acknowledgement')
			beforeDelivery?.()
			options?.beforeCommit?.()
			eventStore.add(event)
			return [{ from: 'ws://localhost:3334', ok: true }]
		},
	})
})
afterEach(() => {
	storageUnavailable = false
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
function deliver(receipt: { eventId: string }) {
	const event = signedEvents.get(receipt.eventId)
	if (!event) throw new Error('The fixture has no exact signed receipt event')
	relayEvents.set(event.id, event)
	return event
}

test('exact relay observation recovers a delivered Map without acknowledgement, preserving later edits and idempotence', async () => {
	const draft = map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	const event = deliver(failed.receipts[0])
	useEditorStore.setState({
		geoEditDrafts: {
			[draft.id]: {
				...draft,
				features: [...draft.features, { ...draft.features[0]!, id: 'later-unpublished' }],
			},
		},
	})
	const recovered = await call('reconcile_publication', { previewToken: prepared.previewToken })
	expect(recovered).toMatchObject({
		ok: true,
		status: 'publication_observed',
		publicationComplete: true,
		targetObserved: true,
		allSignedEventsObserved: true,
		signedOrSent: false,
		recoveryBlocked: false,
		receipts: [{ delivery: 'unknown', observation: { status: 'verified' } }],
		recoveries: [{ status: 'reconciled' }],
	})
	expect(observationRequests).toEqual([
		{ relay: 'ws://localhost:3334', ids: [event.id] },
		{ relay: 'ws://localhost:3335', ids: [event.id] },
	])
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBe(event.id)
	expect(useEditorStore.getState().geoEditDrafts[draft.id]?.features).toHaveLength(2)
	expect(grantedSources).toHaveLength(1)
	expect(grantedSources[0]).toMatchObject({ revisionId: event.id, featureIds: ['facility'] })
	expect(await execute(prepared)).toMatchObject({ ok: true, status: 'publication_observed' })
	relayEvents.clear()
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		receipts: [{ delivery: 'unknown', observation: { status: 'verified' } }],
		recoveries: [{ status: 'already_current' }],
	})
	expect(datasetCalls).toEqual(['map'])
	const next = await preview({ kind: 'map', workspaceId: 'map' })
	expect(next).toMatchObject({ ok: true, mode: 'update' })
})

test('cached, absent, wrong-source and forged events cannot resolve uncertain delivery or grant source access', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	const exact = signedEvents.get(failed.receipts[0].eventId)!
	eventStore.add(exact)
	const wrong = signed(GEO_EVENT_KIND, 'wrong-source', JSON.parse(exact.content))
	relayEvents.set(wrong.id, wrong)
	relayEvents.set(exact.id, { ...exact, sig: '0'.repeat(128) })
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: false,
		status: 'delivery_uncertain',
		publicationComplete: false,
		receipts: [{ delivery: 'unknown', observation: { status: 'uncertain' } }],
		recoveries: [],
		signedOrSent: false,
	})
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	expect(grantedSources).toHaveLength(0)
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(datasetCalls).toEqual(['map'])
})

test('a verified dependency rewrites an unchanged unsigned Story, but never claims the parent was published', async () => {
	map()
	const draftKey = 'thread-story:observed-dependency'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'earthly-draft:map#facility' }, owner)
	acknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	const recovered = await call('reconcile_publication', { previewToken: prepared.previewToken })
	expect(recovered).toMatchObject({
		ok: false,
		status: 'partial',
		publicationComplete: false,
		targetObserved: false,
		allSignedEventsObserved: true,
		recoveryBlocked: false,
		signedOrSent: false,
		recoveries: [{ status: 'reconciled' }, { status: 'references_resolved' }],
	})
	expect(readStoryDraft(draftKey, owner)?.content).toBe(`${failed.receipts[0].reference}#facility`)
	expect(readStoryDraft(draftKey, owner)?.publication).toBeUndefined()
	const next = await preview({ kind: 'story', draftKey })
	expect(next).toMatchObject({ ok: true, dependencies: [] })
	acknowledged = true
	expect(await execute(next)).toMatchObject({ ok: true, receipts: [{ delivery: 'acknowledged' }] })
	expect(datasetCalls).toEqual(['map'])
	expect(storyCalls).toBe(2)
})

test('an uncertain signed Map dependency cannot acquire a duplicate identity through another parent', async () => {
	map()
	const first = 'thread-story:uncertain-shared-map',
		second = 'thread-story:second-parent'
	writeStoryDraft(first, { title: 'First Story', content: 'earthly-draft:map#facility' }, owner)
	writeStoryDraft(second, { title: 'Second Story', content: 'earthly-draft:map#facility' }, owner)
	acknowledged = false
	const prepared = await preview({ kind: 'story', draftKey: first })
	const failed = await execute(prepared)
	expect(await preview({ kind: 'story', draftKey: second })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	deliver(failed.receipts[0])
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ ok: false, recoveryBlocked: false })
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: true,
		mode: 'update',
	})
	expect(datasetCalls).toEqual(['map'])
})

test('already prepared Map or shared-parent previews cannot bypass uncertainty at their signing boundary', async () => {
	map()
	writeStoryDraft(
		'thread-story:prepared-first',
		{ title: 'First', content: 'earthly-draft:map#facility' },
		owner,
	)
	writeStoryDraft(
		'thread-story:prepared-second',
		{ title: 'Second', content: 'earthly-draft:map#facility' },
		owner,
	)
	const first = await preview({ kind: 'story', draftKey: 'thread-story:prepared-first' })
	const second = await preview({ kind: 'story', draftKey: 'thread-story:prepared-second' })
	const direct = await preview({ kind: 'map', workspaceId: 'map' })
	acknowledged = false
	const failed = await execute(first)
	expect(failed).toMatchObject({ ok: false, receipts: [{ delivery: 'unknown' }] })
	expect(await execute(second)).toMatchObject({ ok: false, code: 'publication_uncertain' })
	expect(await execute(direct)).toMatchObject({ ok: false, code: 'publication_uncertain' })
	expect(datasetCalls).toEqual(['map'])
	expect(signedEvents.size).toBe(1)
})

test('observed Map dependencies cannot silently rewrite a changed retained Story', async () => {
	map()
	const draftKey = 'thread-story:dirty-dependency'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'earthly-draft:map#facility' }, owner)
	acknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	const content = 'My later edit: earthly-draft:map#facility'
	writeStoryDraft(draftKey, { title: 'The Gulf', content }, owner)
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: false,
		status: 'partial',
		recoveryBlocked: false,
		recoveries: [{ status: 'reconciled' }, { status: 'draft_changed' }],
	})
	expect(readStoryDraft(draftKey, owner)?.content).toBe(content)
	const next = await preview({ kind: 'story', draftKey })
	expect(next).toMatchObject({ ok: true, mode: 'new' })
	acknowledged = true
	const published = await execute(next)
	expect(published).toMatchObject({ ok: true })
	expect(published.receipts[0].coordinate).toBe(failed.receipts[0].coordinate)
	expect(readStoryDraft(draftKey, owner)?.content).toContain('My later edit:')
	expect(datasetCalls).toEqual(['map', 'map'])
})

test('signed Story observation attaches only the exact unchanged publication baseline', async () => {
	const draftKey = 'thread-story:observed-story'
	writeStoryDraft(
		draftKey,
		{ title: 'The Gulf', content: 'A narrative with no dependencies.' },
		owner,
	)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	const event = deliver(failed.receipts[0])
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		publicationComplete: true,
		recoveryBlocked: false,
		recoveries: [{ status: 'reconciled', draftTarget: draftKey }],
	})
	expect(readStoryDraft(draftKey, owner)?.publication).toMatchObject({
		eventId: event.id,
		reference: failed.receipts[0].reference,
	})
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	expect(await execute(prepared)).toMatchObject({ ok: true, status: 'publication_observed' })
	expect(storyCalls).toBe(1)
})

test('a delivered Story stays observed while changed content requires explicit recovery instead of a new identity', async () => {
	const draftKey = 'thread-story:dirty-observed-story'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'Original narrative.' }, owner)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'Later human content.' }, owner)
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		publicationComplete: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'draft_changed' }],
	})
	expect(readStoryDraft(draftKey, owner)).toMatchObject({ content: 'Later human content.' })
	expect(readStoryDraft(draftKey, owner)?.publication).toBeUndefined()
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(storyCalls).toBe(1)
})

test('only a current explicit rebase witness releases observed dirty Story recovery, and Undo restores its guard', async () => {
	const draftKey = 'thread-story:explicit-recovery'
	writeStoryDraft(draftKey, { title: 'Story', content: 'Original narrative.' }, owner)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	const original = deliver(failed.receipts[0])
	writeStoryDraft(draftKey, { title: 'Story', content: 'My later narrative.' }, owner)
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ recoveryBlocked: true })
	const identifier = original.tags.find((tag) => tag[0] === 'd')?.[1]
	if (!identifier) throw new Error('Signed Story has no source')
	const latest = signed(ARTICLE_KIND, identifier, {
		title: 'Story',
		content: 'New public narrative.',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(latest)
	const rebased = {
		title: 'Story',
		content: 'My resolved narrative.',
		publication: {
			eventId: latest.id,
			reference: failed.receipts[0].reference,
			fingerprint: 'resolved explicit public baseline',
		},
	}
	writeStoryDraft(draftKey, rebased, owner)
	// Merely changing the retained baseline is not an explicit native resolution.
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	recordExplicitRebase?.('story', draftKey, '0'.repeat(64))
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	useWebMcpStore.setState({ enabled: false })
	recordExplicitRebase?.('story', draftKey, latest.id)
	useWebMcpStore.setState({ enabled: true })
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	recordExplicitRebase?.('story', draftKey, latest.id)
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	for (let index = 0; index < 25; index++) {
		map(`witness-eviction-${index}`)
		expect(await preview({ kind: 'map', workspaceId: `witness-eviction-${index}` })).toMatchObject({
			ok: true,
		})
	}
	writeStoryDraft(draftKey, { title: 'Story', content: 'My later narrative.' }, owner, {
		preservePublication: false,
	})
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	writeStoryDraft(draftKey, rebased, owner)
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	storyAcknowledged = true
	commitStoryBaseline = true
	const update = await preview({ kind: 'story', draftKey })
	expect(await execute(update)).toMatchObject({ ok: true })
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	expect(storyCalls).toBe(2)
})

test('an explicit Story rebase cannot release an unsigned parent or an unobserved Map dependency', async () => {
	map()
	const draftKey = 'thread-story:unsigned-parent-rebase'
	writeStoryDraft(draftKey, { title: 'Story', content: 'earthly-draft:map#facility' }, owner)
	acknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	await execute(prepared)
	const publicStory = signed(ARTICLE_KIND, 'other-public-story', {
		title: 'Story',
		content: 'Public content.',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(publicStory)
	writeStoryDraft(
		draftKey,
		{
			title: 'Story',
			content: 'earthly-draft:map#facility',
			publication: {
				eventId: publicStory.id,
				reference: coordinateToNaddrReference(`${ARTICLE_KIND}:${owner}:other-public-story`)!,
				fingerprint: 'base',
			},
		},
		owner,
	)
	recordExplicitRebase?.('story', draftKey, publicStory.id)
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	expect(datasetCalls).toEqual(['map'])
})

test('observation refuses an older source baseline instead of rolling a Map back', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	const event = deliver(failed.receipts[0])
	const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
	if (!identifier) throw new Error('The signed Map has no coordinate')
	eventStore.add(signed(GEO_EVENT_KIND, identifier, JSON.parse(event.content)))
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		publicationComplete: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'stale_source' }],
	})
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
})

test('receipt observation is scoped to the account, access, session and operation cancellation', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	useWebMcpStore.setState({ enabled: false })
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ ok: false, code: 'access_disabled' })
	expect(observationRequests).toHaveLength(0)
	useWebMcpStore.setState({ enabled: true })
	accounts.active$.next(undefined)
	expect((await call('reconcile_publication', { previewToken: prepared.previewToken })).ok).toBe(
		false,
	)
	expect(observationRequests).toHaveLength(0)
	accounts.active$.next(account)
	beforeObservation = () => useWebMcpStore.setState({ enabled: false })
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ ok: false, code: 'access_disabled' })
	expect(grantedSources).toHaveLength(0)
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	useWebMcpStore.setState({ enabled: true })
	beforeObservation = () => controller.abort(new Error('cancelled during read'))
	expect((await call('reconcile_publication', { previewToken: prepared.previewToken })).ok).toBe(
		false,
	)
	expect(grantedSources).toHaveLength(0)
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	expect(datasetCalls).toEqual(['map'])
})

test('operation cancellation and a changed account after the relay read cannot commit receipt recovery', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	const operation = new AbortController()
	beforeObservation = () => operation.abort(new Error('caller cancelled'))
	const reconcile = tools.find((tool) => tool.name === 'earthly_reconcile_publication')
	if (!reconcile) throw new Error('The read-only recovery tool was not registered')
	expect(
		await reconcile.execute({ previewToken: prepared.previewToken }, { signal: operation.signal }),
	).toMatchObject({ ok: false })
	expect(grantedSources).toHaveLength(0)
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	beforeObservation = () => accounts.active$.next(undefined)
	expect((await call('reconcile_publication', { previewToken: prepared.previewToken })).ok).toBe(
		false,
	)
	expect(grantedSources).toHaveLength(0)
	expect(useEditorStore.getState().workspaces.map?.baseRevisionId).toBeNull()
	expect(datasetCalls).toEqual(['map'])
})

test('a mounted form revoking access at the recovery write boundary cannot adopt a signed Story baseline', async () => {
	const draftKey = 'thread-story:flush-revocation'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'Original content.' }, owner)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	const unregister = registerDocumentDraftForm({
		kind: 'story',
		draftKey,
		ownerPubkey: owner,
		flush: () => useWebMcpStore.setState({ enabled: false }),
		suppress: () => undefined,
	})
	try {
		expect(
			await call('reconcile_publication', { previewToken: prepared.previewToken }),
		).toMatchObject({ ok: false, code: 'access_disabled' })
		expect(readStoryDraft(draftKey, owner)?.publication).toBeUndefined()
		expect(storyCalls).toBe(1)
	} finally {
		unregister()
	}
})

test('an unsigned or unknown preview has no receipt to query', async () => {
	map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ ok: false, code: 'nothing_signed', publicationComplete: false })
	expect(
		await call('reconcile_publication', { previewToken: 'wrong-session-token' }),
	).toMatchObject({ ok: false, code: 'preview_required' })
	expect(observationRequests).toHaveLength(0)
	expect(datasetCalls).toHaveLength(0)
})

test('failed Map persistence retains the identity recovery guard until an exact durable retry succeeds', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	storageUnavailable = true
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'storage_failed' }],
	})
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	storageUnavailable = false
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: false,
		recoveries: [{ status: 'already_current' }],
	})
	expect(await preview({ kind: 'map', workspaceId: 'map' })).toMatchObject({
		ok: true,
		mode: 'update',
	})
	expect(datasetCalls).toEqual(['map'])
})

test('failed Story reference persistence keeps the original content and prevents a duplicate dependency publication', async () => {
	map()
	const draftKey = 'thread-story:storage-dependency'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'earthly-draft:map#facility' }, owner)
	acknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	storageUnavailable = 'story:drafts'
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: false,
		recoveryBlocked: true,
		recoveries: [{ status: 'reconciled' }, { status: 'storage_failed' }],
	})
	expect(readStoryDraft(draftKey, owner)?.content).toBe('earthly-draft:map#facility')
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	storageUnavailable = false
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: false,
		recoveryBlocked: false,
		recoveries: [{ status: 'already_current' }, { status: 'references_resolved' }],
	})
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, dependencies: [] })
	expect(datasetCalls).toEqual(['map'])
})

test('failed signed Story baseline persistence retains the duplicate guard and can retry without signing', async () => {
	const draftKey = 'thread-story:storage-baseline'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'The retained narrative.' }, owner)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	deliver(failed.receipts[0])
	storageUnavailable = 'story:drafts'
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'storage_failed' }],
	})
	expect(readStoryDraft(draftKey, owner)?.publication).toBeUndefined()
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	storageUnavailable = false
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: false,
		recoveries: [{ status: 'reconciled' }],
	})
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	expect(storyCalls).toBe(1)
})

test('a canonical published Story reports its actual key and cannot clear an unrelated dirty retained slot', async () => {
	const draftKey = 'thread-story:canonical-baseline'
	writeStoryDraft(draftKey, { title: 'The Gulf', content: 'The original narrative.' }, owner)
	storyAcknowledged = false
	const prepared = await preview({ kind: 'story', draftKey })
	const failed = await execute(prepared)
	const event = deliver(failed.receipts[0])
	const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
	if (!identifier) throw new Error('The signed Story has no address')
	writeStoryDraft(
		identifier,
		{
			title: 'The Gulf',
			content: 'The original narrative.',
			publication: {
				eventId: event.id,
				reference: failed.receipts[0].reference,
				fingerprint: 'published',
			},
		},
		owner,
	)
	writeStoryDraft(draftKey, { title: 'My other retained edit', content: 'Later content.' }, owner)
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'draft_changed', draftTarget: identifier }],
	})
	expect(readStoryDraft(draftKey, owner)?.content).toBe('Later content.')
	expect(await preview({ kind: 'story', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
})

test('observed Atlas identity is durably written before the original retained draft is cleared', async () => {
	const draftKey = 'thread-atlas:storage-baseline'
	writeGroupEditorDraft(
		draftKey,
		{
			name: 'Atlas',
			description: 'Keep this description.',
			curatedReferences: [],
			image: '',
			governance: 'closed',
			schemaMode: 'builder',
			rows: [],
			allowedGeometryTypes: [],
			advancedJson: '{}',
			sampleJson: '{}',
		},
		owner,
	)
	failAtlasAfterSign = true
	const prepared = await preview({ kind: 'atlas', draftKey })
	const failed = await execute(prepared)
	const event = deliver(failed.receipts[0])
	const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
	const key = `edit:${owner}:${identifier}`
	storageUnavailable = 'context:editor-drafts'
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: true,
		recoveries: [{ status: 'storage_failed' }],
	})
	expect(readGroupEditorDraft(draftKey, owner)?.description).toBe('Keep this description.')
	expect(readGroupEditorDraft(key, owner)).toBeNull()
	expect(await preview({ kind: 'atlas', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	storageUnavailable = false
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({
		ok: true,
		recoveryBlocked: false,
		recoveries: [{ status: 'reconciled', draftTarget: key }],
	})
	expect(readGroupEditorDraft(draftKey, owner)).toBeNull()
	expect(readGroupEditorDraft(key, owner)?.sourceRevisionId).toBe(event.id)
	expect(await preview({ kind: 'atlas', draftKey: key })).toMatchObject({
		ok: true,
		mode: 'update',
	})
	expect(signedEvents.size).toBe(1)
})

test('observed dirty owned Atlas updates require a current explicit rebase witness and restore their guard on Undo', async () => {
	const identifier = 'receipt-rebase-atlas'
	const original = signed(MAP_CONTEXT_KIND, identifier, {
		name: 'Atlas',
		governance: 'closed',
		modelVersion: MODEL_VERSION,
	})
	eventStore.add(original)
	const draftKey = `edit:${owner}:${identifier}`
	const draft = {
		name: 'Atlas',
		description: 'My retained description.',
		curatedReferences: [],
		image: '',
		governance: 'closed' as const,
		schemaMode: 'builder' as const,
		rows: [],
		allowedGeometryTypes: [],
		advancedJson: '{}',
		sampleJson: '{}',
		sourceRevisionId: original.id,
	}
	writeGroupEditorDraft(draftKey, draft, owner)
	failAtlasAfterSign = true
	const prepared = await preview({ kind: 'atlas', draftKey })
	const failed = await execute(prepared)
	const publication = deliver(failed.receipts[0])
	const later = { ...draft, description: 'Later human description.' }
	writeGroupEditorDraft(draftKey, later, owner)
	expect(
		await call('reconcile_publication', { previewToken: prepared.previewToken }),
	).toMatchObject({ recoveryBlocked: true })
	const latest = finalizeEvent(
		{
			kind: MAP_CONTEXT_KIND,
			tags: [['d', identifier]],
			created_at: publication.created_at + 1,
			content: JSON.stringify({ name: 'Atlas', governance: 'closed', modelVersion: MODEL_VERSION }),
		},
		secret,
	)
	eventStore.add(latest)
	writeGroupEditorDraft(draftKey, { ...later, sourceRevisionId: latest.id }, owner)
	expect(await preview({ kind: 'atlas', draftKey })).toMatchObject({
		ok: false,
		code: 'publication_uncertain',
	})
	recordExplicitRebase?.('atlas', draftKey, latest.id)
	expect(await preview({ kind: 'atlas', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	writeGroupEditorDraft(draftKey, { ...later, sourceRevisionId: undefined }, owner, {
		preserveSourceRevision: false,
	})
	expect((await preview({ kind: 'atlas', draftKey })).ok).toBe(false)
	writeGroupEditorDraft(draftKey, { ...later, sourceRevisionId: latest.id }, owner)
	expect(await preview({ kind: 'atlas', draftKey })).toMatchObject({ ok: true, mode: 'update' })
	expect(signedEvents.size).toBe(1)
})

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
	expect(grantedSources).toHaveLength(0)
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: true, status: 'published', sideEffectsApplied: true })
	expect(datasetCalls).toEqual(['requested'])
	expect(result.receipts[0]).toMatchObject({
		delivery: 'acknowledged',
		relays: [{ ok: true }, { ok: false }],
	})
	expect(useEditorStore.getState().activeWorkspaceId).toBe('visible')
	expect(grantedSources).toHaveLength(1)
	expect(grantedSources[0]).toMatchObject({
		kind: 'map',
		reference: result.receipts[0].coordinate,
		revisionId: result.receipts[0].eventId,
		wholeSource: true,
		featureIds: ['facility'],
	})
	expect(await execute(prepared)).toEqual(result)
	expect(datasetCalls).toHaveLength(1)
	expect(grantedSources).toHaveLength(1)
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

test('acknowledged source grants use the signed event, excluding later unpublished retained features', async () => {
	const draft = map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	afterCommit = () =>
		useEditorStore.setState({
			geoEditDrafts: {
				[draft.id]: {
					...draft,
					features: [...draft.features, { ...draft.features[0]!, id: 'unpublished-after-signing' }],
				},
			},
		})
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: true, status: 'published' })
	expect(useEditorStore.getState().geoEditDrafts[draft.id]?.features).toHaveLength(2)
	expect(grantedSources[0]).toMatchObject({
		revisionId: result.receipts[0].eventId,
		featureIds: ['facility'],
	})
	const changed = await preview({ kind: 'map', workspaceId: 'map' })
	expect(changed.ok).toBe(true)
	acknowledged = false
	await execute(changed)
	expect(grantedSources).toHaveLength(1)
})

test('acknowledgement after access revocation retains delivery evidence but cannot grant source access', async () => {
	map()
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	afterCommit = () => useWebMcpStore.setState({ enabled: false })
	const result = await execute(prepared)
	expect(result.receipts[0].delivery).toBe('acknowledged')
	expect(grantedSources).toHaveLength(0)
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
	expect(grantedSources).toHaveLength(0)
})

test('empty delivery responses and post-sign failure are uncertain, idempotent, and block a fresh identical attempt', async () => {
	map()
	acknowledged = false
	const prepared = await preview({ kind: 'map', workspaceId: 'map' })
	const result = await execute(prepared)
	expect(result).toMatchObject({ ok: false, code: 'delivery_uncertain', sideEffectsApplied: true })
	expect(await execute(prepared)).toEqual(result)
	expect(grantedSources).toHaveLength(0)
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
