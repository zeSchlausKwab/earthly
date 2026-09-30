import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { copyMapletSnapshot, type MapletSnapshotSource } from './snapshot'

function sourceCollection(): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'upstream:polygon',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[12, 44],
							[13, 44],
							[13, 45],
							[12, 44],
						],
					],
				},
				properties: {
					name: 'Source area',
					fillColor: '#123456',
					source: 'Provider',
					sourceMode: 'sample',
					sourceUrl: 'https://example.com/data.json',
					sourceCapturedAt: null,
					nested: { attribution: ['original provider'] },
					featureId: 'renderer-id',
					datasetId: 'dataset-id',
					sourceEventId: 'renderer-event',
					earthlyMapletInstanceId: 'host-instance',
					earthlyMapletFeatureId: 'host-feature',
					mapletSource: { publisher: 'untrusted prior provenance' },
				},
			},
			{
				type: 'Feature',
				id: 42,
				geometry: { type: 'Point', coordinates: [13, 45] },
				properties: null,
			},
		],
	}
}

const source: MapletSnapshotSource = {
	instanceId: 'session-instance',
	title: 'External Layer',
	dTag: 'test-maplet',
	aggregateHash: 'a'.repeat(64),
	publisher: 'b'.repeat(64),
	manifestId: 'c'.repeat(64),
	updatedAt: 1_000,
}

describe('copy Maplet output to editor draft', () => {
	test('assigns fresh editor IDs, preserves source data and attaches authenticated release provenance', () => {
		let id = 0
		const copied = copyMapletSnapshot(
			sourceCollection(),
			source,
			undefined,
			() => `draft-${++id}`,
			() => 2_000,
		)
		expect(copied.features.map((feature) => feature.id)).toEqual(['draft-1', 'draft-2'])
		expect(copied.features[0]?.properties).toMatchObject({
			name: 'Source area',
			fillColor: '#123456',
			source: 'Provider',
			sourceMode: 'sample',
			sourceCapturedAt: null,
			mapletSource: {
				dTag: 'test-maplet',
				aggregateHash: source.aggregateHash,
				publisher: source.publisher,
				manifestId: source.manifestId,
				featureId: 'upstream:polygon',
				copiedAt: '1970-01-01T00:00:02.000Z',
				receivedAt: '1970-01-01T00:00:01.000Z',
			},
		})
		for (const key of [
			'featureId',
			'datasetId',
			'sourceEventId',
			'earthlyMapletInstanceId',
			'earthlyMapletFeatureId',
		]) {
			expect(copied.features[0]?.properties).not.toHaveProperty(key)
		}
		expect(copied.features[1]?.properties?.mapletSource.featureId).toBe('42')
	})

	test('copies complete geometry and deeply isolates draft edits from live output', () => {
		const original = sourceCollection()
		const before = JSON.stringify(original)
		const copied = copyMapletSnapshot(original, source)
		const polygon = copied.features[0]?.geometry
		const originalPolygon = original.features[0]?.geometry
		if (polygon?.type !== 'Polygon' || !polygon.coordinates[0]?.[0])
			throw new Error('Expected complete polygon')
		if (originalPolygon?.type !== 'Polygon') throw new Error('Expected original polygon')
		expect(polygon).toEqual(originalPolygon)
		polygon.coordinates[0][0][0] = 99
		const properties = copied.features[0]?.properties
		if (!properties) throw new Error('Expected copied properties')
		properties.nested.attribution.push('draft-only attribution')
		expect(JSON.stringify(original)).toBe(before)
		const originalProperties = original.features[0]?.properties
		if (!originalProperties) throw new Error('Expected original properties')
		originalProperties.name = 'Updated upstream name'
		expect(properties.name).toBe('Source area')
	})

	test('selects by stable source ID including numeric IDs and does not copy unselected geometry', () => {
		const copied = copyMapletSnapshot(
			sourceCollection(),
			source,
			['42'],
			() => 'new-point',
			() => 2_000,
		)
		expect(copied.features).toHaveLength(1)
		expect(copied.features[0]?.id).toBe('new-point')
		expect(copied.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [13, 45] })
		expect(copyMapletSnapshot(sourceCollection(), source, []).features).toEqual([])
		expect(copyMapletSnapshot(sourceCollection(), source, ['missing']).features).toEqual([])
	})

	test('does not invent a publisher or manifest for bundled Maplets', () => {
		const copied = copyMapletSnapshot(
			sourceCollection(),
			{
				instanceId: 'builtin-session',
				title: 'Bundled',
				dTag: 'bundled:live-mapper',
				aggregateHash: source.aggregateHash,
			},
			undefined,
			() => crypto.randomUUID(),
			() => 2_000,
		)
		const provenance = copied.features[0]?.properties?.mapletSource
		expect(provenance).not.toHaveProperty('publisher')
		expect(provenance).not.toHaveProperty('manifestId')
		expect(provenance).not.toHaveProperty('receivedAt')
		expect(copied.features[0]?.id).not.toBe(copied.features[1]?.id)
	})
})
