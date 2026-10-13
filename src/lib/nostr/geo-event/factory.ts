/** Browser publication helpers; the dataset builder also runs headlessly. */
import { DeleteFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import { assertCanDeleteOwnedEntity } from '@/lib/nostr/deletion'
import { publish } from '..'
import { getDatasetId, type GeoDatasetEvent } from './helpers'
export { GeoDatasetFactory, type BuildOptions } from './datasetFactory'

/**
 * Publish a NIP-09 deletion event for a dataset the active account owns.
 * Routes to the author's outboxes (or `config.relayUrls` in dev).
 */
export async function deleteDataset(
	dataset: GeoDatasetEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	const datasetId = getDatasetId(dataset)
	if (!datasetId) throw new Error('Dataset is missing a d tag and cannot be deleted.')
	if (!dataset.pubkey) throw new Error('Dataset is missing a pubkey and cannot be deleted.')
	await assertCanDeleteOwnedEntity(dataset, signer, 'Dataset')

	const event = await DeleteFactory.fromEvents([dataset], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
