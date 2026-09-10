import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ReadonlyAccount } from 'applesauce-accounts/accounts'
import { castEvent } from 'applesauce-core/casts'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { accounts, eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	canPublishSavedMapChanges,
	captureSavedMapChanges,
	publishSavedMapChanges,
} from './draftPublication'
import { datasetDraftHasChanges, draftContentFingerprint } from './draftContent'
import { reconcilePublishedDatasetIdentity } from './publicationIdentity'
import { useEditorStore, type GeoCollectionEditDraft, type GeoEditorWorkspace } from './store'

const initial = useEditorStore.getState()
const originalAccount = accounts.active
const secret = generateSecretKey()
const owner = getPublicKey(secret)
const account = ReadonlyAccount.fromPubkey<{ ephemeral?: boolean }>(owner)
const sourceId = `dataset:${owner}:survey`
const draft: GeoCollectionEditDraft = {
	persistenceVersion: 2,
	id: 'draft',
	sourceId,
	name: 'Survey',
	description: '',
	collectionMeta: { name: 'Survey', description: '', color: '#334455', customProperties: {} },
	features: [
		{
			type: 'Feature',
			id: 'site',
			geometry: { type: 'Point', coordinates: [16, 48] },
			properties: { name: 'New site' },
		},
	],
	selectedFeatureIds: [],
	publishChannel: { kind: 'public' },
	contextRefs: [],
	blobReferences: [],
	createdAt: 10,
	updatedAt: 20,
}
let revisionTime = 100
function dataset(title = 'Published survey', tags: string[][] = []): GeoDataset {
	const event = finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: revisionTime++,
			tags: [['d', 'survey'], ...tags],
			content: JSON.stringify({ type: 'FeatureCollection', name: title, features: draft.features }),
		},
		secret,
	)
	eventStore.add(event)
	return castEvent(event, GeoDataset, eventStore)
}
let base: GeoDataset
let workspace: GeoEditorWorkspace
beforeEach(() => {
	useEditorStore.setState(initial, true)
	accounts.active$.next(account)
	base = dataset()
	workspace = {
		id: 'work',
		sourceId,
		datasetKey: `${owner}:survey`,
		kind: 'dataset',
		baseRevisionId: base.event.id,
		publishedContentFingerprint: 'old-baseline',
		label: 'Survey',
		activeDraftId: draft.id,
		chatSessionId: 'keep-this-chat',
		createdAt: 10,
		updatedAt: 20,
	}
	useEditorStore.setState({
		workspaces: { work: workspace },
		geoEditDrafts: { draft: structuredClone(draft) },
		// A different Map is visible; publication must never activate the clicked one.
		activeWorkspaceId: 'other',
		activeGeoEditDraftId: 'other-draft',
	})
})
afterEach(() => {
	useEditorStore.setState(initial, true)
	accounts.active$.next(originalAccount)
})

describe('one-click publishing of saved Map changes (no relay writes)', () => {
	test('captures the selected draft without activating it or attaching a Chat operation', () => {
		const snapshot = captureSavedMapChanges(useEditorStore.getState(), 'work', owner, base)
		expect(snapshot.title).toBe('Survey')
		expect(snapshot.featureCollection.features).toHaveLength(1)
		expect(snapshot.binding).toMatchObject({
			workspaceId: 'work',
			draftId: 'draft',
			contentFingerprint: draftContentFingerprint(draft),
		})
		expect(snapshot.binding).not.toHaveProperty('chatId')
		useEditorStore.getState().saveGeoEditDraft('draft', { features: [] })
		expect(snapshot.featureCollection.features).toHaveLength(1)
		expect(useEditorStore.getState().activeWorkspaceId).toBe('other')
	})
	test('new, foreign, proposal, fork, private, and unresolved drafts do not get a direct public update', () => {
		expect(canPublishSavedMapChanges(workspace, draft, owner)).toBe(true)
		expect(canPublishSavedMapChanges(workspace, draft, 'b'.repeat(64))).toBe(false)
		expect(canPublishSavedMapChanges({ ...workspace, baseRevisionId: null }, draft, owner)).toBe(
			false,
		)
		for (const intent of ['fork', 'propose'] as const)
			expect(
				canPublishSavedMapChanges(workspace, { ...draft, authoringIntent: intent }, owner),
			).toBe(false)
		for (const publishChannel of [
			{ kind: 'private-group', id: 'secret' },
			{ kind: 'field-session', id: 'nearby' },
			{ kind: 'unresolved', reason: 'legacy' },
		] as const)
			expect(canPublishSavedMapChanges(workspace, { ...draft, publishChannel }, owner)).toBe(false)
	})
	test('missing or mismatched published revisions fail instead of creating a new Map', () => {
		expect(() => captureSavedMapChanges(useEditorStore.getState(), 'work', owner, null)).toThrow(
			'not loaded',
		)
		expect(() =>
			captureSavedMapChanges(useEditorStore.getState(), 'work', owner, dataset('Other revision')),
		).toThrow('published source')
		useEditorStore.setState({ pendingHydratedDraftId: 'draft' })
		expect(() => captureSavedMapChanges(useEditorStore.getState(), 'work', owner, base)).toThrow(
			'finish loading',
		)
	})
	test('publishes in one call, keeps navigation/chat, and advances only the captured baseline', async () => {
		let calls = 0
		await publishSavedMapChanges('work', async (snapshot, validate) => {
			calls++
			validate()
			expect(useEditorStore.getState().isPublishing).toBe(true)
			// A later edit is not part of the in-flight publication.
			useEditorStore.getState().saveGeoEditDraft('draft', {
				collectionMeta: { ...draft.collectionMeta, name: 'Later edit' },
			})
			validate()
			reconcilePublishedDatasetIdentity(snapshot.binding, dataset('Survey'), 'Survey')
			return {
				mode: 'update',
				datasetCoordinate: snapshot.binding.baseCoordinate!,
				datasetMention: 'nostr:naddr',
				featureIds: ['site'],
				addressChanged: false,
				eventId: 'published',
			}
		})
		expect(calls).toBe(1)
		const after = useEditorStore.getState()
		expect(after.isPublishing).toBe(false)
		expect(after.activeWorkspaceId).toBe('other')
		expect(after.workspaces.work!.chatSessionId).toBe('keep-this-chat')
		expect(datasetDraftHasChanges(after.workspaces.work!, after.geoEditDrafts.draft!)).toBe(true)
	})
	test('a rejection retains the unpublished baseline and releases the lock for a retry', async () => {
		await expect(
			publishSavedMapChanges('work', async () => {
				throw new Error('Relay rejected update')
			}),
		).rejects.toThrow('Publish changes to retry')
		expect(useEditorStore.getState().isPublishing).toBe(false)
		expect(useEditorStore.getState().workspaces.work!.publishedContentFingerprint).toBe(
			'old-baseline',
		)
	})
	test('another click cannot publish concurrently; changed accounts fail validation', async () => {
		await expect(
			publishSavedMapChanges('work', async (_snapshot, validate) => {
				await expect(publishSavedMapChanges('work')).rejects.toThrow('Another Map is publishing')
				accounts.active$.next(undefined)
				validate()
				throw new Error('Validation should reject the account change')
			}),
		).rejects.toThrow('account changed')
		expect(useEditorStore.getState().isPublishing).toBe(false)
	})
})
