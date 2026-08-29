import { afterEach, describe, expect, it } from 'bun:test'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { MAP_CALLOUTS_PROPERTY } from '@/lib/geo/callouts'
import { parseEntityReference } from './entity-tools'
import { dispatch } from './registry'

const PUBKEY = 'a'.repeat(64)
const addedEventIds: string[] = []

afterEach(() => {
	for (const id of addedEventIds.splice(0)) eventStore.remove(id)
})

describe('parseEntityReference', () => {
	it('decodes a bare naddr', () => {
		const naddr = nip19.naddrEncode({ kind: 37520, pubkey: PUBKEY, identifier: 'my-story' })
		expect(parseEntityReference(naddr)).toEqual({
			kind: 37520,
			pubkey: PUBKEY,
			identifier: 'my-story',
		})
	})

	it('strips the nostr: prefix and returns a #featureId fragment', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'lanes' })
		expect(parseEntityReference(`nostr:${naddr}#feature-7`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'lanes',
			featureId: 'feature-7',
		})
	})

	it('decodes OSM-style feature selectors from a canonical mention', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'lanes' })
		expect(parseEntityReference(`nostr:${naddr}#relation%2F62504`).featureId).toBe('relation/62504')
	})

	it('accepts a kind:pubkey:d coordinate', () => {
		expect(parseEntityReference(`37518:${PUBKEY}:topic-1`)).toEqual({
			kind: 37518,
			pubkey: PUBKEY,
			identifier: 'topic-1',
		})
	})

	it('keeps colons inside the d-tag of a coordinate', () => {
		expect(parseEntityReference(`37515:${PUBKEY}:a:b:c`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'a:b:c',
		})
	})

	it('rejects empty and malformed references', () => {
		expect(() => parseEntityReference('')).toThrow()
		expect(() => parseEntityReference(undefined)).toThrow()
		expect(() => parseEntityReference('naddr1notreal')).toThrow()
		expect(() => parseEntityReference('37515:onlytwo')).toThrow()
		expect(() => parseEntityReference('nan:pk:d')).toThrow()
	})
})

describe('read_entity dataset callout inventory', () => {
	it('reports compact callout counts and summaries without returning unbounded text', async () => {
		const identifier = 'flood-map'
		const longText = `Timeline detail: ${'downstream '.repeat(100)}`
		const event = finalizeEvent(
			{
				kind: GEO_EVENT_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					type: 'FeatureCollection',
					name: 'Flood map',
					features: [
						{
							type: 'Feature',
							id: 'river-route',
							geometry: {
								type: 'LineString',
								coordinates: [
									[85, 28],
									[85.1, 27.9],
								],
							},
							properties: {
								name: 'Trishuli flood route',
								[MAP_CALLOUTS_PROPERTY]: [
									{
										id: 'callout-a',
										title: 'Border crossing damaged',
										text: 'The crossing was reported damaged at 08:44.',
									},
									{ id: 'callout-b', text: longText },
								],
							},
						},
					],
				}),
			},
			generateSecretKey(),
		)
		eventStore.add(event)
		addedEventIds.push(event.id)

		const result = (await dispatch('read_entity', {
			reference: `${GEO_EVENT_KIND}:${event.pubkey}:${identifier}`,
		})) as {
			calloutCount?: number
			calloutFeatureCount?: number
			features?: Array<{
				id: string
				calloutCount?: number
				callouts?: Array<{
					id: string
					title?: string
					text: string
					textTruncated?: boolean
				}>
			}>
		}

		expect(result.calloutCount).toBe(2)
		expect(result.calloutFeatureCount).toBe(1)
		expect(result.features?.[0]).toMatchObject({
			id: 'river-route',
			calloutCount: 2,
			callouts: [
				{
					id: 'callout-a',
					title: 'Border crossing damaged',
					text: 'The crossing was reported damaged at 08:44.',
				},
				{ id: 'callout-b', textTruncated: true },
			],
		})
		expect(result.features?.[0]?.callouts?.[1]?.text.length).toBeLessThan(300)
		expect(JSON.stringify(result)).not.toContain(longText)
	})
})
