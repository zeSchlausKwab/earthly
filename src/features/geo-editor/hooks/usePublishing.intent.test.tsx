import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { EventStore } from 'applesauce-core'
import { castEvent } from 'applesauce-core/casts'
import type { EventSigner } from 'applesauce-core/factories/types'
import { parseHTML } from 'linkedom'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools'
import type { Root } from 'react-dom/client'
import type { MapAuthoringIntent } from '@/components/info-panel/mapProposalPresentation'
import { GEO_EDIT_PROPOSAL_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoEditor, EditorFeature } from '../core'
import type { GeoCollectionEditDraft, PublishChannel } from '../store'

// Real event factories + signing, entirely local event store and publisher.
const testStore = new EventStore()
const contributorKey = generateSecretKey()
const ownerKey = generateSecretKey()
const contributor = getPublicKey(contributorKey)
const owner = getPublicKey(ownerKey)
const published: Array<{ event: NostrEvent; options: unknown }> = []
let signingKey = contributorKey
const signer: EventSigner = {
	getPublicKey: () => getPublicKey(signingKey),
	signEvent: (event) => finalizeEvent(event, signingKey),
}
const originalNostrExports = { ...(await import('@/lib/nostr')) }
mock.module('@/lib/nostr', () => ({
	...originalNostrExports,
	accounts: { signer },
	eventStore: testStore,
	publish: async (event: NostrEvent, options: unknown) => {
		published.push({ event, options })
	},
}))
mock.module('sonner', () => ({ toast: { success() {}, error() {} } }))

let act: typeof import('react').act
let createElement: typeof import('react').createElement
let createRoot: typeof import('react-dom/client').createRoot
let usePublishing: typeof import('./usePublishing').usePublishing
let useEditorStore: typeof import('../store').useEditorStore
let Dataset: typeof import('@/lib/nostr/geo-event').GeoDataset
let initialState: ReturnType<typeof import('../store').useEditorStore.getState>
const mounted: Root[] = []
const feature: EditorFeature = {
	type: 'Feature',
	id: 'local-edit',
	geometry: { type: 'Point', coordinates: [16, 48] },
	properties: { name: 'Local edit' },
}

async function flush(action: () => void | Promise<void>) {
	await act(async () => {
		await action()
	})
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
		},
	})
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
	})
	;(
		globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true
	;({ act, createElement } = await import('react'))
	;({ createRoot } = await import('react-dom/client'))
	;({ usePublishing } = await import('./usePublishing'))
	;({ useEditorStore } = await import('../store'))
	;({ GeoDataset: Dataset } = await import('@/lib/nostr/geo-event'))
	initialState = useEditorStore.getState()
})

beforeEach(() => {
	published.length = 0
	signingKey = contributorKey
	useEditorStore.setState(initialState, true)
})

afterEach(async () => {
	await flush(() => {
		for (const root of mounted.splice(0)) root.unmount()
	})
	useEditorStore.setState(initialState, true)
	document.body.replaceChildren()
})

function installDraft(
	intent: MapAuthoringIntent,
	publishChannel: PublishChannel = { kind: 'public' },
	sourceTags: string[][] = [],
) {
	const event = finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: 10,
			tags: [['d', 'source-map'], ...sourceTags],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: 'Source map',
				features: [feature],
			}),
		},
		ownerKey,
	)
	const dataset = castEvent(event, Dataset, testStore)
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: 'chosen-draft',
		sourceId: `${intent === 'fork' ? 'fork' : 'dataset'}:${owner}:source-map`,
		authoringIntent: intent,
		sourceDataset: {
			address: `${GEO_EVENT_KIND}:${owner}:source-map`,
			pubkey: owner,
			identifier: 'source-map',
			eventId: event.id,
		},
		name: 'Local work',
		description: '',
		collectionMeta: { name: 'Local work', description: '', color: '#334455', customProperties: {} },
		features: [feature],
		selectedFeatureIds: [],
		publishChannel,
		contextRefs: [],
		blobReferences: [],
		createdAt: 10,
		updatedAt: 10,
	}
	useEditorStore.setState({
		editor: {
			getMode: () => 'select',
			setMode() {},
			setInteractionEnabled() {},
		} as unknown as GeoEditor,
		features: draft.features,
		collectionMeta: draft.collectionMeta,
		activeDataset: dataset,
		isDirty: true,
		geoEditDrafts: { [draft.id]: draft },
		activeGeoEditDraftId: draft.id,
		workspaces: {
			workspace: {
				id: 'workspace',
				sourceId: draft.sourceId,
				label: draft.name,
				kind: 'dataset',
				datasetKey: `${owner}:source-map`,
				baseRevisionId: event.id,
				activeDraftId: draft.id,
				chatSessionId: null,
				createdAt: 10,
				updatedAt: 10,
			},
		},
		activeWorkspaceId: 'workspace',
	})
	return { dataset, draft }
}

async function mountHook(options: Partial<Parameters<typeof usePublishing>[0]> = {}) {
	let latest: ReturnType<typeof usePublishing> | undefined
	function Probe() {
		latest = usePublishing({
			currentUserPubkey: contributor,
			getDatasetName: () => 'Map',
			getDatasetKey: (event: GeoDataset) => `${event.pubkey}:${event.dTag}`,
			groups: [],
			...options,
		})
		return null
	}
	const container = document.createElement('div')
	document.body.append(container)
	const root = createRoot(container)
	mounted.push(root)
	await flush(() => root.render(createElement(Probe)))
	return () => {
		if (!latest) throw new Error('Hook not mounted')
		return latest
	}
}

describe('saved Map intent controls publication', () => {
	test('a materialized fork can publish without resolving its original Map, and only as a new copy', async () => {
		const { draft } = installDraft('fork')
		useEditorStore.setState({ activeDataset: null })
		const current = await mountHook()
		expect(current().canPublishCopy).toBe(true)
		expect(current().canPublishNew).toBe(false)
		expect(current().canPublishUpdate).toBe(false)
		expect(current().canProposeEdit).toBe(false)
		await flush(async () => {
			await current().handlePublishCopy()
		})
		expect(published).toHaveLength(1)
		expect(useEditorStore.getState().publishError).toBeNull()
		expect(published[0]?.event.tags).toContainEqual(['a', draft.sourceDataset?.address ?? ''])
	})

	test('missing proposal and owner sources stay blocked rather than becoming new maps', async () => {
		for (const intent of ['propose', 'edit'] as const) {
			await flush(() => {
				installDraft(intent)
				useEditorStore.setState({ activeDataset: null })
			})
			const current = await mountHook({
				currentUserPubkey: intent === 'edit' ? owner : contributor,
			})
			expect(current().canPublishCopy).toBe(false)
			expect(current().canPublishUpdate).toBe(false)
			expect(current().canPublishNew).toBe(false)
			expect(current().canProposeEdit).toBe(false)
			await flush(async () => {
				await current().handlePublishCopy()
				await current().handlePublishNew()
			})
		}
		expect(published).toHaveLength(0)
	})

	test('a source-missing private fork cannot use a public or wrong-circle publisher unless the destination is explicitly changed', async () => {
		installDraft('fork', { kind: 'private-group', id: 'original-circle' })
		useEditorStore.setState({ activeDataset: null })
		const current = await mountHook()
		expect(current().canPublishCopy).toBe(false)
		await flush(async () => {
			await current().handlePublishCopy()
		})
		expect(published).toHaveLength(0)
		const wrongScope = mock(async () => {
			throw new Error('Wrong Circle must not receive this draft')
		})
		const wrong = await mountHook({
			privateWorkspaceId: 'other-circle',
			publishPrivateDataset: wrongScope,
		})
		expect(wrong().canPublishCopy).toBe(false)
		await flush(async () => {
			await wrong().handlePublishCopy()
		})
		expect(wrongScope).not.toHaveBeenCalled()
		await flush(() => {
			useEditorStore
				.getState()
				.saveGeoEditDraft('chosen-draft', { publishChannel: { kind: 'public' } })
		})
		expect(current().canPublishCopy).toBe(true)
		await flush(async () => {
			await current().handlePublishCopy()
		})
		expect(published).toHaveLength(1)
		expect(useEditorStore.getState().publishError).toBeNull()
	})

	test('proposal dispatch targets the saved original owner and base event; other dispatches cannot publish', async () => {
		const { draft } = installDraft('propose')
		const current = await mountHook()
		expect(current().canProposeEdit).toBe(true)
		expect(current().canPublishCopy).toBe(false)
		await flush(async () => {
			await current().handlePublishCopy()
			await current().handlePublishNew()
			await current().handlePublishUpdate()
			await current().handlePublishWithBlossomUpload({
				sha256: 'abc',
				url: 'https://example.invalid/blob',
				size: 1,
			})
		})
		expect(published).toHaveLength(0)
		await flush(async () => {
			await current().handleProposeEdit('Fix geometry')
		})
		expect(published).toHaveLength(1)
		expect(useEditorStore.getState().publishError).toBeNull()
		expect(published[0]?.options).toEqual({ routing: 'inbox', target: owner })
		expect(published[0]?.event.kind).toBe(GEO_EDIT_PROPOSAL_KIND)
		expect(published[0]?.event.tags).toContainEqual(['a', draft.sourceDataset?.address ?? ''])
		expect(published[0]?.event.tags).toContainEqual([
			'base-version',
			draft.sourceDataset?.eventId ?? '',
		])
		expect(JSON.parse(published[0]?.event.content ?? '{}').features[0].id).toBe('local-edit')
	})

	test('fork publishes a new owned Map with source provenance, then becomes an owner edit', async () => {
		const { draft } = installDraft('fork')
		const current = await mountHook()
		expect(current().canPublishCopy).toBe(true)
		expect(current().canProposeEdit).toBe(false)
		await flush(async () => {
			await current().handleProposeEdit('Must not send')
		})
		expect(published).toHaveLength(0)
		await flush(async () => {
			await current().handlePublishCopy()
		})
		expect(published).toHaveLength(1)
		expect(useEditorStore.getState().publishError).toBeNull()
		const copied = published[0]?.event
		expect(copied?.kind).toBe(GEO_EVENT_KIND)
		expect(copied?.pubkey).toBe(contributor)
		expect(copied?.tags.find(([tag]) => tag === 'd')?.[1]).not.toBe('source-map')
		expect(copied?.tags).toContainEqual(['a', draft.sourceDataset?.address ?? ''])
		expect(published[0]?.options).toEqual({ routing: 'outbox' })
		expect(useEditorStore.getState().geoEditDrafts[draft.id]?.authoringIntent).toBe('edit')
		expect(useEditorStore.getState().activeDataset?.pubkey).toBe(contributor)
		await flush(() => {
			useEditorStore.getState().setIsDirty(true)
		})
		await flush(async () => {
			await current().handlePublishUpdate()
		})
		expect(published).toHaveLength(2)
		expect(useEditorStore.getState().publishError).toBeNull()
		expect(published[1]?.event.tags).toContainEqual(['a', draft.sourceDataset?.address ?? ''])
		expect(published[1]?.event.tags.find(([tag]) => tag === 'd')?.[1]).toBe(
			copied?.tags.find(([tag]) => tag === 'd')?.[1],
		)
	})

	test('owner editing retains update and publish-as-new, with update preserving the address', async () => {
		installDraft('edit')
		signingKey = ownerKey
		const current = await mountHook({ currentUserPubkey: owner })
		expect(current().canPublishUpdate).toBe(true)
		expect(current().canPublishCopy).toBe(true)
		await flush(async () => {
			await current().handlePublishUpdate()
		})
		expect(published).toHaveLength(1)
		expect(useEditorStore.getState().publishError).toBeNull()
		expect(published[0]?.event.pubkey).toBe(owner)
		expect(published[0]?.event.tags).toContainEqual(['d', 'source-map'])
	})

	test('a persisted scoped proposal cannot escape through an accidentally public hook', async () => {
		for (const kind of ['private-group', 'field-session'] as const) {
			await flush(() => {
				installDraft('propose', { kind, id: 'private-scope' })
			})
			const current = await mountHook()
			expect(current().canProposeEdit).toBe(false)
			await flush(async () => {
				await current().handleProposeEdit('No public write')
			})
		}
		expect(published).toHaveLength(0)
	})

	test('scope drift and foreign target substitution are rejected at dispatch', async () => {
		installDraft('propose')
		const scopedPublish = mock(async () => {
			throw new Error('Must not publish')
		})
		const scoped = await mountHook({
			privateWorkspaceId: 'scope',
			publishPrivateDataset: scopedPublish,
		})
		await flush(async () => {
			await scoped().handleProposeEdit('No scope drift')
		})
		expect(scopedPublish).not.toHaveBeenCalled()
		const current = await mountHook()
		await flush(() => {
			const state = useEditorStore.getState()
			const source = state.geoEditDrafts['chosen-draft']?.sourceDataset
			if (!source) throw new Error('Expected a saved proposal target')
			state.saveGeoEditDraft('chosen-draft', {
				sourceDataset: {
					...source,
					pubkey: 'wrong-owner',
				},
			})
		})
		await flush(async () => {
			await current().handleProposeEdit('No target substitution')
		})
		expect(published).toHaveLength(0)
	})

	test('private fork dispatch stays in the scoped publisher and never reaches public relays', async () => {
		const { dataset, draft } = installDraft('fork', { kind: 'private-group', id: 'scope' })
		const scopedPublish = mock(async () => dataset)
		const current = await mountHook({
			privateWorkspaceId: 'scope',
			publishPrivateDataset: scopedPublish,
		})
		expect(current().canPublishCopy).toBe(true)
		await flush(async () => {
			await current().handlePublishCopy()
		})
		expect(scopedPublish).toHaveBeenCalledTimes(1)
		expect(useEditorStore.getState().publishError).toBeNull()
		expect(published).toHaveLength(0)
		expect(useEditorStore.getState().geoEditDrafts[draft.id]?.publishChannel).toEqual({
			kind: 'private-group',
			id: 'scope',
		})
	})

	test('a stale callback cannot publish another draft after the active draft switches', async () => {
		const { draft } = installDraft('propose')
		const current = await mountHook()
		const stale = current().handleProposeEdit
		await flush(() => {
			useEditorStore.setState({
				geoEditDrafts: { [draft.id]: draft, other: { ...draft, id: 'other' } },
				activeGeoEditDraftId: 'other',
			})
		})
		await flush(async () => {
			await stale('Wrong active draft')
		})
		expect(published).toHaveLength(0)
	})
})
