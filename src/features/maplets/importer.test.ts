import { describe, expect, test } from 'bun:test'
import type { Feature, FeatureCollection } from 'geojson'
import { validateMapletCollection } from '@/lib/maplets/collection'
import { createMapletImporter, type MapletImportRecipe } from './importer'
import { mapLiveuamapPayload } from './liveMapper'

const importer = createMapletImporter(mapLiveuamapPayload, validateMapletCollection)
const point = (id?: string, properties: Record<string, unknown> = {}): Feature => ({
	type: 'Feature',
	...(id === undefined ? {} : { id }),
	geometry: { type: 'Point', coordinates: [45, 15] },
	properties,
})
const collection = (features: Feature[]): FeatureCollection => ({
	type: 'FeatureCollection',
	features,
})
const recipe = (overrides: Partial<MapletImportRecipe> = {}): MapletImportRecipe => ({
	version: 1,
	path: [],
	adapter: 'geojson',
	...overrides,
})
const liveRecord = (id = 123) => ({
	id,
	name: `Area ${id}`,
	type_id: 6,
	description: 'Original source description',
	fillcolor: '#123456',
	fillopacity: '0.25',
	strokecolor: '#000000',
	strokeopacity: '0.8',
	strokeweight: '2',
	symbolpath: 'FORWARD_CLOSED_ARROW',
	points: [[15, 45, 16, 45, 16, 46]],
})
const liveLine = (id = 456) => ({
	...liveRecord(id),
	name: `Line ${id}`,
	type_id: 14,
	points: [
		{ id: 2, lat: 33.17959, lng: 35.19161 },
		{ lat: 33.1793, lng: 35.19899 },
		{ id: 0, lat: 33.17872, lng: 35.20535 },
	],
})

describe('Maplet importer discovery', () => {
	test('finds nested collections through object keys and array indexes without duplicating their children', () => {
		const payload = {
			response: [
				{
					nested: collection([
						point('a', { title: 'One', fid: '1' }),
						point('b', { title: 'Two', fid: '2' }),
					]),
				},
			],
		}
		expect(importer.discover(payload)).toEqual([
			{
				path: ['response', '0', 'nested'],
				adapter: 'geojson',
				label: '["response"]["0"]["nested"] · GeoJSON',
				count: 2,
				propertyKeys: ['fid', 'title'],
				suggestedNameProperty: 'title',
				suggestedIdProperty: 'fid',
			},
		])
	})

	test('discovers individual GeoJSON geometries and Features', () => {
		expect(importer.discover(point('a'))[0]?.count).toBe(1)
		const payload = {
			result: {
				geometry: {
					type: 'LineString',
					coordinates: [
						[45, 15],
						[46, 16],
					],
				},
			},
		}
		expect(importer.discover(payload)[0]?.path).toEqual(['result', 'geometry'])
		expect(
			importer.apply(payload, recipe({ path: ['result', 'geometry'] })).featureCollection
				.features[0]?.geometry.type,
		).toBe('LineString')
	})

	test('accepts arrays and dictionaries of Features, preserving dictionary keys as source IDs', () => {
		expect(importer.discover([point('a'), point('b')])[0]?.count).toBe(2)
		const output = importer.apply({ berlin: point(), vienna: point() }, recipe())
		expect(output.featureCollection.features.map((feature) => feature.id)).toEqual([
			'berlin',
			'vienna',
		])
		expect(output.warnings).toEqual([])
	})

	test('does not guess coordinates, bounding boxes, or projected x/y values from arbitrary JSON', () => {
		expect(
			importer.discover({
				records: [{ x: 45, y: 15 }],
				bbox: [40, 10, 50, 20],
				points: [[15, 45, 16, 46]],
			}),
		).toEqual([])
	})

	test('rejects mixed candidate records instead of discovering only the valid subset', () => {
		expect(() => importer.discover([point('a'), { value: 2 }])).toThrow('Mixed GeoJSON')
		expect(() =>
			importer.apply(
				{
					type: 'FeatureCollection',
					features: [point('a'), { type: 'Feature', geometry: null, properties: {} }],
				},
				recipe(),
			),
		).toThrow('Invalid')
		expect(() =>
			importer.discover({ data: { first: liveRecord(), invalid: { other: true } } }),
		).toThrow('Mixed or changed Liveuamap')
	})
})

describe('Liveuamap source forms', () => {
	test('discovers mixed polygon paths and ordered object-coordinate lines in each source form', () => {
		const fields = { area: liveRecord(), line: liveLine() }
		for (const payload of [{ fields, datats: 1789300000 }, fields, liveLine()]) {
			const candidate = importer.discover(payload)[0]
			expect(candidate?.adapter).toBe('liveuamap')
			expect(candidate?.count).toBe(payload === fields || 'fields' in payload ? 2 : 1)
			const { featureCollection, warnings } = importer.apply(
				payload,
				recipe({ adapter: 'liveuamap' }),
			)
			const line = featureCollection.features.find(
				(feature) => feature.properties?.sourceId === '456',
			)
			expect(line?.id).toBe('liveuamap:456:line')
			expect(line?.geometry).toEqual({
				type: 'LineString',
				coordinates: [
					[35.19161, 33.17959],
					[35.19899, 33.1793],
					[35.20535, 33.17872],
				],
			})
			expect(line?.properties).toMatchObject({
				sourceTypeId: 14,
				name: 'Line 456',
				strokeOpacity: 0.8,
			})
			expect(warnings.some((warning) => warning.includes('Geometry-based line IDs'))).toBe(false)
		}
	})

	test('reuses a line recipe with stable identity after coordinates and point metadata change', () => {
		const original = liveLine()
		const selection = recipe({
			adapter: 'liveuamap',
			sourceIds: ['456'],
			retainProperties: ['name', 'strokeColor'],
		})
		const first = importer.apply({ fields: { area: liveRecord(), line: original } }, selection)
		const updated = {
			...original,
			points: original.points.map((point) => ({ lat: point.lat + 0.01, lng: point.lng })),
		}
		const next = importer.apply(updated, selection)
		expect(next.featureCollection.features).toHaveLength(1)
		expect(next.featureCollection.features[0]?.id).toBe(first.featureCollection.features[0]?.id)
		expect(next.featureCollection.features[0]?.geometry).not.toEqual(
			first.featureCollection.features[0]?.geometry,
		)
		expect(next.featureCollection.features[0]?.properties).toMatchObject({
			sourceId: '456',
			sourceTypeId: 14,
			sourceMode: 'imported',
		})
	})

	test('rejects malformed lines and unsupported types without importing only the remaining polygons', () => {
		for (const points of [
			[{ lat: 33, lng: 35 }],
			[
				{ lat: 33, lng: 35 },
				{ lat: 34, lng: '36' },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: 91, lng: 36 },
			],
			[{ lat: 33, lng: 35 }, { lat: 34 }],
			[
				[33, 35],
				[34, 36],
			],
		]) {
			const payload = { fields: { area: liveRecord(), line: { ...liveLine(), points } } }
			expect(() => importer.discover(payload)).toThrow('Invalid Liveuamap')
			expect(() => importer.apply(payload, recipe({ adapter: 'liveuamap' }))).toThrow(
				'Invalid Liveuamap',
			)
		}
		expect(() =>
			importer.apply(
				{
					area: liveRecord(),
					line: {
						...liveLine(),
						points: [
							{ lat: 33, lng: 35 },
							{ lat: 33, lng: 35 },
						],
					},
				},
				recipe({ adapter: 'liveuamap' }),
			),
		).toThrow('degenerate')
		expect(() =>
			importer.discover({
				fields: { area: liveRecord(), unknown: { ...liveLine(), type_id: 99 } },
			}),
		).toThrow('unsupported type 99')
	})

	test('bounds coordinate-object lines before mapping them', () => {
		expect(() =>
			importer.apply(
				{
					...liveLine(),
					points: Array.from({ length: 50_001 }, (_, index) => ({
						lat: 33 + index / 100_000,
						lng: 35,
					})),
				},
				recipe({ adapter: 'liveuamap' }),
			),
		).toThrow('50,000 coordinate limit')
	})

	test('maps full fields response, extracted dictionary, and single record', () => {
		for (const payload of [
			{ fields: { '123': liveRecord() }, datats: 1789297855 },
			{ '123': liveRecord() },
			liveRecord(),
		]) {
			const candidate = importer.discover(payload)[0]
			if (!candidate) throw new Error('Expected a source candidate')
			expect(candidate.adapter).toBe('liveuamap')
			const output = importer.apply(
				payload,
				recipe({ adapter: candidate.adapter, path: candidate.path }),
			)
			expect(output.featureCollection.features[0]?.id).toBe('liveuamap:123:polygon')
			expect(output.featureCollection.features[0]?.geometry.type).toBe('Polygon')
		}
	})

	test('retains original datats and source attribution when other properties are omitted', () => {
		const output = importer.apply(
			{ nested: { fields: { '123': liveRecord() }, datats: 1789297855 } },
			recipe({
				adapter: 'liveuamap',
				path: ['nested'],
				retainProperties: ['name'],
			}),
		)
		const properties = output.featureCollection.features[0]?.properties
		expect(properties?.name).toBe('Area 123')
		expect(properties?.sourceDatats).toBe(1789297855)
		expect(properties?.sourceId).toBe('123')
		expect(properties?.source).toBe('Liveuamap')
		expect(properties?.description).toBeUndefined()
		expect(properties?.sourceUrl).toBeUndefined()
		expect(properties?.sourceMode).toBe('imported')
		expect(output.warnings.some((warning) => warning.includes('Captured sample'))).toBe(false)
	})

	test('only assigns region-specific URL provenance when the host explicitly supplies it', () => {
		const output = importer.apply(liveRecord(), recipe({ adapter: 'liveuamap' }), {
			sourceUrl: 'https://other-region.example.com/data',
		})
		expect(output.featureCollection.features[0]?.properties?.sourceUrl).toBe(
			'https://other-region.example.com/data',
		)
	})

	test('keeps two-point paths explicit and rejects malformed/zero-area paths without partial output', () => {
		const source = liveRecord()
		source.points.push([15, 45, 16, 46])
		const output = importer.apply(source, recipe({ adapter: 'liveuamap' }))
		expect(
			output.featureCollection.features.map((feature) => feature.geometry.type).sort(),
		).toEqual(['LineString', 'Polygon'])
		expect(output.warnings.some((warning) => warning.includes('two-point'))).toBe(true)
		expect(() =>
			importer.apply(
				{ ...source, points: [...source.points, [15, 45, 16]] },
				recipe({ adapter: 'liveuamap' }),
			),
		).toThrow('Invalid Liveuamap path')
		expect(() =>
			importer.apply(
				{ ...source, points: [...source.points, [15, 45, 16, 46, 17, 47]] },
				recipe({ adapter: 'liveuamap' }),
			),
		).toThrow('degenerate')
	})

	test('retains line identities when the source reorders paths', () => {
		const source = {
			...liveRecord(),
			points: [
				[15, 45, 16, 46],
				[16, 45, 17, 46],
			],
		}
		const first = importer.apply(source, recipe({ adapter: 'liveuamap' }))
		const second = importer.apply(
			{ ...source, points: [...source.points].reverse() },
			recipe({ adapter: 'liveuamap' }),
		)
		expect(first.featureCollection.features.map((feature) => feature.id).sort()).toEqual(
			second.featureCollection.features.map((feature) => feature.id).sort(),
		)
		expect(first.warnings.some((warning) => warning.includes('Geometry-based line IDs'))).toBe(true)
	})
})

describe('Declarative import recipes', () => {
	test('selects one nested source and maps IDs/names without losing reserved attribution', () => {
		const payload = {
			first: collection([
				point(undefined, {
					key: 'one',
					title: 'One',
					population: 10,
					noise: true,
					sourceUrl: 'https://example.com/data',
					license: 'CC0',
				}),
			]),
			second: collection([point('other')]),
		}
		const result = importer.apply(
			payload,
			recipe({
				path: ['first'],
				retainProperties: ['population'],
				nameProperty: 'title',
				idProperty: 'key',
			}),
		)
		expect(result.featureCollection.features).toHaveLength(1)
		expect(result.featureCollection.features[0]?.id).toBe('one')
		expect(result.featureCollection.features[0]?.properties).toEqual({
			population: 10,
			name: 'One',
			sourceUrl: 'https://example.com/data',
			license: 'CC0',
		})
		expect(payload.first.features[0]?.properties?.noise).toBe(true)
	})

	test('preserves collection attribution on copied features when all ordinary properties are deselected', () => {
		const result = importer.apply(
			{
				...collection([point('a', { name: 'One' })]),
				license: 'CC0',
				provenance: { source: 'survey' },
			},
			recipe({ retainProperties: [] }),
		)
		expect(result.featureCollection.features[0]?.properties).toEqual({
			license: 'CC0',
			provenance: { source: 'survey' },
		})
	})

	test('filters entire source records before ID remapping and reports missing source IDs', () => {
		const payload = { first: liveRecord(123), second: liveRecord(456) }
		const selection = recipe({ adapter: 'liveuamap', sourceIds: ['456'], idProperty: 'sourceId' })
		const output = importer.apply(payload, selection)
		expect(output.featureCollection.features).toHaveLength(1)
		expect(output.featureCollection.features[0]?.id).toBe('456')
		expect(() => importer.apply(payload, { ...selection, sourceIds: ['missing'] })).toThrow(
			'source record is missing',
		)
		expect(() =>
			importer.apply(
				{ ...payload, first: { ...payload.first, points: [[999, 45, 16, 46]] } },
				selection,
			),
		).toThrow('WGS84')
		const partlyMissing = importer.apply(payload, { ...selection, sourceIds: ['456', 'missing'] })
		expect(
			partlyMissing.warnings.some((warning) => warning.includes('absent from this input')),
		).toBe(true)
	})

	test('content fallback IDs are stable across record/property order and property selection', () => {
		const first = point(undefined, { name: 'One', count: 1 })
		const second = point(undefined, { name: 'Two', count: 2 })
		const forward = importer.apply([first, second], recipe())
		const reverse = importer.apply(
			[second, point(undefined, { count: 1, name: 'One' })],
			recipe({ retainProperties: ['name'] }),
		)
		expect(forward.featureCollection.features[0]?.id).toBe(
			reverse.featureCollection.features[1]?.id,
		)
		expect(forward.featureCollection.features[1]?.id).toBe(
			reverse.featureCollection.features[0]?.id,
		)
		expect(forward.warnings.some((warning) => warning.includes('IDs change when geometry'))).toBe(
			true,
		)
	})

	test('rejects ambiguous duplicate identities rather than appending array indexes', () => {
		expect(() => importer.apply([point('same'), point('same')], recipe())).toThrow(
			'Duplicate feature IDs',
		)
		expect(() => importer.apply([point(), point()], recipe())).toThrow('Duplicate feature IDs')
		expect(() =>
			importer.apply(
				[point('1', { key: 'same' }), point('2', { key: 'same' })],
				recipe({ idProperty: 'key' }),
			),
		).toThrow('Duplicate feature IDs')
	})

	test('fails missing paths, changed adapters, and removed mapped properties', () => {
		expect(() => importer.apply({}, recipe({ path: ['gone'] }))).toThrow('source path')
		expect(() => importer.apply(liveRecord(), recipe())).toThrow('adapter no longer matches')
		expect(() => importer.apply(point('a'), recipe({ retainProperties: ['removed'] }))).toThrow(
			'property "removed" is missing',
		)
		expect(() => importer.apply(point('a'), recipe({ idProperty: 'removed' }))).toThrow(
			'ID mapping',
		)
		expect(() => importer.apply(point('a'), recipe({ nameProperty: 'removed' }))).toThrow(
			'Name mapping',
		)
	})

	test('allows optional diagnostic and acquisition fields to disappear on later source imports', () => {
		const retained = [
			'name',
			'sourceUrl',
			'sourceDatats',
			'geometryDiagnostic',
			'ringInterpretation',
		]
		const output = importer.apply(
			liveRecord(),
			recipe({
				adapter: 'liveuamap',
				retainProperties: retained,
				sourceIds: ['123'],
			}),
		)
		expect(output.featureCollection.features).toHaveLength(1)
		expect(output.featureCollection.features[0]?.properties?.source).toBe('Liveuamap')
		expect(output.featureCollection.features[0]?.properties?.sourceUrl).toBeUndefined()
		expect(() =>
			importer.apply(liveRecord(), recipe({ adapter: 'liveuamap', nameProperty: 'sourceUrl' })),
		).toThrow('Name mapping')
	})
})

describe('Import validation and sandbox serialization', () => {
	test('enforces WGS84, finite numbers, and valid closed rings', () => {
		expect(() =>
			importer.apply(
				{ ...point('a'), geometry: { type: 'Point', coordinates: [45, 95] } },
				recipe(),
			),
		).toThrow('WGS84')
		expect(() =>
			importer.discover({
				...point('a'),
				geometry: { type: 'Point', coordinates: [45, Number.NaN] },
			}),
		).toThrow('nonfinite')
		expect(() =>
			importer.apply(
				{
					type: 'Polygon',
					coordinates: [
						[
							[45, 15],
							[46, 15],
							[46, 16],
						],
					],
				},
				recipe(),
			),
		).toThrow('too few')
		expect(() =>
			importer.apply(
				{
					type: 'Polygon',
					coordinates: [
						[
							[45, 15],
							[46, 15],
							[46, 16],
							[45, 16],
						],
					],
				},
				recipe(),
			),
		).toThrow('ring must be closed')
	})

	test('rejects malicious keys, getters, cycles, oversized raw JSON and deep trees', () => {
		expect(() => importer.parse('{"safe":{"__proto__":{"polluted":true}}}')).toThrow(
			'Unsafe JSON key',
		)
		expect(() => importer.apply(point('a'), recipe({ path: ['constructor'] }))).toThrow(
			'Unsafe JSON key',
		)
		let getterRead = false
		const accessor = {
			get data() {
				getterRead = true
				return point('a')
			},
		}
		expect(() => importer.discover(accessor)).toThrow('accessors')
		expect(getterRead).toBe(false)
		const cycle: Record<string, unknown> = {}
		cycle.self = cycle
		expect(() => importer.discover(cycle)).toThrow('cycle')
		expect(() => importer.parse(`"${'a'.repeat(5 * 1024 * 1024)}"`)).toThrow('5 MiB')
		let nested: unknown = point('a')
		for (let index = 0; index < 26; index++) nested = { nested }
		expect(() => importer.discover(nested)).toThrow('depth')
	})

	test('enforces candidate, node, feature, coordinate, and property budgets', () => {
		expect(() =>
			importer.discover(Array.from({ length: 65 }, () => ({ data: collection([point('a')]) }))),
		).toThrow('64 candidate')
		expect(() => importer.discover(Array.from({ length: 300_000 }, () => 0))).toThrow('node limit')
		expect(() =>
			importer.discover(
				collection(Array.from({ length: 5_001 }, (_, index) => point(String(index)))),
			),
		).toThrow('5,000')
		expect(() =>
			importer.apply(
				{ type: 'MultiPoint', coordinates: Array.from({ length: 50_001 }, () => [45, 15]) },
				recipe(),
			),
		).toThrow('50,000')
		expect(() => importer.apply(point('a', { description: 'é'.repeat(9_000) }), recipe())).toThrow(
			'16 KiB',
		)
	})

	test('factory works when reconstructed without module closures or an injected validator', () => {
		const factory = new Function(
			`return (${createMapletImporter.toString()})`,
		)() as typeof createMapletImporter
		const mapper = new Function(
			`return (${mapLiveuamapPayload.toString()})`,
		)() as typeof mapLiveuamapPayload
		const isolated = factory(mapper)
		const parsed = isolated.parse(JSON.stringify({ nested: collection([point('a')]) }))
		expect(isolated.discover(parsed)[0]?.path).toEqual(['nested'])
		expect(
			isolated.apply(parsed, recipe({ path: ['nested'] })).featureCollection.features[0]?.id,
		).toBe('a')
		expect(
			isolated.apply(liveRecord(), recipe({ adapter: 'liveuamap' })).featureCollection.features,
		).toHaveLength(1)
		expect(
			isolated.apply(liveLine(), recipe({ adapter: 'liveuamap' })).featureCollection.features[0],
		).toMatchObject({ id: 'liveuamap:456:line', geometry: { type: 'LineString' } })
		expect(() => isolated.apply({ type: 'Point', coordinates: [999, 999] }, recipe())).toThrow(
			'WGS84',
		)
	})
})
