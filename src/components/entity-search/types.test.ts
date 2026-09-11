import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import {
	ENTITY_TYPE_LABELS,
	parsePersonProfile,
	personToSearchResult,
	placeToSearchResult,
	type PlaceSearchEntity,
} from './types'

const profileEvent: NostrEvent = {
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	created_at: 42,
	kind: 0,
	tags: [],
	content: JSON.stringify({
		name: 'aria',
		display_name: 'Aria Voss',
		nip05: 'aria@example.test',
		about: 'Maps paths through history',
	}),
	sig: 'c'.repeat(128),
}

const place: PlaceSearchEntity = {
	placeId: 7,
	displayName: 'Vienna, Austria',
	osmType: 'relation',
	osmId: 16239,
	coordinates: { lat: 48.2082, lon: 16.3738 },
	boundingbox: [16.18, 48.11, 16.58, 48.32],
	type: 'administrative',
	class: 'boundary',
}

describe('search result adapters', () => {
	test('uses the rewrite nouns while retaining internal entity discriminants', () => {
		expect(ENTITY_TYPE_LABELS.dataset).toBe('Maps')
		expect(ENTITY_TYPE_LABELS.context).toBe('Atlases')
		expect(ENTITY_TYPE_LABELS.story).toBe('Stories')
		expect(ENTITY_TYPE_LABELS.sighting).toBe('Sightings')
		expect(ENTITY_TYPE_LABELS.person).toBe('People')
	})

	test('turns a kind-0 event into one stable Person row keyed by pubkey', () => {
		const result = personToSearchResult(profileEvent)
		expect(result).toMatchObject({
			id: profileEvent.pubkey,
			name: 'Aria Voss',
			type: 'person',
			subtitle: 'aria@example.test',
			pubkey: profileEvent.pubkey,
		})
	})

	test('treats malformed profile JSON as an anonymous but searchable identity', () => {
		expect(parsePersonProfile('{broken')).toEqual({})
		expect(personToSearchResult({ ...profileEvent, content: '{broken' }).name).toContain('…')
	})

	test('adapts the existing geocoder result without changing its coordinates', () => {
		const result = placeToSearchResult(place)
		expect(result).toMatchObject({
			id: '7',
			name: 'Vienna, Austria',
			type: 'place',
			subtitle: 'administrative · boundary',
			entity: place,
		})
	})
})
