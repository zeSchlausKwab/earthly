import NDK, { NDKEvent, NDKKind, type NDKSigner, registerEventClass } from '@nostr-dev-kit/react'
import { bbox, centroid } from '@turf/turf'
import type { FeatureCollection, Position } from 'geojson'
import { GEO_EDIT_PROPOSAL_KIND } from './kinds'
import { normalizeGeoJsonToFeatureCollection } from '../geo/normalizeGeoJSON'
import { generateShortDTag } from './dTag'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { publish } from '../nostr'

const DEFAULT_COLLECTION: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

/**
 * NDKGeoEditProposalEvent implements the Geo Edit Proposal Event (kind 37519).
 * It stores a full replacement FeatureCollection proposed as an edit to another
 * user's dataset (kind 37515). The original author can review, preview on map,
 * and accept/reject the proposal.
 */
export class NDKGeoEditProposalEvent extends NDKEvent {
	static kinds = [GEO_EDIT_PROPOSAL_KIND]

	static from(event: NDKEvent): NDKGeoEditProposalEvent {
		const wrapped = new NDKGeoEditProposalEvent(event.ndk, event)
		wrapped.kind = event.kind ?? GEO_EDIT_PROPOSAL_KIND
		return wrapped
	}

	/**
	 * Proposed FeatureCollection stored in the content.
	 * This is the full replacement content — not a diff.
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
	 * Unique proposal identifier (d tag).
	 */
	get proposalId(): string | undefined {
		return this.dTag
	}

	set proposalId(value: string | undefined) {
		this.dTag = value
	}

	/**
	 * Address of the target dataset: `37515:<owner-pubkey>:<dataset-d-tag>`
	 */
	get targetAddress(): string | undefined {
		return this.tagValue('a')
	}

	set targetAddress(address: string | undefined) {
		this.replaceOptionalTag('a', address)
	}

	/**
	 * The owner's pubkey parsed from the target address.
	 */
	get targetPubkey(): string | undefined {
		const address = this.targetAddress
		if (!address) return undefined
		const parts = address.split(':')
		return parts[1]
	}

	/**
	 * The dataset d-tag parsed from the target address.
	 */
	get targetDatasetId(): string | undefined {
		const address = this.targetAddress
		if (!address) return undefined
		const parts = address.split(':')
		return parts[2]
	}

	/**
	 * The dataset owner's pubkey (p tag) — used for relay filtering.
	 */
	get ownerPubkey(): string | undefined {
		return this.tagValue('p')
	}

	set ownerPubkey(pubkey: string | undefined) {
		this.replaceOptionalTag('p', pubkey)
	}

	/**
	 * Event ID of the target dataset version this proposal is based on.
	 */
	get baseVersion(): string | undefined {
		return this.tagValue('base-version')
	}

	set baseVersion(eventId: string | undefined) {
		this.replaceOptionalTag('base-version', eventId)
	}

	/**
	 * Human-readable description of the proposed changes.
	 */
	get description(): string | undefined {
		return this.tagValue('description')
	}

	set description(value: string | undefined) {
		this.replaceOptionalTag('description', value)
	}

	/**
	 * Bounding box tag accessor (west,south,east,north).
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

	/**
	 * Ensures the event has a d tag. Generates a compact random identifier if missing.
	 */
	ensureProposalId(): string {
		if (!this.proposalId) {
			this.proposalId = generateShortDTag()
		}
		return this.proposalId
	}

	/**
	 * Recomputes bbox and geohash from the proposed FeatureCollection.
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
	}

	/**
	 * The NIP-19 `a` coordinate for this proposal: `37519:<pubkey>:<d-tag>`
	 */
	get proposalCoordinate(): string | undefined {
		const id = this.proposalId
		if (!id || !this.pubkey) return undefined
		return `${GEO_EDIT_PROPOSAL_KIND}:${this.pubkey}:${id}`
	}

	private replaceOptionalTag(tagName: string, value: string | undefined) {
		this.removeTag(tagName)
		if (value !== undefined) {
			this.tags.push([tagName, value])
		}
	}

	private async prepareForPublish(signer?: NDKSigner): Promise<void> {
		this.kind = GEO_EDIT_PROPOSAL_KIND
		this.ensureProposalId()
		this.updateDerivedMetadata()
		await this.sign(signer)
	}

	async publishProposal(signer?: NDKSigner): Promise<NDKGeoEditProposalEvent> {
		await this.prepareForPublish(signer)
		await publish(this.rawEvent(), { routing: 'outbox' })
		return this
	}

	static async deleteProposal(
		ndk: NDK,
		proposal: NDKGeoEditProposalEvent,
		reason?: string,
		signer?: NDKSigner,
	): Promise<void> {
		const proposalId = proposal.proposalId ?? proposal.dTag
		if (!proposalId) throw new Error('Proposal is missing a d tag and cannot be deleted.')

		const deletion = new NDKEvent(ndk)
		deletion.kind = NDKKind.EventDeletion
		deletion.content = reason ?? ''
		deletion.tags.push(['a', `${proposal.kind}:${proposal.pubkey}:${proposalId}`])
		if (proposal.id) {
			deletion.tags.push(['e', proposal.id])
		}

		await deletion.sign(signer)
		await publish(deletion.rawEvent(), { routing: 'outbox' })
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

registerEventClass(NDKGeoEditProposalEvent)
