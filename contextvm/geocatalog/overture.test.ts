import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { openSqliteGeoCatalog, type GeoCatalogJsonValue } from './index'
import {
	createOvertureSourceRelease,
	isSelectedOvertureInfrastructure,
	isSelectedOvertureWater,
	normalizeOvertureFeature,
	parseOvertureInputSpec,
	readOvertureGeoJsonSequence,
} from './overture'
import {
	buildOvertureGeoCatalogSnapshot,
	parseBuildGeoCatalogArgs,
} from '../../scripts/build-geocatalog'

const RELEASE = '2026-08-19.0'
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixturePath = (name: string): string => join(FIXTURES, name)
const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	)
})

async function temporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'earthly-overture-test-'))
	temporaryDirectories.push(path)
	return path
}

async function fixtureRecord(name: string, index = 0): Promise<unknown> {
	const lines = (await Bun.file(fixturePath(name)).text())
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
	const line = lines[index]
	if (!line) throw new Error(`Missing fixture record ${name}:${index + 1}`)
	return JSON.parse(line)
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
	const collected: T[] = []
	for await (const value of values) collected.push(value)
	return collected
}

describe('Overture feature normalization', () => {
	test('normalizes division areas with stable identity and provenance', async () => {
		const feature = await fixtureRecord('overture-division-area.ndjson')
		const first = normalizeOvertureFeature(feature, {
			release: RELEASE,
			featureType: 'division_area',
		})
		const second = normalizeOvertureFeature(feature, {
			release: RELEASE,
			featureType: 'division_area',
		})

		expect(second).toEqual(first)
		expect(first).toMatchObject({
			id: 'overture:divisions:division_area:division-area-vienna',
			kind: 'admin',
			name: 'Vienna',
			aliases: ['City of Vienna', 'Wien'],
			categories: ['administrative-boundary', 'region'],
			countryCode: 'AT',
			adminLevel: 1,
			bbox: [16.18, 48.11, 16.58, 48.33],
			center: { longitude: 16.38, latitude: 48.22 },
			source: { name: 'Overture Maps', release: RELEASE, recordId: 'division-area-vienna' },
			properties: {
				overtureTheme: 'divisions',
				overtureType: 'division_area',
				sources: [
					{
						property: '',
						dataset: 'OpenStreetMap',
						license: 'ODbL-1.0',
						record_id: 'relation/62422',
					},
				],
				divisionId: 'division-vienna',
				adminLevel: 1,
				isLand: true,
			},
		})
	})

	test('normalizes division points as stable locality records with division metadata', () => {
		const entry = normalizeOvertureFeature(
			{
				type: 'Feature',
				id: 'd1e2fe75-9d99-4cfb-970f-62082f03e0bc',
				geometry: { type: 'Point', coordinates: [85.2960583, 28.1127948] },
				properties: {
					theme: 'divisions',
					type: 'division',
					country: 'NP',
					version: 3,
					sources: [
						{
							property: '',
							dataset: 'OpenStreetMap',
							license: 'ODbL-1.0',
							record_id: 'node/10315965426',
						},
					],
					subtype: 'macrohood',
					names: {
						primary: 'धुन्चे',
						common: [
							['en', 'Dhunche'],
							['ne', 'धुन्चे'],
						],
						rules: null,
					},
					local_type: [['en', 'suburb']],
					region: 'NP-P3',
					hierarchies: [
						[
							{
								division_id: '05661c9d-68f5-4a26-a653-05f6ef959b50',
								subtype: 'country',
								name: 'नेपाल',
							},
							{
								division_id: 'd1e2fe75-9d99-4cfb-970f-62082f03e0bc',
								subtype: 'macrohood',
								name: 'धुन्चे',
							},
						],
					],
					parent_division_id: '35cf3dc7-c842-456a-88b4-9707de33d3f3',
					capital_of_divisions: [
						{
							division_id: '3e190a02-07d1-45d8-97c5-d52d02295d28',
							subtype: 'county',
						},
					],
				},
			},
			{ release: RELEASE, featureType: 'division' },
		)

		expect(entry).toMatchObject({
			id: 'overture:divisions:division:d1e2fe75-9d99-4cfb-970f-62082f03e0bc',
			kind: 'locality',
			name: 'धुन्चे',
			aliases: ['Dhunche'],
			categories: ['macrohood', 'suburb'],
			countryCode: 'NP',
			bbox: [85.2960583, 28.1127948, 85.2960583, 28.1127948],
			center: { longitude: 85.2960583, latitude: 28.1127948 },
			source: {
				name: 'Overture Maps',
				release: RELEASE,
				recordId: 'd1e2fe75-9d99-4cfb-970f-62082f03e0bc',
			},
			properties: {
				overtureTheme: 'divisions',
				overtureType: 'division',
				divisionId: 'd1e2fe75-9d99-4cfb-970f-62082f03e0bc',
				subtype: 'macrohood',
				localType: { en: 'suburb' },
				region: 'NP-P3',
				parentDivisionId: '35cf3dc7-c842-456a-88b4-9707de33d3f3',
				capitalOfDivisions: [
					{
						division_id: '3e190a02-07d1-45d8-97c5-d52d02295d28',
						subtype: 'county',
					},
				],
			},
		})
		expect(entry?.properties.hierarchies).toHaveLength(1)
	})

	test('keeps administrative division points out of locality results', () => {
		const entry = normalizeOvertureFeature(
			{
				type: 'Feature',
				id: 'division-rasuwa-county-label',
				geometry: { type: 'Point', coordinates: [85.3, 28.1] },
				properties: {
					theme: 'divisions',
					type: 'division',
					country: 'NP',
					subtype: 'county',
					names: { primary: 'रसुवा जिल्ला', common: [['en', 'Rasuwa']] },
				},
			},
			{ release: RELEASE, featureType: 'division' },
		)

		expect(entry).toMatchObject({
			id: 'overture:divisions:division:division-rasuwa-county-label',
			kind: 'admin',
			name: 'रसुवा जिल्ला',
			aliases: ['Rasuwa'],
			categories: ['administrative-label', 'county'],
			countryCode: 'NP',
		})
	})

	test('preserves current place taxonomy alongside deprecated categories', async () => {
		const entry = normalizeOvertureFeature(await fixtureRecord('overture-place.ndjson'), {
			release: RELEASE,
			featureType: 'place',
		})

		expect(entry).toMatchObject({
			id: 'overture:places:place:place-kathmandu-museum',
			kind: 'place',
			name: 'Kathmandu Museum',
			aliases: ['Museum of Kathmandu', 'काठमाडौं सङ्ग्रहालय'],
			categories: [
				'arts_and_entertainment',
				'history_museum',
				'museum',
				'tourist_attraction',
			],
			countryCode: 'NP',
			bbox: [85.324, 27.717, 85.324, 27.717],
			center: { longitude: 85.324, latitude: 27.717 },
			properties: {
				sources: [
					{
						property: '',
						dataset: 'Foursquare',
						license: 'Apache-2.0',
						record_id: 'fsq-kathmandu-museum',
					},
				],
				basicCategory: 'museum',
				taxonomy: {
					primary: 'history_museum',
					hierarchy: ['arts_and_entertainment', 'museum', 'history_museum'],
				},
				categories: { primary: 'museum' },
				confidence: 0.91,
			},
		})
	})

	test('preserves native source records for every supported feature type', async () => {
		const cases = [
			['division_area', 'overture-division-area.ndjson'],
			['place', 'overture-place.ndjson'],
			['segment', 'overture-segment.ndjson'],
			['infrastructure', 'overture-infrastructure.ndjson'],
			['water', 'overture-water.ndjson'],
		] as const

		for (const [featureType, fixture] of cases) {
			const feature = (await fixtureRecord(fixture)) as {
				properties: { sources: GeoCatalogJsonValue }
			}
			const entry = normalizeOvertureFeature(feature, { release: RELEASE, featureType })
			expect(entry?.properties.sources).toEqual(feature.properties.sources)
		}
	})

	test('accepts projected GeoJSON Features that omit theme and native type columns', () => {
		const entry = normalizeOvertureFeature(
			{
				type: 'Feature',
				id: 'projected-place',
				bbox: [16, 48, 100, 17, 49, 200],
				geometry: { type: 'Point', coordinates: [16.5, 48.5, 150] },
				properties: { name: 'Projected place', basic_category: 'museum' },
			},
			{ release: RELEASE, featureType: 'place' },
		)

		expect(entry).toMatchObject({
			id: 'overture:places:place:projected-place',
			name: 'Projected place',
			bbox: [16, 48, 17, 49],
			center: { longitude: 16.5, latitude: 48.5 },
		})
	})

	test('maps transportation subtypes and uses route names as fallbacks', async () => {
		const entries = await collect(
			readOvertureGeoJsonSequence(
				{ featureType: 'segment', path: fixturePath('overture-segment.ndjson') },
				{ release: RELEASE },
			),
		)

		expect(entries.map((entry) => [entry.kind, entry.name])).toEqual([
			['road', 'Prithvi Highway'],
			['road', 'Prithvi Highway'],
			['rail', 'Vienna Airport Railway'],
			['waterway', 'Stockholm Ferry Route'],
		])
		expect(entries[0]).toMatchObject({
			id: 'overture:transportation:segment:segment-prithvi',
			aliases: ['AH42', 'Asian Highway 42', 'पृथ्वी राजमार्ग'],
			categories: ['primary', 'road'],
			countryCode: 'NP',
			bbox: [84.42, 27.71, 85.01, 27.82],
			properties: {
				class: 'primary',
				connectors: [
					{ connector_id: 'connector-a', at: 0 },
					{ connector_id: 'connector-b', at: 1 },
				],
			},
		})
	})

	test('admits only the reviewed infrastructure classes', async () => {
		const selected = await fixtureRecord('overture-infrastructure.ndjson')
		const ignored = await fixtureRecord('overture-infrastructure.ndjson', 1)
		const dirtySourceCountry = structuredClone(selected) as Record<string, unknown>
		const dirtyProperties = dirtySourceCountry.properties as Record<string, unknown>
		dirtyProperties.source_tags = { 'addr:country': 'Austria', railway: 'station' }

		expect(isSelectedOvertureInfrastructure(selected)).toBe(true)
		expect(isSelectedOvertureInfrastructure(ignored)).toBe(false)
		expect(
			normalizeOvertureFeature(selected, {
				release: RELEASE,
				featureType: 'infrastructure',
			}),
		).toMatchObject({
			id: 'overture:base:infrastructure:infra-wien-mitte',
			kind: 'infrastructure',
			name: 'Wien Mitte',
			aliases: ['Vienna Mitte'],
			categories: ['railway_station', 'transit'],
			countryCode: 'AT',
			properties: { subtype: 'transit', class: 'railway_station', wikidata: 'Q873397' },
		})
		expect(
			normalizeOvertureFeature(ignored, {
				release: RELEASE,
				featureType: 'infrastructure',
			}),
		).toBeNull()
		expect(
			normalizeOvertureFeature(dirtySourceCountry, {
				release: RELEASE,
				featureType: 'infrastructure',
			})?.countryCode,
		).toBeUndefined()
	})

	test('keeps named Overture water features distinct from transportation water routes', async () => {
		const river = await fixtureRecord('overture-water.ndjson')
		const unnamedPond = await fixtureRecord('overture-water.ndjson', 1)

		expect(isSelectedOvertureWater(river)).toBe(true)
		expect(isSelectedOvertureWater(unnamedPond)).toBe(false)
		expect(
			normalizeOvertureFeature(river, { release: RELEASE, featureType: 'water' }),
		).toMatchObject({
			id: 'overture:base:water:water-danube-segment',
			kind: 'waterway',
			name: 'Danube',
			aliases: ['Donau', 'Dunaj'],
			categories: ['river'],
			properties: {
				overtureTheme: 'base',
				overtureType: 'water',
				subtype: 'river',
				class: 'river',
				isIntermittent: false,
			},
		})
		expect(
			normalizeOvertureFeature(unnamedPond, { release: RELEASE, featureType: 'water' }),
		).toBeNull()
	})

	test('decodes tuple-form names and source tags from Overture GeoJSON exports', () => {
		const entry = normalizeOvertureFeature(
			{
				type: 'Feature',
				id: 'water-lende-khola',
				geometry: {
					type: 'LineString',
					coordinates: [
						[85.4399756, 28.3353006],
						[85.4311091, 28.3306367],
					],
				},
				properties: {
					theme: 'base',
					type: 'water',
					subtype: 'river',
					class: 'river',
					names: {
						primary: '东林藏布',
						common: [
							['en', 'Lende Khola'],
							['zh', '东林藏布'],
						],
						rules: null,
					},
					source_tags: [
						['addr:country', 'NP'],
						['waterway', 'river'],
					],
				},
			},
			{ release: RELEASE, featureType: 'water' },
		)

		expect(entry).toMatchObject({
			name: '东林藏布',
			aliases: ['Lende Khola'],
			countryCode: 'NP',
			properties: {
				sourceTags: {
					'addr:country': 'NP',
					waterway: 'river',
				},
			},
		})
	})

	test('rejects a spec/record type mismatch instead of misclassifying it', async () => {
		const place = await fixtureRecord('overture-place.ndjson')
		expect(() =>
			normalizeOvertureFeature(place, {
				release: RELEASE,
				featureType: 'segment',
			}),
		).toThrow('Expected Overture theme transportation')
	})

	test('rejects geometry with the wrong nesting for its declared type', () => {
		expect(() =>
			normalizeOvertureFeature(
				{
					type: 'Feature',
					id: 'bad-point',
					geometry: { type: 'Point', coordinates: [[16, 48]] },
					properties: { name: 'Bad point' },
				},
				{ release: RELEASE, featureType: 'place' },
			),
		).toThrow('place.geometry contains invalid coordinates')
	})

	test('rejects undersized lines and invalid polygon rings, including nested rings', () => {
		expect(() =>
			normalizeOvertureFeature(
				{
					type: 'Feature',
					id: 'short-segment',
					geometry: { type: 'LineString', coordinates: [[16, 48]] },
					properties: { subtype: 'road', names: { primary: 'Short road' } },
				},
				{ release: RELEASE, featureType: 'segment' },
			),
		).toThrow('segment.geometry has invalid GeoJSON cardinality or ring closure')

		const divisionProperties = {
			subtype: 'region',
			names: { primary: 'Invalid division' },
		}
		expect(() =>
			normalizeOvertureFeature(
				{
					type: 'Feature',
					id: 'short-ring',
					geometry: {
						type: 'Polygon',
						coordinates: [[[16, 48], [17, 48], [16, 48]]],
					},
					properties: divisionProperties,
				},
				{ release: RELEASE, featureType: 'division_area' },
			),
		).toThrow('division_area.geometry has invalid GeoJSON cardinality or ring closure')

		expect(() =>
			normalizeOvertureFeature(
				{
					type: 'Feature',
					id: 'open-ring',
					geometry: {
						type: 'Polygon',
						coordinates: [[[16, 48], [17, 48], [17, 49], [16, 49]]],
					},
					properties: divisionProperties,
				},
				{ release: RELEASE, featureType: 'division_area' },
			),
		).toThrow('division_area.geometry has invalid GeoJSON cardinality or ring closure')

		expect(() =>
			normalizeOvertureFeature(
				{
					type: 'Feature',
					id: 'nested-open-ring',
					geometry: {
						type: 'MultiPolygon',
						coordinates: [
							[[[16, 48], [17, 48], [17, 49], [16, 48]]],
							[[[18, 48], [19, 48], [19, 49], [18, 49]]],
						],
					},
					properties: divisionProperties,
				},
				{ release: RELEASE, featureType: 'division_area' },
			),
		).toThrow('division_area.geometry has invalid GeoJSON cardinality or ring closure')
	})
})

describe('Overture sequence streaming', () => {
	test('reads multiline record-separated GeoJSONSeq without treating it as NDJSON', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'places.geojsonseq')
		const first = (await fixtureRecord('overture-place.ndjson')) as Record<string, unknown>
		const second = structuredClone(first)
		const properties = second.properties as Record<string, unknown>
		properties.id = 'place-kathmandu-museum-2'
		await Bun.write(
			path,
			`\u001e${JSON.stringify(first, null, 2)}\n\u001e${JSON.stringify(second, null, 2)}\n`,
		)

		const entries = await collect(
			readOvertureGeoJsonSequence({ featureType: 'place', path }, { release: RELEASE }),
		)
		expect(entries.map((entry) => entry.id)).toEqual([
			'overture:places:place:place-kathmandu-museum',
			'overture:places:place:place-kathmandu-museum-2',
		])
	})

	test('reports malformed NDJSON with file and record context', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'places.ndjson')
		const valid = await fixtureRecord('overture-place.ndjson')
		await Bun.write(path, `${JSON.stringify(valid)}\n{"type":\n`)
		await expect(
			collect(
				readOvertureGeoJsonSequence(
					{ featureType: 'place', path },
					{ release: RELEASE },
				),
			),
		).rejects.toThrow(`${path}: record 2 is not valid JSON`)
	})

	test('streams gzip-compressed GeoJSONSeq without expanding it on disk', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'places.geojsonseq.gz')
		const first = (await fixtureRecord('overture-place.ndjson')) as Record<string, unknown>
		const second = structuredClone(first)
		const properties = second.properties as Record<string, unknown>
		properties.id = 'place-kathmandu-museum-gzip'
		await Bun.write(
			path,
			gzipSync(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`),
		)

		const entries = await collect(
			readOvertureGeoJsonSequence({ featureType: 'place', path }, { release: RELEASE }),
		)
		expect(entries.map((entry) => entry.id)).toEqual([
			'overture:places:place:place-kathmandu-museum',
			'overture:places:place:place-kathmandu-museum-gzip',
		])
	})
})

	describe('Overture snapshot builder', () => {
	test('scopes attribution and license families to the input feature types', () => {
		const places = createOvertureSourceRelease(RELEASE, ['place'])
		expect(places).toMatchObject({
			name: 'Overture Maps',
			release: RELEASE,
			attribution:
				'Overture Maps Foundation; Copyright 2024 Foursquare Labs, Inc. All rights reserved. ' +
				'Foursquare data was transformed to the Overture schema. Changed: 2026-03-18.; ' +
				'Data from AllThePlaces; Earthly modification notice: Overture Places records were ' +
				'filtered and normalized into GeoCatalog and editor fields; native record identifiers ' +
				'and per-feature source records were retained.; Per-feature provenance is retained in ' +
				'properties.sources; ' +
				'consult the release attribution manifest',
			attributionUrl: 'https://docs.overturemaps.org/attribution/',
			license:
				'CDLA-Permissive-2.0, Apache-2.0, CC0-1.0 ' +
				'(varies by theme and source)',
		})
		const foursquareNotice = places.documents?.find(
			(document) => document.name === 'Foursquare OS Places NOTICE.txt',
		)
		expect(foursquareNotice).toMatchObject({
			url: 'https://opensource.foursquare.com/places-notice-txt/',
		})
		expect(foursquareNotice?.content).toContain(
			'preserving the full content of this NOTICE.txt file',
		)
		expect(foursquareNotice?.content).toContain('provide recipients with a copy of the License')
		const apacheLicense = places.documents?.find(
			(document) => document.name === 'Apache License 2.0',
		)
		expect(apacheLicense).toMatchObject({
			url: 'https://www.apache.org/licenses/LICENSE-2.0.txt',
		})
		expect(apacheLicense?.content).toContain('TERMS AND CONDITIONS FOR USE')
		expect(apacheLicense?.content).toContain(
			'You must give any other recipients of the Work',
		)
		expect(places.attribution).toContain('Earthly modification notice:')
		expect(places.attribution).not.toContain('OpenStreetMap')
		expect(places.license).not.toContain('ODbL')

		const odblThemes = createOvertureSourceRelease(RELEASE, [
			'division_area',
			'segment',
			'infrastructure',
			'water',
		])
		expect(odblThemes).toMatchObject({
			name: 'Overture Maps',
			release: RELEASE,
			attribution:
				'Overture Maps Foundation; © OpenStreetMap contributors, Overture Maps Foundation; ' +
				'Per-feature provenance is retained in properties.sources; consult the release attribution manifest',
			attributionUrl: 'https://docs.overturemaps.org/attribution/',
			license: 'ODbL-1.0 (varies by theme and source)',
		})
		expect(odblThemes.documents).toContainEqual({
			name: 'Open Database License 1.0',
			url: 'https://opendatacommons.org/licenses/odbl/1-0/',
		})

		const mixed = createOvertureSourceRelease(RELEASE, ['water', 'place', 'segment'])
		expect(mixed.attribution).toContain('OpenStreetMap contributors')
		expect(mixed.attribution).toContain('Copyright 2024 Foursquare Labs')
		expect(mixed.license).toContain('ODbL-1.0')
		expect(mixed.license).toContain('CDLA-Permissive-2.0, Apache-2.0, CC0-1.0')
	})

	test('parses explicit local input specs and required CLI flags', () => {
		expect(parseOvertureInputSpec('transportation/segment=./segments.ndjson')).toEqual({
			featureType: 'segment',
			path: './segments.ndjson',
		})
		const options = parseBuildGeoCatalogArgs([
			`--release=${RELEASE}`,
			'--snapshot-id',
			'earthly-overture-test',
			'--output=./catalog.sqlite',
			'--input',
			'place=./places.ndjson',
			'--corridor-source-fragments=staging-only',
			'--format=json',
		])
		expect(options).toMatchObject({
			release: RELEASE,
			snapshotId: 'earthly-overture-test',
			output: resolve('./catalog.sqlite'),
			inputs: [{ featureType: 'place', path: resolve('./places.ndjson') }],
			corridorSourceFragments: 'staging-only',
			format: 'json',
		})
		expect(parseBuildGeoCatalogArgs(['--help'])).toBeNull()
		expect(() => parseOvertureInputSpec('place=https://example.test/places.ndjson')).toThrow(
			'explicit local file path',
		)
		expect(() =>
			parseBuildGeoCatalogArgs(['--snapshot-id=x', '--output=x', 'place=places.ndjson']),
		).toThrow('--release is required')
		expect(() =>
			parseBuildGeoCatalogArgs([
				'--release=latest',
				'--snapshot-id=x',
				'--output=x',
				'place=places.ndjson',
			]),
		).toThrow('dated YYYY-MM-DD.N format')
		expect(() =>
			parseBuildGeoCatalogArgs([
				`--release=${RELEASE}`,
				'--snapshot-id=x',
				'--output=x',
				'--corridor-source-fragments=discard',
				'place=places.ndjson',
			]),
		).toThrow('--corridor-source-fragments must be retain or staging-only')
	})

	test('streams fixtures into a queryable immutable SQLite snapshot', async () => {
		const directory = await temporaryDirectory()
		const output = join(directory, 'catalog.sqlite')
		const stagingDirectoryRoot = join(directory, 'staging')
		await mkdir(stagingDirectoryRoot)
		const options = {
			release: RELEASE,
			snapshotId: 'earthly-overture-fixture-v1',
			createdAt: '2026-08-28T10:00:00Z',
			output,
			stagingDirectoryRoot,
			inputs: [
				{
					featureType: 'division_area' as const,
					path: fixturePath('overture-division-area.ndjson'),
				},
				{ featureType: 'place' as const, path: fixturePath('overture-place.ndjson') },
				{ featureType: 'segment' as const, path: fixturePath('overture-segment.ndjson') },
				{
					featureType: 'infrastructure' as const,
					path: fixturePath('overture-infrastructure.ndjson'),
				},
				{ featureType: 'water' as const, path: fixturePath('overture-water.ndjson') },
			],
		}
		const result = await buildOvertureGeoCatalogSnapshot(options)
		expect(await readdir(stagingDirectoryRoot)).toEqual([])

		expect(result).toMatchObject({
			output,
			inputFiles: 5,
			recordsRead: 10,
			entriesWritten: 9,
			sourceFragmentsStagedOnly: 0,
			corridorsWritten: 1,
			recordsSkipped: 2,
			byType: {
				division_area: { recordsRead: 1, entriesWritten: 1, recordsSkipped: 0 },
				place: { recordsRead: 1, entriesWritten: 1, recordsSkipped: 0 },
				segment: { recordsRead: 4, entriesWritten: 4, recordsSkipped: 0 },
				infrastructure: { recordsRead: 2, entriesWritten: 1, recordsSkipped: 1 },
				water: { recordsRead: 2, entriesWritten: 1, recordsSkipped: 1 },
			},
		})
		expect(result.snapshot).toEqual({
			id: 'earthly-overture-fixture-v1',
			createdAt: '2026-08-28T10:00:00.000Z',
			schemaVersion: 1,
			sources: [
				createOvertureSourceRelease(
					RELEASE,
					options.inputs.map((input) => input.featureType),
				),
			],
		})

		const catalog = openSqliteGeoCatalog({ path: output })
		const all = await catalog.query({ limit: 20, includeGeometry: true })
		expect(all.items).toHaveLength(9)
		expect(all.metadata.snapshot.sources[0]).toEqual(
			createOvertureSourceRelease(
				RELEASE,
				options.inputs.map((input) => input.featureType),
			),
		)
		expect(all.items.map((entry) => entry.id)).not.toContain(
			'overture:base:infrastructure:infra-ordinary-bench',
		)
		expect(all.items.map((entry) => entry.id)).toContain(
			'overture:transportation:segment:segment-prithvi',
		)
		expect(all.items.map((entry) => entry.id)).toContain(
			'overture:base:water:water-danube-segment',
		)
		expect(all.items.every((entry) => entry.geometry !== undefined)).toBe(true)
		const corridor = all.items.find(
			(entry) => entry.properties.overtureType === 'corridor',
		)
		expect(corridor).toMatchObject({
			id:
				'overture:transportation:corridor:' +
				'ae79f2511d20fd29e20b4221ecd646020e3ed74c372f0e0aa965b6a1d295f0c1',
			kind: 'road',
			name: 'Asian Highway 42',
			aliases: expect.arrayContaining(['AH42', 'Prithvi Highway', 'पृथ्वी राजमार्ग']),
			categories: ['corridor', 'primary', 'road', 'route'],
			countryCode: 'NP',
			bbox: [84.42, 27.69, 85.25, 27.82],
			properties: {
				overtureType: 'corridor',
				corridorScope: 'route',
				memberCount: 2,
				memberIdSample: [
					'overture:transportation:segment:segment-prithvi',
					'overture:transportation:segment:segment-prithvi-east',
				],
				memberIdSampleTruncated: false,
				membershipDigest:
					'sha256:ac8fdf9ae4690cef1a9315d1c8428e6b51df84fb604fdf92cd4af3c60bfa35fd',
				geometrySemantics:
					'exact-endpoint-stitched source centerlines; repeated source segments, branches, and disconnected components remain separate; no inferred connections',
				componentCount: 1,
				gapCount: 0,
				pathCount: 1,
				stitchedJoinCount: 1,
				identity: {
					type: 'route',
					subtype: 'road',
					name: 'Asian Highway 42',
					network: 'AsianHighway',
					ref: 'AH42',
				},
			},
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[84.42, 27.82],
						[85.01, 27.71],
						[85.25, 27.69],
					],
				],
			},
		})

		await expect(buildOvertureGeoCatalogSnapshot(options)).rejects.toThrow(
			'Refusing to replace existing GeoCatalog snapshot',
		)
		const unchanged = await catalog.query({ limit: 20 })
		expect(unchanged.items).toHaveLength(9)
	})

	test('uses corridor source lines for staging without persisting them when requested', async () => {
		const directory = await temporaryDirectory()
		const waterInput = join(directory, 'water.geojsonseq')
		const retainedOutput = join(directory, 'retained.sqlite')
		const stagingOnlyOutput = join(directory, 'staging-only.sqlite')
		const waterFeature = (
			id: string,
			name: string,
			subtype: string,
			geometry: Record<string, unknown>,
		) => ({
			type: 'Feature',
			id,
			geometry,
			properties: {
				theme: 'base',
				type: 'water',
				version: 1,
				sources: [
					{
						property: '',
						dataset: 'OpenStreetMap',
						license: 'ODbL-1.0',
						record_id: `way/${id}`,
					},
				],
				subtype,
				class: subtype,
				names: { primary: name },
			},
		})
		const waterRecords = [
			waterFeature('river-a', 'Blue River', 'river', {
				type: 'LineString',
				coordinates: [
					[10, 47],
					[11, 47],
				],
			}),
			waterFeature('river-b', 'Blue River', 'river', {
				type: 'LineString',
				coordinates: [
					[11, 47],
					[12, 47],
				],
			}),
			waterFeature('named-lake', 'Example Lake', 'lake', {
				type: 'Polygon',
				coordinates: [
					[
						[13, 47],
						[13.2, 47],
						[13.2, 47.2],
						[13, 47.2],
						[13, 47],
					],
				],
			}),
			waterFeature('named-spring', 'Example Spring', 'spring', {
				type: 'Point',
				coordinates: [14, 47],
			}),
		]
		await Bun.write(
			waterInput,
			`${waterRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
		)
		const inputs = [
			{ featureType: 'place' as const, path: fixturePath('overture-place.ndjson') },
			{ featureType: 'segment' as const, path: fixturePath('overture-segment.ndjson') },
			{ featureType: 'water' as const, path: waterInput },
		]
		const retained = await buildOvertureGeoCatalogSnapshot({
			release: RELEASE,
			snapshotId: 'earthly-overture-retained-fragments-v1',
			createdAt: '2026-08-28T10:00:00Z',
			output: retainedOutput,
			inputs,
		})
		const stagingOnly = await buildOvertureGeoCatalogSnapshot({
			release: RELEASE,
			snapshotId: 'earthly-overture-staging-only-fragments-v1',
			createdAt: '2026-08-28T10:00:00Z',
			output: stagingOnlyOutput,
			inputs,
			corridorSourceFragments: 'staging-only',
		})

		expect(retained).toMatchObject({
			recordsRead: 9,
			entriesWritten: 11,
			sourceFragmentsStagedOnly: 0,
			corridorsWritten: 2,
			recordsSkipped: 0,
		})
		expect(stagingOnly).toMatchObject({
			recordsRead: 9,
			entriesWritten: 5,
			sourceFragmentsStagedOnly: 6,
			corridorsWritten: 2,
			recordsSkipped: 0,
			byType: {
				place: {
					recordsRead: 1,
					entriesWritten: 1,
					sourceFragmentsStagedOnly: 0,
					recordsSkipped: 0,
				},
				segment: {
					recordsRead: 4,
					entriesWritten: 0,
					sourceFragmentsStagedOnly: 4,
					recordsSkipped: 0,
				},
				water: {
					recordsRead: 4,
					entriesWritten: 2,
					sourceFragmentsStagedOnly: 2,
					recordsSkipped: 0,
				},
			},
		})

		const retainedItems = (
			await openSqliteGeoCatalog({ path: retainedOutput }).query({
				limit: 30,
				includeGeometry: true,
			})
		).items
		const stagingOnlyItems = (
			await openSqliteGeoCatalog({ path: stagingOnlyOutput }).query({
				limit: 30,
				includeGeometry: true,
			})
		).items
		const stagingOnlyIds = stagingOnlyItems.map((entry) => entry.id)
		expect(retainedItems.map((entry) => entry.id)).toContain(
			'overture:transportation:segment:segment-airport-rail',
		)
		expect(retainedItems.map((entry) => entry.id)).toContain(
			'overture:base:water:river-a',
		)
		expect(stagingOnlyIds).not.toContain(
			'overture:transportation:segment:segment-airport-rail',
		)
		expect(stagingOnlyIds).not.toContain('overture:base:water:river-a')
		expect(stagingOnlyIds).toContain('overture:base:water:named-lake')
		expect(stagingOnlyIds).toContain('overture:base:water:named-spring')
		expect(stagingOnlyIds).toContain('overture:places:place:place-kathmandu-museum')

		const derived = (entries: typeof retainedItems) =>
			entries
				.filter((entry) => ['corridor', 'water_corridor'].includes(String(entry.properties.overtureType)))
				.sort((left, right) => left.id.localeCompare(right.id))
		expect(derived(stagingOnlyItems)).toEqual(derived(retainedItems))
		expect(derived(stagingOnlyItems).map((entry) => entry.properties.overtureType)).toEqual([
			'water_corridor',
			'corridor',
		])
	})

	test('does not attach OSM attribution to a place-only snapshot', async () => {
		const directory = await temporaryDirectory()
		const result = await buildOvertureGeoCatalogSnapshot({
			release: RELEASE,
			snapshotId: 'earthly-overture-place-only-v1',
			createdAt: '2026-08-28T10:00:00Z',
			output: join(directory, 'places.sqlite'),
			inputs: [{ featureType: 'place', path: fixturePath('overture-place.ndjson') }],
		})

		expect(result.snapshot.sources).toEqual([
			createOvertureSourceRelease(RELEASE, ['place']),
		])
		expect(result.snapshot.sources[0]?.attribution).not.toContain('OpenStreetMap')
		expect(result.snapshot.sources[0]?.license).not.toContain('ODbL')
		expect(result).toMatchObject({ entriesWritten: 1, corridorsWritten: 0 })
	})

	test('keeps administrative label points discoverable but out of editor geometry', async () => {
		const directory = await temporaryDirectory()
		const divisionInput = join(directory, 'divisions.ndjson')
		const divisionAreaInput = join(directory, 'division-areas.ndjson')
		const output = join(directory, 'divisions.sqlite')
		const records = [
			{
				type: 'Feature',
				id: 'division-county',
				geometry: { type: 'Point', coordinates: [85.3, 28.1] },
				properties: { subtype: 'county', names: { primary: 'Rasuwa' } },
			},
			{
				type: 'Feature',
				id: 'division-locality',
				geometry: { type: 'Point', coordinates: [85.29, 28.11] },
				properties: { subtype: 'macrohood', names: { primary: 'Dhunche' } },
			},
		]
		await Bun.write(
			divisionInput,
			`${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
		)
		await Bun.write(
			divisionAreaInput,
			`${JSON.stringify({
				type: 'Feature',
				id: 'division-area-rasuwa',
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[85.15, 27.95],
							[85.75, 27.95],
							[85.75, 28.4],
							[85.15, 28.4],
							[85.15, 27.95],
						],
					],
				},
				properties: { subtype: 'county', names: { primary: 'Rasuwa' } },
			})}\n`,
		)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: RELEASE,
			snapshotId: 'earthly-overture-division-labels-v1',
			createdAt: '2026-08-28T10:00:00Z',
			coverage: { scope: 'bbox', bbox: [85.05, 27.75, 86.1, 29.1] },
			output,
			inputs: [
				{ featureType: 'division', path: divisionInput },
				{ featureType: 'division_area', path: divisionAreaInput },
			],
		})

		expect(result.snapshot.coverage?.kinds).toEqual(['admin', 'locality'])

		const catalog = openSqliteGeoCatalog({ path: output })
		const discovery = await catalog.query({ text: 'Rasuwa', kinds: ['admin'] })
		expect(discovery.items.map((entry) => entry.id)).toEqual([
			'overture:divisions:division:division-county',
			'overture:divisions:division_area:division-area-rasuwa',
		])
		expect(discovery.items[0]).toMatchObject({
			categories: ['administrative-label', 'county'],
		})
		expect(discovery.items[0]).not.toHaveProperty('geometry')

		const authoring = await catalog.query({
			ids: discovery.items.map((entry) => entry.id),
			includeGeometry: true,
		})
		expect(authoring.items).toHaveLength(1)
		expect(authoring.items[0]).toMatchObject({
			id: 'overture:divisions:division_area:division-area-rasuwa',
			categories: ['administrative-boundary', 'county'],
			geometry: { type: 'Polygon' },
		})

		const labelOnlyAuthoring = await catalog.query({
			ids: ['overture:divisions:division:division-county'],
			includeGeometry: true,
		})
		expect(labelOnlyAuthoring.items).toEqual([])

		const localityAuthoring = await catalog.query({
			ids: ['overture:divisions:division:division-locality'],
			includeGeometry: true,
		})
		expect(localityAuthoring.items[0]?.geometry?.type).toBe('Point')
	})

	test('assembles connected named rail and water segments without merging name collisions', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'named-segments.ndjson')
		const output = join(directory, 'named-corridors.sqlite')
		const segment = (
			id: string,
			subtype: 'rail' | 'water',
			name: string,
			coordinates: number[][],
			connectors: string[],
		) => ({
			type: 'Feature',
			id,
			geometry: { type: 'LineString', coordinates },
			properties: {
				theme: 'transportation',
				type: 'segment',
				version: 1,
				sources: [
					{
						property: '',
						dataset: 'OpenStreetMap',
						license: 'ODbL-1.0',
						record_id: `way/${id}`,
					},
				],
				subtype,
				...(subtype === 'rail' ? { class: 'standard_gauge', country: 'AT' } : {}),
				names: { primary: name },
				connectors: connectors.map((connector_id, index) => ({
					connector_id,
					at: index,
				})),
			},
		})
		const records = [
			segment('rail-a', 'rail', 'Alpine Rail', [[10, 47], [11, 47]], ['r1', 'r2']),
			segment('rail-b', 'rail', 'Alpine Rail', [[11, 47], [12, 47]], ['r2', 'r3']),
			segment('rail-collision', 'rail', 'Alpine Rail', [[20, 47], [21, 47]], [
				'x1',
				'x2',
			]),
			segment('water-a', 'water', 'Blue Ferry', [[18, 59], [18.1, 59]], ['w1', 'w2']),
			segment('water-b', 'water', 'Blue Ferry', [[18.1, 59], [18.2, 59]], ['w2', 'w3']),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: RELEASE,
			snapshotId: 'earthly-overture-named-corridors-v1',
			createdAt: '2026-08-28T10:00:00Z',
			output,
			inputs: [{ featureType: 'segment', path: input }],
		})
		expect(result).toMatchObject({
			recordsRead: 5,
			entriesWritten: 7,
			corridorsWritten: 2,
		})

		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({ limit: 20, includeGeometry: true })
		const corridors = query.items
			.filter((entry) => entry.properties.overtureType === 'corridor')
			.sort((left, right) => left.name.localeCompare(right.name))
		expect(corridors.map((entry) => [entry.kind, entry.name])).toEqual([
			['rail', 'Alpine Rail'],
			['waterway', 'Blue Ferry'],
		])
		expect(corridors[0]).toMatchObject({
			properties: {
				corridorScope: 'connected-name',
				memberCount: 2,
				componentCount: 1,
				pathCount: 1,
				stitchedJoinCount: 1,
			},
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[10, 47],
						[11, 47],
						[12, 47],
					],
				],
			},
		})
	})

	test('removes private corridor staging after an input failure', async () => {
		const directory = await temporaryDirectory()
		const stagingDirectoryRoot = join(directory, 'staging')
		const input = join(directory, 'malformed.ndjson')
		const output = join(directory, 'failed.sqlite')
		await mkdir(stagingDirectoryRoot)
		await Bun.write(input, '{"type":"Feature"\n')

		await expect(
			buildOvertureGeoCatalogSnapshot({
				release: RELEASE,
				snapshotId: 'earthly-overture-failed-v1',
				output,
				inputs: [{ featureType: 'segment', path: input }],
				stagingDirectoryRoot,
			}),
		).rejects.toThrow(`${input}: record 1 is not valid JSON`)
		expect(await readdir(stagingDirectoryRoot)).toEqual([])
		expect(await Bun.file(output).exists()).toBe(false)
	})
})
