import NDK, { NDKEvent, NDKKind, type NDKSigner, registerEventClass } from '@nostr-dev-kit/react'
import { bbox, centroid } from '@turf/turf'
import type { FeatureCollection, Position } from 'geojson'
import { GEO_COMMENT_KIND } from './kinds'
import type { GeoBoundingBox } from './NDKGeoEvent'
import { generateShortDTag } from './dTag'

export interface GeoCommentContent {
	text: string
	geojson?: FeatureCollection
}

export interface GeoCommentThreading {
	rootKind: string
	rootAddress?: string
	rootEventId?: string
	rootPubkey?: string
	parentKind: string
	parentAddress?: string
	parentEventId?: string
	parentPubkey?: string
}

/**
 * NDKGeoCommentEvent implements the GeoJSON Comment Event defined in SPEC.md.
 * It follows NIP-22 threading semantics with optional GeoJSON attachments.
 */
export class NDKGeoCommentEvent extends NDKEvent {
	static kinds = [GEO_COMMENT_KIND]

	static from(event: NDKEvent): NDKGeoCommentEvent {
		const wrapped = new NDKGeoCommentEvent(event.ndk, event)
		wrapped.kind = event.kind ?? NDKGeoCommentEvent.kinds[0]
		return wrapped
	}

	/**
	 * Parsed comment content with text and optional GeoJSON.
	 */
	get commentContent(): GeoCommentContent {
		if (!this.content) return { text: '' }
		try {
			const parsed = JSON.parse(this.content) as GeoCommentContent
			return {
				text: parsed.text ?? '',
				geojson: parsed.geojson,
			}
		} catch {
			// If content is plain text (legacy or simple comments)
			return { text: this.content }
		}
	}

	set commentContent(value: GeoCommentContent) {
		this.content = JSON.stringify(value)
	}

	/**
	 * The text portion of the comment.
	 */
	get text(): string {
		return this.commentContent.text
	}

	set text(value: string) {
		const current = this.commentContent
		this.commentContent = { ...current, text: value }
	}

	/**
	 * Optional GeoJSON FeatureCollection attached to the comment.
	 */
	get geojson(): FeatureCollection | undefined {
		return this.commentContent.geojson
	}

	set geojson(value: FeatureCollection | undefined) {
		const current = this.commentContent
		this.commentContent = { ...current, geojson: value }
	}

	/**
	 * Unique comment identifier (d tag)
	 */
	get commentId(): string | undefined {
		return this.dTag
	}

	set commentId(value: string | undefined) {
		this.dTag = value
	}

	/**
	 * Threading information extracted from NIP-22 tags.
	 */
	get threading(): GeoCommentThreading {
		return {
			rootKind: this.tagValue('K') ?? '',
			rootAddress: this.getTagValue('A'),
			rootEventId: this.getTagValue('E'),
			rootPubkey: this.getTagValue('P'),
			parentKind: this.tagValue('k') ?? '',
			parentAddress: this.getTagValue('a'),
			parentEventId: this.getTagValue('e'),
			parentPubkey: this.getTagValue('p'),
		}
	}

	/**
	 * Sets threading tags for a top-level comment on a dataset or collection.
	 */
	setRootScope(kind: number, address: string, authorPubkey: string): void {
		this.removeTag('K')
		this.removeTag('k')
		this.removeTag('A')
		this.removeTag('a')
		this.removeTag('P')
		this.removeTag('p')

		const kindStr = String(kind)
		this.tags.push(['K', kindStr])
		this.tags.push(['k', kindStr])
		this.tags.push(['A', address])
		this.tags.push(['a', address])
		this.tags.push(['P', authorPubkey])
		this.tags.push(['p', authorPubkey])
	}

	/**
	 * Sets threading tags for a reply to another comment.
	 */
	setReplyScope(
		rootKind: number,
		rootAddress: string,
		rootPubkey: string,
		parentComment: NDKGeoCommentEvent,
	): void {
		this.removeTag('K')
		this.removeTag('k')
		this.removeTag('A')
		this.removeTag('a')
		this.removeTag('E')
		this.removeTag('e')
		this.removeTag('P')
		this.removeTag('p')

		const parentAddress = `${GEO_COMMENT_KIND}:${parentComment.pubkey}:${parentComment.commentId}`

		this.tags.push(['K', String(rootKind)])
		this.tags.push(['k', String(GEO_COMMENT_KIND)])
		this.tags.push(['A', rootAddress])
		this.tags.push(['a', parentAddress])
		if (parentComment.id) {
			this.tags.push(['e', parentComment.id])
		}
		this.tags.push(['P', rootPubkey])
		this.tags.push(['p', parentComment.pubkey])
	}

	/**
	 * Bounding box of attached GeoJSON (if present).
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

	/**
	 * Check if this is a reply to another comment (vs a top-level comment).
	 */
	get isReply(): boolean {
		return this.threading.parentKind === String(GEO_COMMENT_KIND)
	}

	/**
	 * Get the root event address this comment thread belongs to.
	 */
	get rootAddress(): string | undefined {
		return this.getTagValue('A')
	}

	/**
	 * Get the parent event address (for threading).
	 */
	get parentAddress(): string | undefined {
		return this.getTagValue('a')
	}

	/**
	 * Get the parent event ID (for replies).
	 */
	get parentEventId(): string | undefined {
		return this.getTagValue('e')
	}

	/**
	 * Ensures the event has a d tag. Generates a compact random identifier if missing.
	 */
	ensureCommentId(): string {
		if (!this.commentId) {
			this.commentId = generateShortDTag()
		}
		return this.commentId
	}

	/**
	 * Recomputes bbox and geohash from the attached GeoJSON content.
	 */
	updateDerivedMetadata(geohashPrecision = 6): void {
		const collection = this.geojson
		if (!collection || collection.features.length === 0) {
			this.boundingBox = undefined
			this.geohash = undefined
			return
		}

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
			if (coordinates && coordinates.length >= 2) {
				this.geohash = encodeGeohash(
					coordinates[1] as number,
					coordinates[0] as number,
					geohashPrecision,
				)
			}
		} catch {
			// ignore – centroid calculation can fail on invalid geometry
		}
	}

	private replaceOptionalTag(tagName: string, value: string | undefined) {
		this.removeTag(tagName)
		if (value !== undefined) {
			this.tags.push([tagName, value])
		}
	}

	private getTagValue(tagName: string): string | undefined {
		const tag = this.tags.find((t) => t[0] === tagName)
		return tag?.[1]
	}

	private async prepareForPublish(signer?: NDKSigner): Promise<void> {
		this.kind = NDKGeoCommentEvent.kinds[0] as number
		this.ensureCommentId()
		if (this.geojson) {
			this.updateDerivedMetadata()
		}
		await this.sign(signer)
	}

	async publishComment(signer?: NDKSigner): Promise<NDKGeoCommentEvent> {
		await this.prepareForPublish(signer)
		await this.publish()
		return this
	}

	static async deleteComment(
		ndk: NDK,
		comment: NDKGeoCommentEvent,
		reason?: string,
		signer?: NDKSigner,
	): Promise<void> {
		const commentId = comment.commentId ?? comment.dTag
		if (!commentId) throw new Error('Comment is missing a d tag and cannot be deleted.')
		if (!comment.pubkey) throw new Error('Comment is missing a pubkey and cannot be deleted.')

		const commentKind = comment.kind ?? (NDKGeoCommentEvent.kinds[0] as number)

		const deletion = new NDKEvent(ndk)
		deletion.kind = NDKKind.EventDeletion
		deletion.content = reason ?? ''
		deletion.tags.push(['a', `${commentKind}:${comment.pubkey}:${commentId}`])
		if (comment.id) {
			deletion.tags.push(['e', comment.id])
		}

		await deletion.sign(signer)
		await deletion.publish()
	}

	/**
	 * Parse inline geometry references from comment text.
	 * Returns array of { type, address, featureId?, startIndex, endIndex }
	 */
	parseInlineReferences(): Array<{
		type: 'dataset' | 'collection' | 'feature'
		address: string
		featureId?: string
		startIndex: number
		endIndex: number
	}> {
		const text = this.text
		const references: Array<{
			type: 'dataset' | 'collection' | 'feature'
			address: string
			featureId?: string
			startIndex: number
			endIndex: number
		}> = []

		// Match nostr:naddr1... patterns, optionally with #featureId
		const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
		let match = pattern.exec(text)

		while (match !== null) {
			const fullMatch = match[0]
			const naddr = match[1]
			const featureId = match[3]
			const matchIndex = match.index

			// Decode naddr to determine type (would need proper bech32 decoding in production)
			// For now, we'll mark as 'dataset' and let the consumer resolve
			if (naddr) {
				references.push({
					type: featureId ? 'feature' : 'dataset',
					address: naddr,
					featureId,
					startIndex: matchIndex,
					endIndex: matchIndex + fullMatch.length,
				})
			}

			match = pattern.exec(text)
		}

		return references
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

registerEventClass(NDKGeoCommentEvent)
