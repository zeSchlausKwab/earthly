/**
 * Pure helpers for kind 37520 (Article / Story Event).
 *
 * An Article is a NIP-23-style long-form geo narrative (parameterized-replaceable).
 * Scaffolding only (Phase 8): a minimal content interface, a defensive content
 * getter, and an `isArticle` guard gating on kind + `d` + the SPEC-03
 * `modelVersion` discriminator. All tag reads delegate to the shared `tags.ts`
 * seam (SPEC-02) — no copy-pasted getter bodies here.
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { hasCurrentModelVersion } from '@/lib/nostr/modelVersion'
import {
	getBbox,
	getContextRefs,
	getGeohash,
	getHashtags,
	getLabels,
	getReferencedAddresses,
} from '@/lib/nostr/tags'

export { ARTICLE_KIND }

export type ArticleEvent = KnownEvent<typeof ARTICLE_KIND>

/** Minimal NIP-23-style article content (scaffolding only). */
export interface ArticleContent {
	modelVersion?: string
	title?: string
	summary?: string
	image?: string
	/**
	 * First-publication timestamp (epoch seconds), per NIP-23. Stable across
	 * edits — `created_at` moves on every replacement, `publishedAt` does not.
	 * Readers should fall back to `event.created_at` when absent (legacy events).
	 */
	publishedAt?: number
	/** Long-form markdown body. */
	content?: string
}

export const DEFAULT_ARTICLE_CONTENT: ArticleContent = {}

const ArticleContentSymbol = Symbol.for('article-content')

/**
 * SPEC-03 guard. True only for a well-formed 37520 event that carries a `d` tag
 * AND declares the current `modelVersion`. Legacy/absent-discriminator and
 * wrong-kind events return false WITHOUT throwing (defensive parse via
 * `hasCurrentModelVersion`).
 */
export function isArticle(event: NostrEvent): event is ArticleEvent {
	return (
		event.kind === ARTICLE_KIND &&
		getTagValue(event, 'd') !== undefined &&
		hasCurrentModelVersion(event)
	)
}

export function getArticleId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

/** Defensive content getter — never throws; malformed content ⇒ defaults. */
export function getArticleContent(event: NostrEvent): ArticleContent {
	return getOrComputeCachedValue(event, ArticleContentSymbol, () => {
		if (!event.content) return { ...DEFAULT_ARTICLE_CONTENT }
		try {
			const parsed = JSON.parse(event.content) as Partial<ArticleContent>
			return { ...DEFAULT_ARTICLE_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_ARTICLE_CONTENT }
		}
	})
}

// Tag reads delegate to the shared tags.ts seam (SPEC-02) — no copy-paste.
export function getArticleBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getBbox(event)
}

export function getArticleGeohash(event: NostrEvent): string | undefined {
	return getGeohash(event)
}

export function getArticleHashtags(event: NostrEvent): string[] {
	return getHashtags(event)
}

export function getArticleLabels(event: NostrEvent): string[] {
	return getLabels(event)
}

export function getArticleContextReferences(event: NostrEvent): string[] {
	return getContextRefs(event)
}

export function getArticleReferencedAddresses(event: NostrEvent): string[] {
	return getReferencedAddresses(event)
}
