/**
 * Factory for kind 37521 (Live Beacon Event).
 *
 * `create()` injects the SPEC-03 `modelVersion` into content and generates a `d`
 * only if absent; `modify()` preserves `d` (no lineage fork, T-08-LINEAGE). Tag
 * setters delegate to the shared `tags.ts` transformers (SPEC-02). A NIP-40
 * `expiration` setter is provided since beacons are expiry-bearing.
 */

import type { MediaAttachment } from 'applesauce-common/helpers/file-metadata'
import { blankEventTemplate, toEventTemplate } from 'applesauce-core/factories'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { EntityFactory } from '@/lib/nostr/entityFactory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	setBbox,
	setContextRefs,
	setGeohash,
	setHashtags,
	setImages,
	setLabels,
	setReferencedAddresses,
} from '@/lib/nostr/tags'
import {
	DEFAULT_LIVE_BEACON_CONTENT,
	isLiveBeacon,
	type LiveBeaconContent,
	type LiveBeaconEvent,
} from './helpers'

export class LiveBeaconFactory extends EntityFactory<typeof LIVE_BEACON_KIND> {
	/** Start a new LiveBeacon from a content object. */
	static create(content: Partial<LiveBeaconContent> = {}): LiveBeaconFactory {
		return new LiveBeaconFactory((resolve) => {
			const tpl = blankEventTemplate(LIVE_BEACON_KIND)
			const { modelVersion: _ignored, ...rest } = content
			tpl.content = JSON.stringify({
				...DEFAULT_LIVE_BEACON_CONTENT,
				...rest,
				modelVersion: MODEL_VERSION,
			})
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			resolve(tpl)
		})
	}

	/** Continue editing an existing beacon (preserves d-tag). */
	static modify(event: LiveBeaconEvent): LiveBeaconFactory {
		if (!isLiveBeacon(event)) {
			throw new Error('LiveBeaconFactory.modify: event is not a kind 37521 beacon')
		}
		return new LiveBeaconFactory((resolve) => resolve(toEventTemplate(event)))
	}

	/** Replace the content payload (re-asserts modelVersion). */
	beacon(content: Partial<LiveBeaconContent>): this {
		return this.chain((tpl) => {
			let parsed: Partial<LiveBeaconContent>
			try {
				parsed = JSON.parse(tpl.content) as Partial<LiveBeaconContent>
			} catch {
				parsed = {}
			}
			return {
				...tpl,
				content: JSON.stringify({
					...DEFAULT_LIVE_BEACON_CONTENT,
					...parsed,
					...content,
					modelVersion: MODEL_VERSION,
				}),
			}
		})
	}

	/** Set the NIP-40 `expiration` timestamp (epoch seconds). Undefined removes it. */
	expiration(timestamp: number | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'expiration')
			return timestamp !== undefined ? [...filtered, ['expiration', String(timestamp)]] : filtered
		})
	}

	bbox(box: GeoBoundingBox | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setBbox(tags, box))
	}

	geohash(centroid: [number, number] | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setGeohash(tags, centroid))
	}

	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setHashtags(tags, values))
	}

	labels(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setLabels(tags, values))
	}

	contextReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setContextRefs(tags, values))
	}

	referencedAddresses(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setReferencedAddresses(tags, values))
	}

	/** Replace the NIP-92 imeta attachments (SPEC §5.1). Order: first = primary. */
	images(attachments: MediaAttachment[]): this {
		return this.modifyPublicTags((tags: string[][]) => setImages(tags, attachments))
	}
}
