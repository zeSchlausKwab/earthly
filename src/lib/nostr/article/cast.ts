/**
 * Cast for kind 37520 (Article / Story Event) — read-only view.
 *
 * Follows the official applesauce casting contract (`EventCast` + `castEvent`),
 * mirroring `map-context/cast.ts`. Tag reads delegate to the shared `tags.ts`
 * seam via the helpers (SPEC-02).
 */

import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import {
	type ArticleContent,
	type ArticleEvent,
	getArticleBoundingBox,
	getArticleContent,
	getArticleContextReferences,
	getArticleGeohash,
	getArticleHashtags,
	getArticleId,
	getArticleLabels,
	getArticleReferencedAddresses,
	isArticle,
} from './helpers'

export class Article extends EventCast<ArticleEvent> {
	constructor(event: NostrEvent, store: CastRefEventStore) {
		if (!isArticle(event)) throw new Error('Event is not an Article (kind 37520)')
		super(event, store)
	}

	// Raw-event proxies (mirror MapContext).
	get kind() {
		return this.event.kind
	}
	get pubkey() {
		return this.event.pubkey
	}
	get tags() {
		return this.event.tags
	}
	get content() {
		return this.event.content
	}
	get created_at() {
		return this.event.created_at
	}

	/** The addressable d-tag value. */
	get dTag(): string | undefined {
		return getArticleId(this.event)
	}

	get article(): ArticleContent {
		return getArticleContent(this.event)
	}

	get boundingBox() {
		return getArticleBoundingBox(this.event)
	}
	get geohash() {
		return getArticleGeohash(this.event)
	}
	get hashtags() {
		return getArticleHashtags(this.event)
	}
	get labels() {
		return getArticleLabels(this.event)
	}
	get contextReferences() {
		return getArticleContextReferences(this.event)
	}
	get referencedAddresses() {
		return getArticleReferencedAddresses(this.event)
	}

	rawEvent() {
		return this.event
	}
}
