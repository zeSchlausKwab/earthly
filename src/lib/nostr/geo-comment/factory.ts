/**
 * Factory + delete helper for kind 37517 (GeoJSON Comment Event).
 *
 * Two static entrypoints:
 *
 *   - `GeoCommentFactory.root(content, { kind, address, authorPubkey })`
 *      for a top-level comment on a dataset/context
 *   - `GeoCommentFactory.reply(content, { rootKind, rootAddress, rootPubkey, parent })`
 *      for a reply to another comment
 *
 * Then chain `.withDerivedMetadata()` if the comment has a GeoJSON attachment,
 * and finish with `.sign(signer)`.
 */

import { geohashPrefixes } from '../tags'
import { blankEventTemplate, DeleteFactory, EventFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'nostr-tools'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { GEO_COMMENT_KIND } from '@/lib/nostr/kinds'
import { publish } from '..'
import {
	computeCommentBbox,
	computeCommentGeohash,
	type GeoCommentContent,
	type GeoCommentEvent,
} from './helpers'

export interface RootScope {
	kind: number
	address: string
	authorPubkey: string
}

export interface ReplyScope {
	rootKind: number
	rootAddress: string
	rootPubkey: string
	parent: GeoCommentEvent | { id: string; pubkey: string; commentId: string }
}

export class GeoCommentFactory extends EventFactory<typeof GEO_COMMENT_KIND> {
	/** Start a top-level comment on a dataset/context. */
	static root(content: GeoCommentContent, scope: RootScope): GeoCommentFactory {
		return new GeoCommentFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_COMMENT_KIND)
			tpl.content = JSON.stringify(content)
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			// NIP-22: K/k = root kind, A/a = root address, P/p = root author.
			// For root scope, parent = root.
			const kindStr = String(scope.kind)
			tpl.tags.push(
				['K', kindStr],
				['k', kindStr],
				['A', scope.address],
				['a', scope.address],
				['P', scope.authorPubkey],
				['p', scope.authorPubkey],
			)
			resolve(tpl)
		})
	}

	/** Start a reply to another comment. */
	static reply(content: GeoCommentContent, scope: ReplyScope): GeoCommentFactory {
		const parent = scope.parent
		const parentId = 'event' in parent ? (parent as never) : parent.id
		const parentPubkey = parent.pubkey
		const parentCommentId =
			'commentId' in parent
				? parent.commentId
				: parent.tags?.find((t: string[]) => t[0] === 'd')?.[1]
		if (!parentCommentId) {
			throw new Error('Reply parent must have a commentId (d-tag)')
		}
		const parentAddress = `${GEO_COMMENT_KIND}:${parentPubkey}:${parentCommentId}`

		return new GeoCommentFactory((resolve) => {
			const tpl = blankEventTemplate(GEO_COMMENT_KIND)
			tpl.content = JSON.stringify(content)
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			tpl.tags.push(
				['K', String(scope.rootKind)],
				['k', String(GEO_COMMENT_KIND)],
				['A', scope.rootAddress],
				['a', parentAddress],
				['P', scope.rootPubkey],
				['p', parentPubkey],
			)
			if (parentId && typeof parentId === 'string') {
				tpl.tags.push(['e', parentId])
			}
			resolve(tpl)
		})
	}

	/** Replace `text` while keeping any existing GeoJSON attachment. */
	text(value: string): this {
		return this.chain((tpl) => {
			let parsed: GeoCommentContent
			try {
				parsed = JSON.parse(tpl.content) as GeoCommentContent
			} catch {
				parsed = { text: '' }
			}
			return { ...tpl, content: JSON.stringify({ ...parsed, text: value }) }
		})
	}

	/** Replace the GeoJSON attachment (or pass `undefined` to drop it). */
	geojson(fc: NonNullable<GeoCommentContent['geojson']> | undefined): this {
		return this.chain((tpl) => {
			let parsed: GeoCommentContent
			try {
				parsed = JSON.parse(tpl.content) as GeoCommentContent
			} catch {
				parsed = { text: '' }
			}
			return {
				...tpl,
				content: JSON.stringify({ ...parsed, geojson: fc }),
			}
		})
	}

	/**
	 * Recompute the spatial discovery tags (`bbox`, `g`) from the attached
	 * GeoJSON. Drops both tags if there's no GeoJSON.
	 */
	withDerivedMetadata(precision = 6): this {
		return this.chain((tpl) => {
			let parsed: GeoCommentContent
			try {
				parsed = JSON.parse(tpl.content) as GeoCommentContent
			} catch {
				parsed = { text: '' }
			}
			const fc = parsed.geojson
			const computedBbox = computeCommentBbox(fc)
			const computedGeohash = computeCommentGeohash(fc, precision)

			const newTags: string[][] = tpl.tags.filter((tag) => tag[0] !== 'bbox' && tag[0] !== 'g')
			if (computedBbox) newTags.push(['bbox', computedBbox.join(',')])
			if (computedGeohash) {
				for (const prefix of geohashPrefixes(computedGeohash)) newTags.push(['g', prefix])
			}

			return { ...tpl, tags: newTags }
		})
	}
}

/** Publish a NIP-09 deletion event for a comment the active account owns. */
export async function deleteComment(
	comment: GeoCommentEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	const event = await DeleteFactory.fromEvents([comment], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
