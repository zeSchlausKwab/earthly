import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { castEvent } from 'applesauce-core/casts'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import {
	FIELD_SESSION_RECORD_KIND,
	fieldSessionDatasetFactory,
	fieldSessionMessageTemplate,
	latestFieldSessionDatasetEvents,
	parseFieldSessionMessage,
} from './events'

const geometry: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [16.37, 48.21] },
			properties: { name: 'Spring' },
		},
	],
}

describe('Field-session records', () => {
	test('a signed message remains scoped to its Field session', () => {
		const event = finalizeEvent(
			fieldSessionMessageTemplate('survey-123', 'Found a spring'),
			generateSecretKey(),
		)
		const message = parseFieldSessionMessage(event, 'survey-123')
		expect(event.kind).toBe(FIELD_SESSION_RECORD_KIND)
		expect(message?.text).toBe('Found a spring')
		expect(parseFieldSessionMessage(event, 'another-session')).toBeNull()
	})

	test('empty messages are rejected before signing', () => {
		expect(() => fieldSessionMessageTemplate('survey-123', '   ')).toThrow(
			'Write a message or attach geometry',
		)
	})

	test('geometry may be attached without requiring comment text', () => {
		const event = finalizeEvent(
			fieldSessionMessageTemplate('survey-123', '', geometry),
			generateSecretKey(),
		)
		expect(parseFieldSessionMessage(event, 'survey-123')?.geometry).toEqual(geometry)
		expect(event.tags.find((tag) => tag[0] === 'bbox')?.[1]).toBe('16.37,48.21,16.37,48.21')
	})

	test('the geometry overview keeps only the latest signed dataset version', async () => {
		const key = generateSecretKey()
		const signer = {
			getPublicKey: async () =>
				finalizeEvent({ kind: 1, created_at: 0, content: '', tags: [] }, key).pubkey,
			signEvent: async (template: Parameters<typeof finalizeEvent>[0]) =>
				finalizeEvent(template, key),
		}
		const first = await fieldSessionDatasetFactory(geometry, 'survey-123').sign(signer)
		const firstDataset = castEvent(first, GeoDataset, eventStore)
		const second = await fieldSessionDatasetFactory(geometry, 'survey-123', firstDataset).sign(
			signer,
		)
		const expected =
			second.created_at > first.created_at ||
			(second.created_at === first.created_at && second.id > first.id)
				? second
				: first
		expect(latestFieldSessionDatasetEvents([first, second], 'survey-123')).toEqual([expected])
		expect(latestFieldSessionDatasetEvents([first, second], 'another-session')).toEqual([])
	})
})
