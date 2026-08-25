import { castEvent } from 'applesauce-core/casts'
import type { FeatureCollection } from 'geojson'
import { accounts, eventStore, publish } from '@/lib/nostr'
import { GeoDataset, GeoDatasetFactory, type GeoBlobReference } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	coordinateToNaddrReference,
	extractReferencedCoordinates,
	setAddressReferenceTags,
} from '@/lib/nostr/references'
import { noteSessionPublish } from '@/lib/nostr/sessionPublishes'
import { useEditorStore } from '@/features/geo-editor/store'
import type {
	CapturedDatasetPublication,
	DatasetPublicationMode,
	PublishedDatasetReference,
} from './types'

function collectionDescription(collection: FeatureCollection): string {
	const candidate = collection as FeatureCollection & {
		description?: unknown
		properties?: Record<string, unknown>
	}
	if (typeof candidate.description === 'string') return candidate.description
	return typeof candidate.properties?.description === 'string'
		? candidate.properties.description
		: ''
}

function buildCollectionStub(
	collection: FeatureCollection,
	url: string,
): FeatureCollection & { name?: string; description?: string; properties?: object } {
	const source = collection as FeatureCollection & {
		name?: string
		description?: string
		properties?: object
	}
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'external-geometry-placeholder',
				geometry: null,
				properties: { externalPlaceholder: true, blobUrl: url, name: 'External geometry' },
			} as unknown as FeatureCollection['features'][number],
		],
		...(source.name ? { name: source.name } : {}),
		...(source.description ? { description: source.description } : {}),
		...(source.properties ? { properties: source.properties } : {}),
	}
}

function applyBlobStrategy(
	factory: GeoDatasetFactory,
	collection: FeatureCollection,
	blobReferences: GeoBlobReference[],
): GeoDatasetFactory {
	const collectionBlob = blobReferences.find(
		(reference) => reference.scope === 'collection' && reference.url,
	)
	if (!collectionBlob) return factory.withDerivedMetadata()
	return factory
		.withSpatialMetadata()
		.content(JSON.stringify(buildCollectionStub(collection, collectionBlob.url)))
		.withContentMetadata()
}

export function reconcilePublishedDatasetIdentity(
	captured: CapturedDatasetPublication,
	dataset: GeoDataset,
): void {
	const state = useEditorStore.getState()
	const currentDraft = state.geoEditDrafts[captured.binding.draftId]
	const currentWorkspace = state.workspaces[captured.binding.workspaceId]
	if (
		!currentDraft ||
		!currentWorkspace ||
		currentWorkspace.activeDraftId !== captured.binding.draftId ||
		currentDraft.sourceId !== captured.binding.sourceId ||
		currentWorkspace.sourceId !== captured.binding.sourceId
	) {
		return
	}
	const draftWasUnchanged = currentDraft?.updatedAt === captured.binding.draftUpdatedAt
	const datasetKey = `${dataset.pubkey}:${dataset.dTag}`
	const sourceId = `dataset:${datasetKey}`
	const siblingDraft = Object.values(state.geoEditDrafts)
		.filter((draft) => draft.id !== currentDraft.id && draft.sourceId === captured.binding.sourceId)
		.sort((a, b) => b.updatedAt - a.updatedAt)[0]
	const previousWorkspaceIdentity = {
		sourceId: currentWorkspace.sourceId,
		kind: currentWorkspace.kind,
		datasetKey: currentWorkspace.datasetKey,
		baseRevisionId: currentWorkspace.baseRevisionId,
	}

	state.saveGeoEditDraft(currentDraft.id, { sourceId })
	state.updateWorkspace(currentWorkspace.id, {
		sourceId,
		kind: 'dataset',
		datasetKey,
		baseRevisionId: dataset.event.id,
		label: captured.title,
	})
	if (siblingDraft && previousWorkspaceIdentity.sourceId !== sourceId) {
		// Publishing a new/copy address moves only the captured revision. Keep
		// sibling local drafts reachable under their original source instead of
		// silently orphaning them when this workspace changes identity.
		state.createWorkspace({
			sourceId: previousWorkspaceIdentity.sourceId,
			label: siblingDraft.collectionMeta.name || siblingDraft.name || currentWorkspace.label,
			kind: previousWorkspaceIdentity.kind,
			datasetKey: previousWorkspaceIdentity.datasetKey,
			baseRevisionId: previousWorkspaceIdentity.baseRevisionId,
			activeDraftId: siblingDraft.id,
			chatSessionId: null,
			activate: false,
		})
	}

	const latest = useEditorStore.getState()
	const stillDisplayed =
		latest.activeWorkspaceId === captured.binding.workspaceId &&
		(latest.activeGeoEditDraftId === captured.binding.draftId ||
			latest.workspaces[captured.binding.workspaceId]?.activeDraftId === captured.binding.draftId)
	if (!stillDisplayed) return

	// Updating the identity is safe while the user looks elsewhere. Updating the
	// displayed dataset is safe only when the exact captured draft is still the
	// displayed one. New edits made while the dialog was open remain dirty.
	latest.setActiveDataset(dataset)
	latest.setIsDirty(!draftWasUnchanged)
}

/** Publish the immutable payload captured at gate creation, never live editor state. */
export async function publishCapturedPublicDataset(
	captured: CapturedDatasetPublication,
): Promise<PublishedDatasetReference> {
	if (captured.publishChannel.kind !== 'public') {
		throw new Error('A public reference cannot expose a private or nearby Dataset draft.')
	}
	if (captured.featureCollection.features.length === 0) {
		throw new Error('Draw or import geometry before publishing this Dataset.')
	}

	const signer = accounts.signer
	if (!signer) throw new Error('Sign in before publishing this Dataset.')
	const signerPubkey = await signer.getPublicKey()
	const base = captured.baseEvent
	const mode: DatasetPublicationMode = !base
		? 'new'
		: base.pubkey === signerPubkey
			? 'update'
			: 'copy'
	const referencedCoordinates = extractReferencedCoordinates(
		collectionDescription(captured.featureCollection),
	)

	let factory =
		mode === 'update' && base
			? GeoDatasetFactory.update(
					base as Parameters<typeof GeoDatasetFactory.update>[0],
					captured.featureCollection,
				)
					.hashtags(
						base.tags
							.filter((tag) => tag[0] === 't')
							.map((tag) => tag[1])
							.filter(Boolean) as string[],
					)
					.collectionReferences(
						base.tags
							.filter((tag) => tag[0] === 'collection')
							.map((tag) => tag[1])
							.filter(Boolean) as string[],
					)
					.relayHints(
						base.tags
							.filter((tag) => tag[0] === 'r')
							.map((tag) => tag[1])
							.filter(Boolean) as string[],
					)
			: GeoDatasetFactory.create(captured.featureCollection)

	factory = factory
		.contextReferences(captured.contextReferences)
		.blobReferences(captured.blobReferences)
		.modifyPublicTags(setAddressReferenceTags(referencedCoordinates))
	factory = applyBlobStrategy(factory, captured.featureCollection, captured.blobReferences)

	const signed = await factory.sign(signer)
	await publish(signed, { routing: 'outbox' })
	const dataset = castEvent(signed, GeoDataset, eventStore)
	const coordinate = `${GEO_EVENT_KIND}:${dataset.pubkey}:${dataset.dTag}`
	const mention = coordinateToNaddrReference(coordinate)
	if (!mention) throw new Error('The published Dataset did not produce a referenceable address.')

	noteSessionPublish({ type: 'dataset', name: captured.title, coordinate })
	reconcilePublishedDatasetIdentity(captured, dataset)
	return {
		mode,
		datasetCoordinate: coordinate,
		datasetMention: mention,
		featureIds: captured.featureIds,
		addressChanged: captured.binding.baseCoordinate !== coordinate,
		eventId: signed.id,
	}
}
