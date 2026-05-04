/**
 * Factory + delete helper for kind 37515 (GeoJSON Data Event).
 *
 * The factory composes operations on an event template and produces a signed
 * NostrEvent at the end of the chain. To publish:
 *
 *     const event = await GeoDatasetFactory.create(fc).hashtags(['nature']).sign(signer)
 *     await publish(event, { routing: 'outbox' })
 *
 * Or, when sharing a signer across the chain:
 *
 *     await GeoDatasetFactory.create(fc).as(signer).hashtags(['nature']).sign()
 */

import {
	blankEventTemplate,
	DeleteFactory,
	EventFactory,
	toEventTemplate,
} from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import type { FeatureCollection } from 'geojson'
import { generateShortDTag } from '@/lib/ndk/dTag'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
import { publish } from '..'
import {
	blobReferenceToTag,
	computeBboxFor,
	computeChecksum,
	computeGeohashFor,
	getDatasetId,
	getVersion,
	isGeoDataset,
	withoutTags,
	type GeoBlobReference,
	type GeoDatasetEvent,
} from './helpers'

const DERIVED_TAG_NAMES = ['bbox', 'g', 'checksum', 'size']

export interface BuildOptions {
	/** Skip recomputing bbox/geohash/size/checksum from content. Use when
	 *  publishing a stub event whose content is a placeholder, not the real data. */
	skipMetadataUpdate?: boolean
}

export class GeoDatasetFactory extends EventFactory<typeof GEO_EVENT_KIND> {
	/** Start a new dataset event from a FeatureCollection. */
	static create(fc: FeatureCollection): GeoDatasetFactory {
		return new GeoDatasetFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_EVENT_KIND)
			tpl.content = JSON.stringify(fc)
			// blankEventTemplate may already include a random `d`; only add one
			// if it's missing.
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			resolve(tpl)
		})
	}

	/** Continue editing an existing dataset event (preserves d-tag). */
	static modify(event: GeoDatasetEvent): GeoDatasetFactory {
		if (!isGeoDataset(event)) {
			throw new Error('GeoDatasetFactory.modify: event is not a kind 37515 dataset')
		}
		return new GeoDatasetFactory((resolve) => resolve(toEventTemplate(event)))
	}

	/**
	 * Branch off the previous version: keep the same d-tag, increment the `v`
	 * tag, and add a `p` reference back to the previous event id.
	 */
	static update(previous: GeoDatasetEvent, fc: FeatureCollection): GeoDatasetFactory {
		const datasetId = getDatasetId(previous)
		if (!datasetId) {
			throw new Error('Cannot update a dataset that has no d-tag')
		}
		const prevVersion = Number(getVersion(previous) ?? '0')
		const nextVersion = Number.isNaN(prevVersion) ? 1 : prevVersion + 1

		return new GeoDatasetFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_EVENT_KIND)
			tpl.content = JSON.stringify(fc)
			tpl.tags = [
				['d', datasetId],
				['v', String(nextVersion)],
				['p', previous.id],
			]
			resolve(tpl)
		})
	}

	// ---- Builder methods ----

	/** Replace the content with a new FeatureCollection (does not auto-recompute metadata). */
	featureCollection(fc: FeatureCollection): this {
		return this.content(JSON.stringify(fc))
	}

	/** Replace the bbox tag explicitly. */
	bbox(box: [number, number, number, number] | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'bbox')
			if (!box) return filtered
			return [...filtered, ['bbox', box.join(',')]]
		})
	}

	/** Replace the geohash tag. */
	geohash(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'g')
			return value ? [...filtered, ['g', value]] : filtered
		})
	}

	/** Replace all `t` (hashtag) tags. */
	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 't'),
			...values.map((value) => ['t', value]),
		])
	}

	/** Replace all `c` (context) reference tags. */
	contextReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'c'),
			...values.filter(Boolean).map((value) => ['c', value]),
		])
	}

	/** Replace all `collection` reference tags. */
	collectionReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'collection'),
			...values.map((value) => ['collection', value]),
		])
	}

	/** Replace all `r` (relay hint) tags. */
	relayHints(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'r'),
			...values.map((value) => ['r', value]),
		])
	}

	/** Replace all `blob` references. */
	blobReferences(refs: GeoBlobReference[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 'blob'),
			...refs
				.map((ref) => blobReferenceToTag(ref))
				.filter((tag): tag is string[] => tag !== null),
		])
	}

	/** Set the `crs` tag (coordinate reference system). */
	crs(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'crs')
			return value ? [...filtered, ['crs', value]] : filtered
		})
	}

	/**
	 * Recompute bbox, geohash, size, and checksum from the current content.
	 * Call this LAST in the chain (or just before .sign()) so that any other
	 * tag mutations don't get clobbered. Replaces existing derived tags.
	 */
	withDerivedMetadata(precision = 6): this {
		return this.chain(async (tpl) => {
			let fc: FeatureCollection
			try {
				fc = JSON.parse(tpl.content) as FeatureCollection
			} catch {
				return tpl
			}
			const computedBbox = computeBboxFor(fc)
			const computedGeohash = computeGeohashFor(fc, precision)
			const checksum = await computeChecksum(tpl.content)
			const size = new TextEncoder().encode(tpl.content).length

			const newTags: string[][] = withoutTags(DERIVED_TAG_NAMES)(tpl.tags)
			if (computedBbox) newTags.push(['bbox', computedBbox.join(',')])
			if (computedGeohash) newTags.push(['g', computedGeohash])
			if (checksum) newTags.push(['checksum', checksum])
			newTags.push(['size', String(size)])

			return { ...tpl, tags: newTags }
		})
	}
}

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

	const event = await DeleteFactory.fromEvents([dataset], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
