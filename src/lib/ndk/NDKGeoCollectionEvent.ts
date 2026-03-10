import NDK, { NDKEvent, NDKKind, type NDKSigner, registerEventClass } from '@nostr-dev-kit/react'
import { GEO_COLLECTION_KIND } from './kinds'
import type { GeoBoundingBox } from './NDKGeoEvent'
import { generateShortDTag } from './dTag'

export interface GeoCollectionMetadata {
	name?: string
	description?: string
	picture?: string
	ownerPk?: string
	license?: string
	tags?: string[]
}

const DEFAULT_METADATA: GeoCollectionMetadata = {
	name: undefined,
	description: undefined,
	picture: undefined,
	ownerPk: undefined,
	license: undefined,
	tags: [],
}

export class NDKGeoCollectionEvent extends NDKEvent {
	static kinds = [GEO_COLLECTION_KIND]

	static from(event: NDKEvent): NDKGeoCollectionEvent {
		const wrapped = new NDKGeoCollectionEvent(event.ndk, event)
		wrapped.kind = event.kind ?? GEO_COLLECTION_KIND
		return wrapped
	}

	get metadata(): GeoCollectionMetadata {
		if (!this.content) return { ...DEFAULT_METADATA }
		try {
			const parsed = JSON.parse(this.content) as GeoCollectionMetadata
			return { ...DEFAULT_METADATA, ...parsed }
		} catch {
			return { ...DEFAULT_METADATA }
		}
	}

	set metadata(value: GeoCollectionMetadata) {
		this.content = JSON.stringify(value)
	}

	get collectionId(): string | undefined {
		return this.dTag
	}

	set collectionId(value: string | undefined) {
		this.dTag = value
	}

	get boundingBox(): GeoBoundingBox | undefined {
		const raw = this.tagValue('bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
			return undefined
		}
		return parts as GeoBoundingBox
	}

	set boundingBox(bbox: GeoBoundingBox | undefined) {
		this.replaceOptionalTag('bbox', bbox ? bbox.join(',') : undefined)
	}

	get geohash(): string | undefined {
		return this.tagValue('g')
	}

	set geohash(hash: string | undefined) {
		this.replaceOptionalTag('g', hash)
	}

	get relayHints(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'r')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set relayHints(relays: string[] | undefined) {
		this.removeTag('r')
		relays?.forEach((relay) => {
			this.tags.push(['r', relay])
		})
	}

	get hashtags(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 't')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set hashtags(tags: string[] | undefined) {
		this.removeTag('t')
		tags?.forEach((tag) => {
			this.tags.push(['t', tag])
		})
	}

	get datasetReferences(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'a')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set datasetReferences(references: string[] | undefined) {
		this.removeTag('a')
		references?.forEach((reference) => {
			this.tags.push(['a', reference])
		})
	}

	get contextReferences(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'c')
			.flatMap((tag) => (typeof tag[1] === 'string' && tag[1] ? [tag[1]] : []))
	}

	set contextReferences(references: string[] | undefined) {
		this.removeTag('c')
		references?.forEach((reference) => {
			if (reference) {
				this.tags.push(['c', reference])
			}
		})
	}

	ensureCollectionId(): string {
		if (!this.collectionId) {
			this.collectionId = generateShortDTag()
		}
		return this.collectionId
	}

	private replaceOptionalTag(tagName: string, value: string | undefined) {
		this.removeTag(tagName)
		if (value !== undefined) {
			this.tags.push([tagName, value])
		}
	}

	private async prepareForPublish(signer?: NDKSigner): Promise<void> {
		this.kind = GEO_COLLECTION_KIND
		this.ensureCollectionId()
		this.created_at = Math.floor(Date.now() / 1000)
		await this.sign(signer)
	}

	async publishNew(signer?: NDKSigner): Promise<NDKGeoCollectionEvent> {
		await this.prepareForPublish(signer)
		await this.publish()
		return this
	}

	static async deleteCollection(
		ndk: NDK,
		collection: NDKGeoCollectionEvent,
		reason?: string,
		signer?: NDKSigner,
	): Promise<void> {
		const collectionId = collection.collectionId ?? collection.dTag
		if (!collectionId) {
			throw new Error('Collection is missing a d tag and cannot be deleted.')
		}
		if (!collection.pubkey) {
			throw new Error('Collection is missing a pubkey and cannot be deleted.')
		}

		const collectionKind = collection.kind ?? GEO_COLLECTION_KIND
		const deletion = new NDKEvent(ndk)
		deletion.kind = NDKKind.EventDeletion
		deletion.content = reason ?? ''
		deletion.tags.push(['a', `${collectionKind}:${collection.pubkey}:${collectionId}`])
		if (collection.id) {
			deletion.tags.push(['e', collection.id])
		}

		await deletion.sign(signer)
		await deletion.publish()
	}
}

registerEventClass(NDKGeoCollectionEvent)
