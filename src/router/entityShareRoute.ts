import {
	ARTICLE_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'

export type EntityShareRouteSegment = 'geoevent' | 'context' | 'read' | 'sighting' | 'beacon'

/** Map an event kind to its canonical public share-route segment. */
export function getEntityShareRouteSegment(kind: number): EntityShareRouteSegment | null {
	switch (kind) {
		case GEO_EVENT_KIND:
			return 'geoevent'
		case MAP_CONTEXT_KIND:
			return 'context'
		case ARTICLE_KIND:
			return 'read'
		case TEMPORAL_SIGHTING_KIND:
			return 'sighting'
		case LIVE_BEACON_KIND:
			return 'beacon'
		default:
			return null
	}
}
