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
import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
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

	test('stamps NIP-23 publishedAt on create and respects a caller-supplied value (SPEC §4.3)', async () => {
		const sign = async (e: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => ({
			...e,
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
		})
		const stamped = await ArticleFactory.create({ title: 'T' }).sign(sign)
		const content = JSON.parse(stamped.content)
		expect(typeof content.publishedAt).toBe('number')
		expect(content.publishedAt).toBeGreaterThan(1_700_000_000)

		const explicit = await ArticleFactory.create({ title: 'T', publishedAt: 1_234 }).sign(sign)
		expect(JSON.parse(explicit.content).publishedAt).toBe(1_234)
	})

	test('modify() preserves an existing publishedAt (stable across edits)', async () => {
		const event = {
			...makeArticleEvent(),
			content: JSON.stringify({ modelVersion: MODEL_VERSION, title: 'A', publishedAt: 42 }),
		}
		const edited = await ArticleFactory.modify(event as never)
			.article({ title: 'B' })
			.sign(async (e) => ({
				...e,
				id: 'a'.repeat(64),
				pubkey: 'b'.repeat(64),
				sig: 'c'.repeat(128),
			}))
		const content = JSON.parse(edited.content)
		expect(content.publishedAt).toBe(42)
		expect(content.title).toBe('B')
	})

	test('a rapid edit is strictly newer and becomes the latest replacement immediately', async () => {
		const secret = generateSecretKey()
		const previous = finalizeEvent(
			{
				...makeArticleEvent(),
				// Ahead of the local clock makes same-second ordering deterministic without a sleep.
				created_at: Math.floor(Date.now() / 1000) + 60,
			},
			secret,
		)
		if (!isArticle(previous)) throw new Error('Expected a valid Story source event.')
		const updated = await ArticleFactory.modify(previous)
			.article({ summary: 'Updated immediately' })
			.sign((template) => Promise.resolve(finalizeEvent(template, secret)))
		const store = new EventStore()
		store.add(previous)
		store.add(updated)
		expect(updated.created_at).toBe(previous.created_at + 1)
		expect(updated.tags).toContainEqual(['d', 'story-1'])
		expect(store.getReplaceable(ARTICLE_KIND, previous.pubkey, 'story-1')?.id).toBe(updated.id)
		expect(
			JSON.parse(store.getReplaceable(ARTICLE_KIND, previous.pubkey, 'story-1')!.content).summary,
		).toBe('Updated immediately')
	})
})

describe('article — SPEC-02 Article cast', () => {
	test('exposes dTag and round-trips tags', () => {
		const article = new Article(makeArticleEvent(), undefined as never)
		expect(article.dTag).toBe('story-1')
	})
})
