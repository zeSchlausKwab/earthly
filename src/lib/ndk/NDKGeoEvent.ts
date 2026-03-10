import NDK, { NDKEvent, NDKKind, type NDKSigner, registerEventClass } from '@nostr-dev-kit/react'
import { bbox, centroid } from '@turf/turf'
import type { FeatureCollection, Position } from 'geojson'
import { GEO_EVENT_KIND } from './kinds'
import { normalizeGeoJsonToFeatureCollection } from '../geo/normalizeGeoJSON'
import { generateShortDTag } from './dTag'

export type GeoBoundingBox = [number, number, number, number]

export interface GeoBlobReference {
	scope: 'collection' | 'feature'
	featureId?: string
	url: string
	sha256?: string
	size?: number
	mimeType?: string
}

const DEFAULT_COLLECTION: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

/**
 * NDKGeoEvent implements the GeoJSON Data Event defined in SPEC.md.
 * It exposes strongly typed accessors for every tag in the spec and
 * utility helpers to keep the derived metadata in sync with the content.
 */
export class NDKGeoEvent extends NDKEvent {
	static kinds = [GEO_EVENT_KIND]

	static from(event: NDKEvent): NDKGeoEvent {
		const wrapped = new NDKGeoEvent(event.ndk, event)
		wrapped.kind = event.kind ?? GEO_EVENT_KIND
		return wrapped
	}

	/**
	 * Parsed GeoJSON FeatureCollection stored in the content.
	 * Automatically normalizes various GeoJSON formats:
	 * - Wraps single Feature objects into a FeatureCollection
	 * - Wraps raw Geometry objects into a Feature, then FeatureCollection
	 * - Unwraps nested Features (Feature as geometry of another Feature)
	 */
	get featureCollection(): FeatureCollection {
		if (!this.content) return DEFAULT_COLLECTION
		try {
			const parsed = JSON.parse(this.content)
			return normalizeGeoJsonToFeatureCollection(parsed)
		} catch {
			return DEFAULT_COLLECTION
		}
	}

	set featureCollection(collection: FeatureCollection) {
		this.content = JSON.stringify(collection)
	}

	/**
	 * Unique dataset identifier (d tag)
	 */
	get datasetId(): string | undefined {
		return this.dTag
	}

	set datasetId(value: string | undefined) {
		this.dTag = value
	}

	/**
	 * Bounding box tag accessor (west,south,east,north)
	 */
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

	get coordinateReferenceSystem(): string | undefined {
		return this.tagValue('crs')
	}

	set coordinateReferenceSystem(crs: string | undefined) {
		this.replaceOptionalTag('crs', crs)
	}

	get checksum(): string | undefined {
		return this.tagValue('checksum')
	}

	set checksum(value: string | undefined) {
		this.replaceOptionalTag('checksum', value)
	}

	get datasetSize(): number | undefined {
		const size = this.tagValue('size')
		return size ? Number.parseInt(size, 10) : undefined
	}

	set datasetSize(size: number | undefined) {
		this.replaceOptionalTag('size', typeof size === 'number' ? String(size) : undefined)
	}

	get version(): string | undefined {
		return this.tagValue('v')
	}

	set version(value: string | undefined) {
		this.replaceOptionalTag('v', value)
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

	set hashtags(tags: string[]) {
		this.removeTag('t')
		tags?.forEach((tag) => {
			this.tags.push(['t', tag])
		})
	}

	get collectionReferences(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'collection')
			.flatMap((tag) => (typeof tag[1] === 'string' ? [tag[1]] : []))
	}

	set collectionReferences(collections: string[]) {
		this.removeTag('collection')
		collections?.forEach((value) => {
			this.tags.push(['collection', value])
		})
	}

	get contextReferences(): string[] {
		return this.tags
			.filter((tag) => tag[0] === 'c')
			.flatMap((tag) => (typeof tag[1] === 'string' && tag[1] ? [tag[1]] : []))
	}

	set contextReferences(contexts: string[] | undefined) {
		this.removeTag('c')
		contexts?.forEach((value) => {
			if (value) {
				this.tags.push(['c', value])
			}
		})
	}

	/**
	 * External blob references for oversized FeatureCollections or individual features.
	 * Tags follow the format ["blob","collection|feature:<id>","<url>","sha256=...","size=...","mime=..."].
	 */
	get blobReferences(): GeoBlobReference[] {
		return this.tags
			.filter(
				(tag) => tag[0] === 'blob' && typeof tag[1] === 'string' && typeof tag[2] === 'string',
			)
			.map((tag) => {
				const scope = tag[1] as string
				const url = tag[2] as string
				const reference: GeoBlobReference = {
					scope: scope?.startsWith('feature:') ? 'feature' : 'collection',
					url,
				}
				if (reference.scope === 'feature') {
					reference.featureId = scope?.slice('feature:'.length)
				}

				tag.slice(3).forEach((entry) => {
					const [key, value] = entry.split('=')
					if (!value) return
					if (key === 'sha256') {
						reference.sha256 = value
					} else if (key === 'size') {
						const parsed = Number.parseInt(value, 10)
						if (!Number.isNaN(parsed)) {
							reference.size = parsed
						}
					} else if (key === 'mime') {
						reference.mimeType = value
					}
				})

				return reference
			})
	}

	set blobReferences(references: GeoBlobReference[] | undefined) {
		this.removeTag('blob')
		references?.forEach((reference) => {
			if (!reference.url) return
			const scope =
				reference.scope === 'feature' ? `feature:${reference.featureId ?? ''}` : 'collection'
			const tag: string[] = ['blob', scope, reference.url]
			if (reference.sha256) {
				tag.push(`sha256=${reference.sha256}`)
			}
			if (typeof reference.size === 'number' && Number.isFinite(reference.size)) {
				tag.push(`size=${reference.size}`)
			}
			if (reference.mimeType) {
				tag.push(`mime=${reference.mimeType}`)
			}
			this.tags.push(tag)
		})
	}

	/**
	 * Ensures the event has a d tag. Generates a compact random identifier if missing.
	 */
	ensureDatasetId(): string {
		if (!this.datasetId) {
			this.datasetId = generateShortDTag()
		}
		return this.datasetId
	}

	/**
	 * Recomputes bbox, geohash and size from the FeatureCollection content.
	 * The geohash is derived from the centroid.
	 */
	updateDerivedMetadata(geohashPrecision = 6): void {
		const collection = this.featureCollection

		try {
			const computedBbox = bbox(collection) as GeoBoundingBox
			if (computedBbox.every((value) => Number.isFinite(value))) {
				this.boundingBox = computedBbox
			}
		} catch {
			// ignore – invalid geometry
		}

		try {
			const computedCentroid = centroid(collection)
			const coordinates = computedCentroid.geometry?.coordinates as Position | undefined
			const lon = coordinates?.[0]
			const lat = coordinates?.[1]
			if (typeof lat === 'number' && typeof lon === 'number') {
				this.geohash = encodeGeohash(lat, lon, geohashPrecision)
			}
		} catch {
			// ignore – centroid calculation can fail on invalid geometry
		}

		const encoder = new TextEncoder()
		this.datasetSize = encoder.encode(this.content ?? '').length
	}

	/**
	 * Computes SHA-256 checksum of the content and stores it in the checksum tag.
	 */
	async updateChecksum(): Promise<void> {
		if (!globalThis.crypto?.subtle) return
		const encoder = new TextEncoder()
		const data = encoder.encode(this.content ?? '')
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
		this.checksum = hashHex
	}

	private replaceOptionalTag(tagName: string, value: string | undefined) {
		this.removeTag(tagName)
		if (value !== undefined) {
			this.tags.push([tagName, value])
		}
	}

	private async prepareForPublish(
		signer?: NDKSigner,
		options?: { skipMetadataUpdate?: boolean },
	): Promise<void> {
		this.kind = GEO_EVENT_KIND
		this.ensureDatasetId()
		if (!options?.skipMetadataUpdate) {
			this.updateDerivedMetadata()
		} else {
			// Even for stub events we still want size to reflect the current content.
			const encoder = new TextEncoder()
			this.datasetSize = encoder.encode(this.content ?? '').length
		}
		await this.updateChecksum()
		await this.sign(signer)
	}

	async publishNew(
		signer?: NDKSigner,
		options?: { skipMetadataUpdate?: boolean },
	): Promise<NDKGeoEvent> {
		await this.prepareForPublish(signer, options)
		await this.publish()
		return this
	}

	async publishUpdate(
		previous: NDKGeoEvent,
		signer?: NDKSigner,
		options?: { skipMetadataUpdate?: boolean },
	): Promise<NDKGeoEvent> {
		this.datasetId = previous.datasetId ?? previous.id
		if (!this.datasetId) {
			throw new Error('Dataset identifier is required for updates.')
		}

		const previousVersion = Number(previous.version)
		if (!Number.isNaN(previousVersion)) {
			this.version = String(previousVersion + 1)
		}

		this.removeTag('p')
		this.tags.push(['p', previous.id])

		await this.prepareForPublish(signer, options)
		await this.publish()
		return this
	}

	static async deleteDataset(
		ndk: NDK,
		dataset: NDKGeoEvent,
		reason?: string,
		signer?: NDKSigner,
	): Promise<void> {
		const datasetId = dataset.datasetId ?? dataset.dTag
		if (!datasetId) throw new Error('Dataset is missing a d tag and cannot be deleted.')
		if (!dataset.pubkey) {
			throw new Error('Dataset is missing a pubkey and cannot be deleted.')
		}

		const datasetKind = dataset.kind ?? GEO_EVENT_KIND

		const deletion = new NDKEvent(ndk)
		deletion.kind = NDKKind.EventDeletion
		deletion.content = reason ?? ''
		deletion.tags.push(['a', `${datasetKind}:${dataset.pubkey}:${datasetId}`])
		if (dataset.id) {
			deletion.tags.push(['e', dataset.id])
		}

		await deletion.sign(signer)
		await deletion.publish()
	}
}

function encodeGeohash(lat: number, lon: number, precision = 6): string {
	const base32 = '0123456789bcdefghjkmnpqrstuvwxyz'
	let geohash = ''
	let even = true
	const latRange: [number, number] = [-90, 90]
	const lonRange: [number, number] = [-180, 180]

	while (geohash.length < precision) {
		let ch = 0
		for (let bit = 0; bit < 5; bit++) {
			if (even) {
				const mid = (lonRange[0] + lonRange[1]) / 2
				if (lon >= mid) {
					ch |= 1 << (4 - bit)
					lonRange[0] = mid
				} else {
					lonRange[1] = mid
				}
			} else {
				const mid = (latRange[0] + latRange[1]) / 2
				if (lat >= mid) {
					ch |= 1 << (4 - bit)
					latRange[0] = mid
				} else {
					latRange[1] = mid
				}
			}
			even = !even
		}
		geohash += base32[ch]
	}

	return geohash
}

registerEventClass(NDKGeoEvent)
