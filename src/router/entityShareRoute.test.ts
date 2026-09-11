import { describe, expect, test } from 'bun:test'
import {
	ARTICLE_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { getEntityShareRouteSegment } from './entityShareRoute'

describe('canonical entity share routes', () => {
	test('uses /read for Stories while preserving every other public route', () => {
		expect(getEntityShareRouteSegment(ARTICLE_KIND)).toBe('read')
		expect(getEntityShareRouteSegment(GEO_EVENT_KIND)).toBe('geoevent')
		expect(getEntityShareRouteSegment(MAP_CONTEXT_KIND)).toBe('context')
		expect(getEntityShareRouteSegment(TEMPORAL_SIGHTING_KIND)).toBe('sighting')
		expect(getEntityShareRouteSegment(LIVE_BEACON_KIND)).toBe('beacon')
	})

	test('does not manufacture a route for unsupported event kinds', () => {
		expect(getEntityShareRouteSegment(1)).toBeNull()
	})
})
