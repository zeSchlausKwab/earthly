/**
 * Factory for kind 37520 (Article / Story Event).
 *
 * `create()` injects the SPEC-03 `modelVersion` discriminator into content and
 * generates a `d` tag only if absent; `modify()` reuses `toEventTemplate(event)`
 * and never regenerates `d` (no lineage fork, T-08-LINEAGE). Tag setters delegate
 * to the shared `tags.ts` transformers (SPEC-02) — no copy-pasted write bodies.
 */

import { blankEventTemplate, toEventTemplate } from 'applesauce-core/factories'
import { generateShortDTag } from '@/lib/nostr/dTag'
import { EntityFactory } from '@/lib/nostr/entityFactory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	setBbox,
	setContextRefs,
	setGeohash,
	setHashtags,
	setLabels,
	setReferencedAddresses,
} from '@/lib/nostr/tags'
import {
	type ArticleContent,
	type ArticleEvent,
	DEFAULT_ARTICLE_CONTENT,
	isArticle,
} from './helpers'

export class ArticleFactory extends EntityFactory<typeof ARTICLE_KIND> {
	/** Start a new Article from a content object. */
	static create(content: Partial<ArticleContent> = {}): ArticleFactory {
		return new ArticleFactory((resolve) => {
			const tpl = blankEventTemplate(ARTICLE_KIND)
			// modelVersion (SPEC-03) is authoritative — strip any caller-supplied
			// value, then re-assert the current one so it can never be overridden.
			const { modelVersion: _ignored, ...rest } = content
			tpl.content = JSON.stringify({
				...DEFAULT_ARTICLE_CONTENT,
				...rest,
				modelVersion: MODEL_VERSION,
			})
			if (!tpl.tags.some((t) => t[0] === 'd')) {
				tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
			}
			resolve(tpl)
		})
	}

	/** Continue editing an existing article (preserves d-tag). */
	static modify(event: ArticleEvent): ArticleFactory {
		if (!isArticle(event)) {
			throw new Error('ArticleFactory.modify: event is not a kind 37520 article')
		}
		return new ArticleFactory((resolve) => resolve(toEventTemplate(event)))
	}

	/** Replace the content payload (re-asserts modelVersion). */
	article(content: Partial<ArticleContent>): this {
		return this.chain((tpl) => {
			let parsed: Partial<ArticleContent>
			try {
				parsed = JSON.parse(tpl.content) as Partial<ArticleContent>
			} catch {
				parsed = {}
			}
			return {
				...tpl,
				content: JSON.stringify({
					...DEFAULT_ARTICLE_CONTENT,
					...parsed,
					...content,
					modelVersion: MODEL_VERSION,
				}),
			}
		})
	}

	bbox(box: GeoBoundingBox | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setBbox(tags, box))
	}

	geohash(centroid: [number, number] | undefined): this {
		return this.modifyPublicTags((tags: string[][]) => setGeohash(tags, centroid))
	}

	hashtags(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setHashtags(tags, values))
	}

	labels(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setLabels(tags, values))
	}

	contextReferences(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setContextRefs(tags, values))
	}

	referencedAddresses(values: string[]): this {
		return this.modifyPublicTags((tags: string[][]) => setReferencedAddresses(tags, values))
	}
}
