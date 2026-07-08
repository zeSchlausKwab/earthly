import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import {
	bboxFromFeatureCollection,
	compactEntity,
	parseBboxArg,
	parseEntityTypes,
	parseStringList,
} from './search-tools'

describe('search-tools arg parsing', () => {
	test('parseEntityTypes defaults to all five kinds', () => {
		expect(parseEntityTypes(undefined).sort()).toEqual([37515, 37518, 37520, 37521, 37522])
	})

	test('parseEntityTypes maps names to kinds', () => {
		expect(parseEntityTypes(['sighting', 'beacon']).sort()).toEqual([37521, 37522])
	})

	test('parseEntityTypes rejects unknown names', () => {
		expect(() => parseEntityTypes(['radio-station'])).toThrow()
	})

	test('parseBboxArg validates shape', () => {
		expect(parseBboxArg([16.1, 48.1, 16.7, 48.4])).toEqual([16.1, 48.1, 16.7, 48.4])
		expect(() => parseBboxArg([16.1, 48.1, 16.7])).toThrow()
		expect(() => parseBboxArg('16.1,48.1,16.7,48.4')).toThrow()
	})

	test('parseStringList rejects mixed arrays', () => {
		expect(() => parseStringList(['a', 1], 'labels')).toThrow()
		expect(parseStringList(['a'], 'labels')).toEqual(['a'])
		expect(parseStringList(undefined, 'labels')).toBeUndefined()
	})
})

describe('bboxFromFeatureCollection', () => {
	test('derives bounds from a drawn polygon', () => {
		const fc: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[16.35, 48.2],
								[16.39, 48.2],
								[16.39, 48.22],
								[16.35, 48.22],
								[16.35, 48.2],
							],
						],
					},
				},
			],
		}
		expect(bboxFromFeatureCollection(fc)).toEqual([16.35, 48.2, 16.39, 48.22])
	})

	test('throws on empty geometry', () => {
		const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
		expect(() => bboxFromFeatureCollection(fc)).toThrow()
	})
})

describe('compactEntity', () => {
	const base = {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1780000000,
		sig: '',
	}

	test('shapes a sighting with naddr and bbox', () => {
		const event: NostrEvent = {
			...base,
			kind: 37522,
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				title: 'Heron at the pond',
				description: 'Grey heron, morning',
				start: 1780000000,
			}),
			tags: [
				['d', 'sight1'],
				['bbox', '16.37,48.21,16.37,48.21'],
				['t', 'birds'],
			],
		}
		const result = compactEntity(event)
		expect(result.type).toBe('sighting')
		expect(result.name).toBe('Heron at the pond')
		expect(result.summary).toBe('Grey heron, morning')
		expect(result.naddr).toStartWith('naddr1')
		expect(result.bbox).toEqual([16.37, 48.21, 16.37, 48.21])
		expect(result.hashtags).toEqual(['birds'])
	})

	test('survives unparseable content', () => {
		const event: NostrEvent = {
			...base,
			kind: 37515,
			content: 'not json',
			tags: [['d', 'ds1']],
		}
		const result = compactEntity(event)
		expect(result.type).toBe('dataset')
		expect(result.name).toBe('ds1')
		expect(result.naddr).toStartWith('naddr1')
	})
})
