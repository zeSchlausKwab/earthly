/**
 * Factory + delete helper for kind 37519 (Geo Edit Proposal Event).
 *
 * A proposal targets a specific dataset (`a` tag = `37515:owner:d-tag`),
 * carries the full proposed FeatureCollection in `content`, and optional
 * `description`, `base-version`, and discovery tags.
 */

import { geohashPrefixes } from '../tags'
import { blankEventTemplate, DeleteFactory, EventFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { FeatureCollection } from 'geojson'
import type { NostrEvent } from 'nostr-tools'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { GEO_EDIT_PROPOSAL_KIND } from '@/lib/nostr/kinds'
import { publish } from '..'
import { computeBboxFor, computeGeohashFor, getProposalId, type GeoProposalEvent } from './helpers'

export interface ProposalTarget {
	/** `37515:<owner-pubkey>:<dataset-d-tag>` */
	address: string
	/** Owner's pubkey, propagated as the `p` tag for routing. */
	ownerPubkey: string
	/** Optional event id of the version this proposal is based on. */
	baseVersion?: string
}

export class GeoProposalFactory extends EventFactory<typeof GEO_EDIT_PROPOSAL_KIND> {
	/** Start a new proposal for the given target dataset and feature collection. */
	static create(target: ProposalTarget, fc: FeatureCollection): GeoProposalFactory {
		return new GeoProposalFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_EDIT_PROPOSAL_KIND)
			tpl.content = JSON.stringify(fc)
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			tpl.tags.push(['a', target.address], ['p', target.ownerPubkey])
			if (target.baseVersion) {
				tpl.tags.push(['base-version', target.baseVersion])
			}
			resolve(tpl)
		})
	}

	/**
	 * Start a new Story-narrative proposal (STORY-06). Identical to {@link create}
	 * except `content` is the proposed Markdown body STRING directly (NOT a
	 * JSON-stringified FeatureCollection), and `target.address` is the Story
	 * `37520:<owner>:<d>` coordinate.
	 *
	 * This is a PURE content-type extension — no spec discriminator tag is added.
	 * A consumer reads the target kind off the `a` coordinate
	 * (`getProposalTargetKind`) and parses `content` accordingly: Markdown for a
	 * 37520 target, FeatureCollection for a 37515 target (SPEC.md §11.1 + §17).
	 * The dataset path ({@link create}) is left untouched.
	 */
	static createForStory(target: ProposalTarget, markdownBody: string): GeoProposalFactory {
		return new GeoProposalFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_EDIT_PROPOSAL_KIND)
			tpl.content = markdownBody
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			tpl.tags.push(['a', target.address], ['p', target.ownerPubkey])
			if (target.baseVersion) {
				tpl.tags.push(['base-version', target.baseVersion])
			}
			resolve(tpl)
		})
	}

	/** Set the human-readable description of the proposed changes. */
	description(value: string | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => {
			const filtered = tags.filter((t) => t[0] !== 'description')
			return value ? [...filtered, ['description', value]] : filtered
		})
	}

	/** Replace all `t` (hashtag) tags. */
	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => [
			...tags.filter((t) => t[0] !== 't'),
			...values.map((value) => ['t', value]),
		])
	}

	/** Recompute `bbox` and `g` tags from the proposed FeatureCollection. */
	withSpatialMetadata(precision = 6): this {
		return this.chain((tpl) => {
			let fc: FeatureCollection
			try {
				fc = JSON.parse(tpl.content) as FeatureCollection
			} catch {
				return tpl
			}
			const computedBbox = computeBboxFor(fc)
			const computedGeohash = computeGeohashFor(fc, precision)

			const newTags: string[][] = tpl.tags.filter((tag) => tag[0] !== 'bbox' && tag[0] !== 'g')
			if (computedBbox) newTags.push(['bbox', computedBbox.join(',')])
			if (computedGeohash) {
				for (const prefix of geohashPrefixes(computedGeohash)) newTags.push(['g', prefix])
			}

			return { ...tpl, tags: newTags }
		})
	}
}

/** Publish a NIP-09 deletion for a proposal the active account owns. */
export async function deleteGeoProposal(
	proposal: GeoProposalEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	if (!getProposalId(proposal)) {
		throw new Error('Proposal is missing a d tag and cannot be deleted.')
	}
	const event = await DeleteFactory.fromEvents([proposal], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
