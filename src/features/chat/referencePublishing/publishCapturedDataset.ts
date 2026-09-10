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
import { reconcilePublishedDatasetIdentity } from '@/features/geo-editor/publicationIdentity'
import { useEditorStore } from '@/features/geo-editor/store'
import type {
	DatasetPublicationSnapshot,
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

/** Intent, not source ownership, decides whether a captured fork gets a new address. */
export function capturedDatasetPublicationMode(
	captured: DatasetPublicationSnapshot,
	signerPubkey: string,
): DatasetPublicationMode {
	if (captured.authoringIntent === 'propose') {
		throw new Error(
			'A proposal cannot be published as an independent Map reference. Send the proposal or explicitly start a fork.',
		)
	}
	if (captured.authoringIntent === 'fork') return 'copy'
	if (!captured.baseEvent) return 'new'
	if (captured.baseEvent.pubkey === signerPubkey) return 'update'
	throw new Error(
		'Only the owner can update this Map. Explicitly start a fork before publishing a new Map reference.',
	)
}

/** Keep fork provenance in existing address-reference tags, including later owner updates. */
export function capturedDatasetReferenceCoordinates(
	captured: DatasetPublicationSnapshot,
	mode: DatasetPublicationMode,
): string[] {
	const coordinates = extractReferencedCoordinates(
		collectionDescription(captured.featureCollection),
	)
	const source = captured.sourceDataset?.address ?? captured.binding.baseCoordinate
	if (
		source &&
		(mode === 'copy' || source !== captured.binding.baseCoordinate) &&
		!coordinates.includes(source)
	) {
		coordinates.push(source)
	}
	return coordinates
}

/** Publish the immutable payload captured at gate creation, never live editor state. */
export async function publishCapturedPublicDataset(
	captured: DatasetPublicationSnapshot,
	validate: () => void = () => {},
): Promise<PublishedDatasetReference> {
	validate()
	if (captured.publishChannel.kind !== 'public') {
		throw new Error('A public reference cannot expose a private or nearby Dataset draft.')
	}
	if (captured.featureCollection.features.length === 0) {
		throw new Error('Draw or import geometry before publishing this Dataset.')
	}

	const signer = accounts.signer
	const account = accounts.active
	if (!signer) throw new Error('Sign in before publishing this Dataset.')
	const signerPubkey = await signer.getPublicKey()
	validate()
	const base = captured.baseEvent
	const mode = capturedDatasetPublicationMode(captured, signerPubkey)
	const referencedCoordinates = capturedDatasetReferenceCoordinates(captured, mode)

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
	validate()
	if (accounts.active !== account || signed.pubkey !== signerPubkey)
		throw new Error('The signing account changed. Reopen the Map and try again.')
	await publish(signed, { routing: 'outbox' })
	const dataset = castEvent(signed, GeoDataset, eventStore)
	const coordinate = `${GEO_EVENT_KIND}:${dataset.pubkey}:${dataset.dTag}`
	const mention = coordinateToNaddrReference(coordinate)
	if (!mention) throw new Error('The published Dataset did not produce a referenceable address.')

	noteSessionPublish({ type: 'dataset', name: captured.title, coordinate })
	// Publication may finish after an account switch. Never write its identity
	// into the newly active account's retained drafts.
	const reconciliation =
		accounts.active === account
			? reconcilePublishedDatasetIdentity(captured.binding, dataset, captured.title)
			: { status: 'stale-binding' as const }
	if (captured.authoringIntent === 'fork' && reconciliation.status === 'reconciled') {
		useEditorStore.getState().saveGeoEditDraft(captured.binding.draftId, {
			authoringIntent: 'edit',
			sourceDataset: captured.sourceDataset,
		})
	}
	return {
		mode,
		datasetCoordinate: coordinate,
		datasetMention: mention,
		featureIds: captured.featureIds,
		addressChanged: captured.binding.baseCoordinate !== coordinate,
		eventId: signed.id,
	}
}
