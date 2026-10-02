import type { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { naddrToCoordinate } from '@/lib/nostr/references'
import type { RouteSnapshot } from '../store/types'

/** The route owns Story presentation; inspecting one of its Maps only changes the Margin. */
export function resolveRoutedStoryPresentation(
	route: Pick<RouteSnapshot, 'focusType' | 'naddr'>,
	stories: readonly Article[],
	viewedStory: Article | null,
): Article | null {
	if (route.focusType !== 'story' || !route.naddr) return null
	const coordinate = naddrToCoordinate(route.naddr)
	if (!coordinate?.startsWith(`${ARTICLE_KIND}:`)) return null
	const matches = (story: Article) =>
		story.kind === ARTICLE_KIND &&
		`${story.kind}:${story.pubkey}:${story.dTag ?? ''}` === coordinate
	// The reactive inventory carries newer replaceable revisions. An explicitly
	// opened Story can bridge its arrival, but never leak into another Story route.
	return stories.find(matches) ?? (viewedStory && matches(viewedStory) ? viewedStory : null)
}
