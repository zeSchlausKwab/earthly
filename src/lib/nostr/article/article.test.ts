/**
 * Wave-0 Nyquist baseline — pins the Article (kind 37520, Story) scaffold contract.
 *
 * SPEC-02: per-kind guard + factory + cast, all routing tag reads through the shared
 * `tags.ts` seam.
 *   - isArticle() accepts a well-formed 37520 (has `d` tag + `modelVersion` content),
 *     rejects a wrong-kind event.
 *   - ArticleFactory.create() emits a template with a `d` tag and `modelVersion` content.
 *   - the Article cast over a valid event exposes `dTag` and round-trips tags.
 *
 * Symbol names per RESEARCH Pattern 1: `isArticle` / `ArticleFactory` / `Article`.
 * RED-BASELINE: `@/lib/nostr/article` does not exist yet (lands in Plan 04).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { ARTICLE_KIND, Article, ArticleFactory, isArticle } from '@/lib/nostr/article'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

function makeArticleEvent(): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind: ARTICLE_KIND,
		tags: [['d', 'story-1']],
		content: JSON.stringify({ modelVersion: MODEL_VERSION, title: 'A Story' }),
		sig: 'c'.repeat(128),
	}
}

function makeWrongKindEvent(): NostrEvent {
	return { ...makeArticleEvent(), kind: 1 }
}

describe('article — SPEC-02 isArticle guard', () => {
	test('accepts a well-formed 37520 event', () => {
		expect(isArticle(makeArticleEvent())).toBe(true)
	})

	test('rejects a wrong-kind event', () => {
		expect(isArticle(makeWrongKindEvent())).toBe(false)
	})
})

describe('article — SPEC-02 ArticleFactory.create()', () => {
	test('produces a template with a d tag and modelVersion content', async () => {
		const tpl = await ArticleFactory.create().sign(async (e) => ({
			...e,
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
		}))
		expect(tpl.tags.some((t) => t[0] === 'd' && !!t[1])).toBe(true)
		const content = JSON.parse(tpl.content)
		expect(content.modelVersion).toBe(MODEL_VERSION)
	})
})

describe('article — SPEC-02 Article cast', () => {
	test('exposes dTag and round-trips tags', () => {
		const article = new Article(makeArticleEvent(), undefined as never)
		expect(article.dTag).toBe('story-1')
	})
})
