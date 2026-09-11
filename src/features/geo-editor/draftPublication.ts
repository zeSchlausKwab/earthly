import { castEvent } from 'applesauce-core/casts'
import { accounts, eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace/projection'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'
import type {
	DatasetPublicationSnapshot,
	PublishedDatasetReference,
} from '@/features/chat/referencePublishing/types'
import { publishChannelMatchesDatasetScope } from './components/authoringDestination'
import { buildFeatureCollection, serializeBlobReferences } from './datasetDraftPayload'
import { draftContentFingerprint } from './draftContent'
import { publishFailureMessage } from './hooks/publishFailure'
import {
	useEditorStore,
	type EditorState,
	type GeoCollectionEditDraft,
	type GeoEditorWorkspace,
} from './store'

/** First publication, copies, proposals, and audience choices still need their own controls. */
export function canPublishSavedMapChanges(
	workspace: GeoEditorWorkspace | undefined,
	draft: GeoCollectionEditDraft | undefined,
	owner: string | undefined,
): boolean {
	return Boolean(
		owner &&
			workspace?.kind === 'dataset' &&
			workspace.baseRevisionId &&
			workspace.datasetKey?.startsWith(`${owner}:`) &&
			workspace.sourceId === `dataset:${workspace.datasetKey}` &&
			draft?.sourceId === workspace.sourceId &&
			draft.publishChannel.kind === 'public' &&
			draft.authoringIntent !== 'propose' &&
			draft.authoringIntent !== 'fork',
	)
}

/** Capture the clicked row, not whichever Map happens to be in the editor. */
export function captureSavedMapChanges(
	state: Pick<EditorState, 'workspaces' | 'geoEditDrafts' | 'pendingHydratedDraftId'>,
	workspaceId: string,
	owner: string | undefined,
	base: GeoDataset | null,
): DatasetPublicationSnapshot {
	const workspace = state.workspaces[workspaceId]
	const draft = state.geoEditDrafts[workspace?.activeDraftId ?? '']
	if (!owner) throw new Error('Sign in before publishing changes.')
	if (!workspace || !draft) throw new Error('This Map draft is unavailable.')
	if (!canPublishSavedMapChanges(workspace, draft, owner))
		throw new Error('Open this draft’s publishing controls to choose its publication or audience.')
	if (state.pendingHydratedDraftId === draft.id)
		throw new Error('Wait for this Map draft to finish loading, then publish again.')
	if (!base)
		throw new Error(
			'The published Map is not loaded yet. Open its published version, then try again.',
		)
	if (
		base.event.id !== workspace.baseRevisionId ||
		`${base.pubkey}:${base.dTag}` !== workspace.datasetKey ||
		base.pubkey !== owner ||
		!publishChannelMatchesDatasetScope(draft.publishChannel, {
			privateGroupId: privateWorkspaceIdForDataset(base),
			fieldSessionId: fieldSessionIdForEvent(base.event) ?? undefined,
		})
	)
		throw new Error(
			'The saved Map no longer matches its published source or audience. Reopen it before publishing.',
		)
	const featureCollection = structuredClone(buildFeatureCollection(draft))
	return {
		binding: {
			workspaceId,
			draftId: draft.id,
			sourceId: draft.sourceId,
			draftUpdatedAt: draft.updatedAt,
			contentFingerprint: draftContentFingerprint(draft),
			baseCoordinate: `${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`,
		},
		authoringIntent: 'edit',
		sourceDataset: draft.sourceDataset ? structuredClone(draft.sourceDataset) : undefined,
		title: draft.collectionMeta.name || draft.name || 'Untitled Map',
		publishChannel: { kind: 'public' },
		featureCollection,
		contextReferences: [...draft.contextRefs],
		blobReferences: serializeBlobReferences(draft),
		featureIds: featureCollection.features.flatMap((feature) =>
			feature.id == null ? [] : [String(feature.id)],
		),
		baseEvent: structuredClone(base.event),
	}
}

type SnapshotPublisher = (
	snapshot: DatasetPublicationSnapshot,
	validate: () => void,
) => Promise<PublishedDatasetReference>

const publishSnapshot: SnapshotPublisher = async (snapshot, validate) => {
	const { publishCapturedPublicDataset } = await import(
		'@/features/chat/referencePublishing/publishCapturedDataset'
	)
	return publishCapturedPublicDataset(snapshot, validate)
}

/** No routing or editor activation. The shared publisher advances only this draft's baseline. */
export async function publishSavedMapChanges(
	workspaceId: string,
	publisher: SnapshotPublisher = publishSnapshot,
): Promise<void> {
	const state = useEditorStore.getState()
	if (state.isPublishing)
		throw new Error('Another Map is publishing. Please wait for it to finish.')
	const owner = accounts.active?.pubkey
	const workspace = state.workspaces[workspaceId]
	const source = workspace?.baseRevisionId
		? eventStore.getEvent(workspace.baseRevisionId)
		: undefined
	const snapshot = captureSavedMapChanges(
		state,
		workspaceId,
		owner,
		source ? castEvent(source, GeoDataset, eventStore) : null,
	)
	const validate = () => {
		const latest = useEditorStore.getState()
		const currentWorkspace = latest.workspaces[workspaceId]
		const currentDraft = latest.geoEditDrafts[snapshot.binding.draftId]
		if (accounts.active?.pubkey !== owner)
			throw new Error('The account changed. Reopen Drafts and try again.')
		if (
			!currentWorkspace ||
			!currentDraft ||
			currentWorkspace.baseRevisionId !== snapshot.baseEvent?.id ||
			!canPublishSavedMapChanges(currentWorkspace, currentDraft, owner)
		)
			throw new Error('This Map’s publication or audience changed. Reopen Drafts and try again.')
	}
	state.setIsPublishing(true)
	try {
		await publisher(snapshot, validate)
	} catch (error) {
		throw new Error(publishFailureMessage('publish these Map changes', error, 'Publish changes'))
	} finally {
		useEditorStore.getState().setIsPublishing(false)
	}
}
