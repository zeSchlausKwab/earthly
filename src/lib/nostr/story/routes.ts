import { nip19 } from 'nostr-tools'
import type { Article } from '../article'
import { ARTICLE_KIND } from '../kinds'

/** Canonical distraction-free reader route for a published Story. */
export function getStoryReaderPath(
	story: Pick<Article, 'pubkey' | 'dTag'> & { kind?: number },
): string | null {
	const identifier = story.dTag?.trim()
	if (!identifier || !story.pubkey) return null
	try {
		const naddr = nip19.naddrEncode({
			kind: story.kind ?? ARTICLE_KIND,
			pubkey: story.pubkey,
			identifier,
		})
		return `/read/${naddr}`
	} catch {
		return null
	}
}
