import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeoCatalog } from './catalog'
import { createInMemoryGeoCatalog } from './in-memory'
import type { GeoCatalogAdapter } from './internal'
import {
	createSqliteGeoCatalogForDatabase,
	explainSqliteGeoCatalogQueryForTests,
	initializeSqliteGeoCatalogForTests,
	openSqliteGeoCatalog,
	writeSqliteGeoCatalogSnapshot,
} from './sqlite'
import {
	GeoCatalogError,
	type GeoCatalog,
	type GeoCatalogEntry,
	type GeoCatalogSnapshotMetadata,
} from './types'

const snapshot: GeoCatalogSnapshotMetadata = {
	id: 'earthly-test-2026-08-28',
	createdAt: '2026-08-28T12:00:00.000Z',
	schemaVersion: 1,
	coverage: {
		spatial: { scope: 'bbox', bbox: [85.05, 27.75, 86.1, 29.1] },
		kinds: ['admin', 'locality', 'place', 'road', 'rail', 'waterway', 'infrastructure'],
	},
	sources: [
		{
			name: 'Overture Maps',
			release: '2026-08-19.0',
			attribution: 'Overture Maps Foundation',
			attributionUrl: 'https://docs.overturemaps.org/attribution/',
			license: 'CDLA-Permissive-2.0',
			documents: [
				{
					name: 'Source notice',
					url: 'https://example.test/NOTICE.txt',
					content: 'Preserve this source notice.',
				},
			],
		},
		{
			name: 'HydroRIVERS',
			release: '1.0',
			license: 'HydroSHEDS terms',
		},
	],
}

const entries: GeoCatalogEntry[] = [
	{
		id: 'admin:np',
		kind: 'admin',
		name: 'Nepal',
		aliases: ['Federal Democratic Republic of Nepal'],
		categories: ['country', 'administrative-boundary'],
		countryCode: 'NP',
		adminLevel: 0,
		bbox: [80.05, 26.35, 88.2, 30.45],
		center: { longitude: 84.12, latitude: 28.39 },
		importance: 100,
		source: { name: 'Overture Maps', release: '2026-08-19.0', recordId: 'gers-nepal' },
		properties: { sourceAdminLevel: 2, rank: 1 },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[80.05, 26.35],
					[88.2, 26.35],
					[88.2, 30.45],
					[80.05, 26.35],
				],
			],
		},
	},
	{
		id: 'locality:rasuwagadhi',
		kind: 'locality',
		name: 'Rasuwagadhi',
		aliases: ['Rasuwa Gadhi'],
		categories: ['village'],
		countryCode: 'NP',
		bbox: [85.37, 28.27, 85.38, 28.28],
		center: { longitude: 85.375, latitude: 28.275 },
		importance: 28,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { populationClass: 'village' },
		geometry: { type: 'Point', coordinates: [85.375, 28.275] },
	},
	{
		id: 'locality:timure',
		kind: 'locality',
		name: 'Timure',
		aliases: ['Timuré'],
		categories: ['village'],
		countryCode: 'NP',
		bbox: [85.37, 28.24, 85.38, 28.25],
		center: { longitude: 85.374, latitude: 28.245 },
		importance: 31,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { populationClass: 'village' },
		geometry: { type: 'Point', coordinates: [85.374, 28.245] },
	},
	{
		id: 'locality:dhunche',
		kind: 'locality',
		name: 'धुन्चे',
		aliases: ['Dhunche'],
		categories: ['town'],
		countryCode: 'NP',
		bbox: [85.29, 28.1, 85.31, 28.12],
		center: { longitude: 85.3, latitude: 28.11 },
		importance: 34,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: { type: 'Point', coordinates: [85.3, 28.11] },
	},
	{
		id: 'locality:rongma-tibet',
		kind: 'locality',
		name: 'Rongma',
		aliases: [],
		categories: ['village'],
		countryCode: 'CN',
		bbox: [88.1, 31.1, 88.12, 31.12],
		center: { longitude: 88.11, latitude: 31.11 },
		importance: 22,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: { type: 'Point', coordinates: [88.11, 31.11] },
	},
	{
		id: 'locality:rongma-tibet-west',
		kind: 'locality',
		name: 'Rongma',
		aliases: [],
		categories: ['village'],
		countryCode: 'CN',
		bbox: [87.9, 31, 87.92, 31.02],
		center: { longitude: 87.91, latitude: 31.01 },
		importance: 24,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: { type: 'Point', coordinates: [87.91, 31.01] },
	},
	{
		id: 'locality:rongma-tibet-east',
		kind: 'locality',
		name: 'Rongma',
		aliases: [],
		categories: ['village'],
		countryCode: 'CN',
		bbox: [88.3, 31.2, 88.32, 31.22],
		center: { longitude: 88.31, latitude: 31.21 },
		importance: 23,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: { type: 'Point', coordinates: [88.31, 31.21] },
	},
	{
		id: 'locality:rongma-henan',
		kind: 'locality',
		name: 'Rongma',
		aliases: [],
		categories: ['village'],
		countryCode: 'CN',
		bbox: [113.6, 34.7, 113.62, 34.72],
		center: { longitude: 113.61, latitude: 34.71 },
		importance: 21,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: { type: 'Point', coordinates: [113.61, 34.71] },
	},
	{
		id: 'place:kerung-port',
		kind: 'place',
		name: 'Gyirong Port',
		aliases: ['Kerung Port'],
		categories: ['border-crossing'],
		countryCode: 'CN',
		bbox: [85.36, 28.28, 85.37, 28.29],
		center: { longitude: 85.365, latitude: 28.285 },
		importance: 42,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { category: 'border_crossing' },
		geometry: { type: 'Point', coordinates: [85.365, 28.285] },
	},
	{
		id: 'admin:cn-tibet',
		kind: 'admin',
		name: 'Xizang Autonomous Region',
		aliases: ['Tibet'],
		categories: ['administrative-boundary', 'region'],
		countryCode: 'CN',
		adminLevel: 1,
		bbox: [78.4, 26.8, 99.1, 36.5],
		center: { longitude: 88.4, latitude: 31.7 },
		importance: 86,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'admin:np-twin-region-west',
		kind: 'admin',
		name: 'Twin Region',
		aliases: [],
		categories: ['administrative-boundary', 'region'],
		countryCode: 'NP',
		adminLevel: 4,
		bbox: [80.05, 26.35, 84.1, 30.45],
		center: { longitude: 82.1, latitude: 28.4 },
		importance: 25,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'admin:np-twin-region-east',
		kind: 'admin',
		name: 'Twin Region',
		aliases: [],
		categories: ['administrative-boundary', 'region'],
		countryCode: 'NP',
		adminLevel: 4,
		bbox: [84.1, 26.35, 88.2, 30.45],
		center: { longitude: 86.1, latitude: 28.4 },
		importance: 24,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'admin:cn-gyirong',
		kind: 'admin',
		name: '吉隆县',
		aliases: ['Gyirong', 'Gyirong County', 'Kyirong County'],
		categories: ['administrative-boundary', 'localadmin'],
		countryCode: 'CN',
		adminLevel: 2,
		bbox: [84.9, 27.75, 86.1, 29.1],
		center: { longitude: 85.4, latitude: 28.6 },
		importance: 47,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[84.9, 27.75],
					[86.1, 27.75],
					[86.1, 29.1],
					[84.9, 27.75],
				],
			],
		},
	},
	{
		id: 'road:pasang-lhamu',
		kind: 'road',
		name: 'Pasang Lhamu Highway',
		aliases: [],
		categories: ['secondary-road'],
		countryCode: 'NP',
		bbox: [85.18, 27.72, 85.42, 28.28],
		center: { longitude: 85.3, latitude: 28 },
		importance: 50,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { class: 'secondary' },
		geometry: {
			type: 'LineString',
			coordinates: [
				[85.18, 27.72],
				[85.42, 28.28],
			],
		},
	},
	{
		id: 'rail:lanyungang',
		kind: 'rail',
		name: 'Lanyungang Railway',
		aliases: [],
		categories: ['railway'],
		countryCode: 'CN',
		bbox: [85.1, 28.1, 85.8, 28.8],
		center: { longitude: 85.45, latitude: 28.45 },
		importance: 12,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'waterway:trishuli',
		kind: 'waterway',
		name: 'Trishuli River',
		aliases: ['Trisuli'],
		categories: ['river'],
		bbox: [84.9, 27.6, 85.5, 28.3],
		center: { longitude: 85.2, latitude: 27.95 },
		importance: 44,
		source: { name: 'HydroRIVERS', release: '1.0', recordId: 'hy-442' },
		properties: { order: 5 },
	},
	{
		id: 'waterway:bhote-koshi',
		kind: 'waterway',
		name: 'Bhote Koshi',
		aliases: [],
		categories: ['corridor', 'river'],
		bbox: [85.7, 27.7, 86, 28.2],
		center: { longitude: 85.85, latitude: 27.95 },
		importance: 41,
		source: { name: 'HydroRIVERS', release: '1.0' },
		properties: {},
	},
	{
		id: 'waterway:lende-khola',
		kind: 'waterway',
		name: '东林藏布',
		aliases: ['Lende Khola'],
		categories: ['corridor', 'river'],
		bbox: [85.2, 28.2, 85.6, 28.8],
		center: { longitude: 85.4, latitude: 28.5 },
		importance: 40,
		source: { name: 'HydroRIVERS', release: '1.0' },
		properties: {},
	},
	{
		id: 'infrastructure:rasuwa-bridge',
		kind: 'infrastructure',
		name: 'Rasuwagadhi Friendship Bridge',
		aliases: ['China–Nepal Friendship Bridge'],
		categories: ['bridge'],
		countryCode: 'NP',
		bbox: [85.374, 28.274, 85.376, 28.276],
		center: { longitude: 85.375, latitude: 28.275 },
		importance: 35,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { class: 'bridge' },
	},
	{
		id: 'infrastructure:devighat-hydropower',
		kind: 'infrastructure',
		name: 'Devighat Hydropower Plant',
		aliases: [],
		categories: ['power', 'generator'],
		countryCode: 'NP',
		bbox: [85.08, 27.93, 85.09, 27.94],
		center: { longitude: 85.085, latitude: 27.935 },
		importance: 36,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { class: 'power' },
		geometry: { type: 'Point', coordinates: [85.085, 27.935] },
	},
	{
		id: 'admin:np-p3',
		kind: 'admin',
		name: 'Bagmati Province',
		aliases: ['Bagmati Pradesh'],
		categories: ['administrative-boundary', 'province'],
		countryCode: 'NP',
		adminLevel: 1,
		bbox: [84.45, 26.91, 86.58, 28.35],
		center: { longitude: 85.35, latitude: 27.7 },
		importance: 82,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { subtype: 'region' },
	},
	{
		id: 'admin:np-rasuwa',
		kind: 'admin',
		name: 'Rasuwa',
		aliases: [],
		categories: ['administrative-boundary', 'district'],
		countryCode: 'NP',
		adminLevel: 2,
		bbox: [85.15, 27.95, 85.75, 28.4],
		center: { longitude: 85.4, latitude: 28.17 },
		importance: 45,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { subtype: 'county' },
	},
	{
		id: 'place:langtang-health',
		kind: 'place',
		name: 'Langtang Health Centre',
		aliases: [],
		categories: [' Hospital ', 'healthcare', 'HOSPITAL'],
		countryCode: 'NP',
		bbox: [85.5, 28.21, 85.51, 28.22],
		center: { longitude: 85.505, latitude: 28.215 },
		importance: 39,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'place:himalayan-heritage',
		kind: 'place',
		name: 'Himalayan Heritage House',
		aliases: [],
		categories: ['museum'],
		countryCode: 'NP',
		bbox: [85.31, 27.7, 85.32, 27.71],
		center: { longitude: 85.315, latitude: 27.705 },
		importance: 38,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: {},
	},
	{
		id: 'admin:np-synthetic-label',
		kind: 'admin',
		name: 'Synthetic County Label',
		aliases: [],
		categories: ['administrative-label', 'county'],
		countryCode: 'NP',
		bbox: [85.3, 28.1, 85.3, 28.1],
		center: { longitude: 85.3, latitude: 28.1 },
		importance: 10,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { overtureType: 'division' },
		geometry: { type: 'Point', coordinates: [85.3, 28.1] },
	},
]

interface Harness {
	catalog: GeoCatalog
	dispose(): void
}

const harnesses: Array<{ name: string; create(): Harness }> = [
	{
		name: 'in-memory adapter',
		create: () => ({
			catalog: createInMemoryGeoCatalog({ snapshot, entries: [...entries].reverse() }),
			dispose() {},
		}),
	},
	{
		name: 'SQLite FTS/RTree adapter',
		create: () => {
			const database = new Database(':memory:', { strict: true })
			initializeSqliteGeoCatalogForTests(database, snapshot, [...entries].reverse())
			return {
				catalog: createSqliteGeoCatalogForDatabase(database),
				dispose: () => database.close(),
			}
		},
	},
]

for (const harnessDefinition of harnesses) {
	describe(`GeoCatalog Interface (${harnessDefinition.name})`, () => {
		async function usingCatalog(run: (catalog: GeoCatalog) => Promise<void>): Promise<void> {
			const harness = harnessDefinition.create()
			try {
				await run(harness.catalog)
			} finally {
				harness.dispose()
			}
		}

		test('combines source-neutral filters with AND semantics', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					text: 'timur',
					kinds: ['locality'],
					countryCode: 'np',
					bbox: [85.3, 28.2, 85.45, 28.3],
				})
				expect(result.items.map((entry) => entry.id)).toEqual(['locality:timure'])
			})
		})

		test('filters exact normalized categories with OR within the category list', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					categories: [' HOSPITAL ', 'museum'],
					kinds: ['place'],
					countryCode: 'NP',
				})
				expect(result.items.map((entry) => entry.id)).toEqual([
					'place:langtang-health',
					'place:himalayan-heritage',
				])
				expect(result.items[0]?.categories).toEqual(['hospital', 'healthcare'])

				const prefixOnly = await catalog.query({ categories: ['health'] })
				expect(prefixOnly.items).toEqual([])
			})
		})

		test('selects villages by classification rather than name text', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					categories: ['village'],
					kinds: ['locality'],
					countryCode: 'NP',
				})
				expect(result.items.map((entry) => entry.id)).toEqual([
					'locality:timure',
					'locality:rasuwagadhi',
				])
			})
		})

		test('uses OR within admin levels and AND across category and level groups', async () => {
			await usingCatalog(async (catalog) => {
				const adminOne = await catalog.query({
					categories: ['administrative-boundary'],
					adminLevels: [1],
					countryCode: 'NP',
				})
				expect(adminOne.items.map((entry) => entry.id)).toEqual(['admin:np-p3'])
				expect(adminOne.items[0]?.adminLevel).toBe(1)

				const countryOrAdminOne = await catalog.query({
					categories: ['administrative-boundary'],
					adminLevels: [1, 0, 1],
					countryCode: 'NP',
				})
				expect(countryOrAdminOne.items.map((entry) => entry.id)).toEqual([
					'admin:np',
					'admin:np-p3',
				])
			})
		})

		test('uses deterministic text, importance, name, and id ordering', async () => {
			await usingCatalog(async (catalog) => {
				const first = await catalog.query({ countryCode: 'NP', limit: 20 })
				const second = await catalog.query({ countryCode: 'NP', limit: 20 })
				expect(second.items.map((entry) => entry.id)).toEqual(
					first.items.map((entry) => entry.id),
				)
				expect(first.items.slice(0, 3).map((entry) => entry.id)).toEqual([
					'admin:np',
					'admin:np-p3',
					'road:pasang-lhamu',
				])

				const aliasMatch = await catalog.query({ text: 'Kerung Port' })
				expect(aliasMatch.items[0]?.id).toBe('place:kerung-port')
			})
		})

		test('recovers a named administrative area by explicitly relaxing a generic suffix', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ text: 'Rasuwa District' })

				expect(result.items.map((entry) => entry.id)).toEqual(['admin:np-rasuwa'])
				expect(result.metadata.query.diagnostics?.textRelaxation).toEqual({
					status: 'applied',
					strategy: 'generic_suffix',
					removedTokens: ['district'],
					effectiveText: 'rasuwa',
				})

				const authoringLookup = await catalog.query({
					text: 'Rasuwa District',
					includeGeometry: true,
				})
				expect(authoringLookup.items).toEqual([])
				expect(authoringLookup.metadata.query.diagnostics).toBeUndefined()
			})
		})

		test('recovers exact names followed by catalogued geographic qualifiers', async () => {
			await usingCatalog(async (catalog) => {
				const cases = [
					{
						bare: 'Trishuli River',
						qualified: 'Trishuli River Nepal',
						expectedId: 'waterway:trishuli',
						effectiveText: 'trishuli river',
						countryCode: 'NP',
						appliedBbox: [80.05, 26.35, 88.2, 30.45] as const,
					},
					{
						bare: 'Dhunche',
						qualified: 'Dhunche Nepal',
						expectedId: 'locality:dhunche',
						effectiveText: 'dhunche',
						countryCode: 'NP',
						appliedCountryCode: 'NP',
					},
					{
						bare: 'Gyirong County',
						qualified: 'Gyirong County Tibet',
						expectedId: 'admin:cn-gyirong',
						effectiveText: 'gyirong county',
						countryCode: 'CN',
						appliedCountryCode: 'CN',
						appliedBbox: [78.4, 26.8, 99.1, 36.5] as const,
					},
				] as const

				for (const candidate of cases) {
					const bare = await catalog.query({ text: candidate.bare })
					expect(bare.items.map((entry) => entry.id)).toContain(candidate.expectedId)

					const qualified = await catalog.query({ text: candidate.qualified })
					expect(qualified.items.map((entry) => entry.id)).toContain(candidate.expectedId)
					expect(qualified.metadata.query.diagnostics?.textRecovery).toEqual({
						status: 'applied',
						steps: [
							{
								strategy: 'trailing_geographic_qualifier',
								removedText:
									candidate.countryCode === 'CN' ? 'tibet' : 'nepal',
								inferredCountryCode: candidate.countryCode,
							},
						],
						effectiveText: candidate.effectiveText,
						...('appliedCountryCode' in candidate
							? { appliedCountryCode: candidate.appliedCountryCode }
							: {}),
						...('appliedBbox' in candidate
							? { appliedBbox: [...candidate.appliedBbox] }
							: {}),
					})
				}
			})
		})

		test('scopes regional qualifiers before accepting same-country homonyms', async () => {
			await usingCatalog(async (catalog) => {
				const bare = await catalog.query({ text: 'Rongma' })
				expect(bare.items.map((entry) => entry.id)).toEqual([
					'locality:rongma-tibet-west',
					'locality:rongma-tibet-east',
					'locality:rongma-tibet',
					'locality:rongma-henan',
				])

				const qualified = await catalog.query({ text: 'Rongma Tibet', limit: 2 })
				expect(qualified.items.map((entry) => entry.id)).toEqual([
					'locality:rongma-tibet-west',
					'locality:rongma-tibet-east',
				])
				expect(qualified.metadata.query.hasMore).toBe(true)
				expect(qualified.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'trailing_geographic_qualifier',
							removedText: 'tibet',
							inferredCountryCode: 'CN',
						},
					],
					effectiveText: 'rongma',
					appliedCountryCode: 'CN',
					appliedBbox: [78.4, 26.8, 99.1, 36.5],
				})

				const countryless = await catalog.query({
					text: 'Lende Khola Tibet',
					kinds: ['waterway'],
				})
				expect(countryless.items.map((entry) => entry.id)).toEqual([
					'waterway:lende-khola',
				])
				expect(countryless.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'trailing_geographic_qualifier',
							removedText: 'tibet',
							inferredCountryCode: 'CN',
						},
					],
					effectiveText: 'lende khola',
					appliedBbox: [78.4, 26.8, 99.1, 36.5],
				})
			})
		})

		test('recovers countryless exact matches inside one explicit admin-0 country boundary', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					text: 'Trishuli River',
					kinds: ['waterway'],
					countryCode: 'np',
				})

				expect(result.items.map((entry) => entry.id)).toEqual(['waterway:trishuli'])
				expect(result.metadata.query.diagnostics?.countrylessSpatialFallback).toEqual({
					status: 'applied',
					countryCode: 'NP',
					boundaryId: 'admin:np',
					appliedBbox: [80.05, 26.35, 88.2, 30.45],
				})
				expect(result.metadata.query.diagnostics?.textRecovery).toBeUndefined()
			})
		})

		test('never uses the countryless fallback for geometry or stable-id resolution', async () => {
			await usingCatalog(async (catalog) => {
				const geometry = await catalog.query({
					text: 'Trishuli River',
					kinds: ['waterway'],
					countryCode: 'NP',
					includeGeometry: true,
				})
				expect(geometry.items).toEqual([])
				expect(geometry.metadata.query.diagnostics).toBeUndefined()

				const stableId = await catalog.query({
					ids: ['waterway:trishuli'],
					countryCode: 'NP',
				})
				expect(stableId.items).toEqual([])
				expect(stableId.metadata.query.diagnostics).toBeUndefined()
			})
		})

		test('rejects an ambiguous regional qualifier even within one country', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ text: 'Dhunche Twin Region' })
				expect(result.items).toEqual([])
				expect(result.metadata.query.diagnostics?.textRecovery).toBeUndefined()
			})
		})

		test('combines a geographic qualifier with a generic administrative suffix', async () => {
			await usingCatalog(async (catalog) => {
				const bare = await catalog.query({ text: 'Rasuwa District' })
				expect(bare.items.map((entry) => entry.id)).toContain('admin:np-rasuwa')

				const result = await catalog.query({ text: 'Rasuwa District Nepal' })
				expect(result.items.map((entry) => entry.id)).toEqual(['admin:np-rasuwa'])
				expect(result.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'trailing_geographic_qualifier',
							removedText: 'nepal',
							inferredCountryCode: 'NP',
						},
						{ strategy: 'generic_suffix', removedText: 'district' },
					],
					effectiveText: 'rasuwa',
					appliedCountryCode: 'NP',
				})
			})
		})

		test('recovers conservative spacing and one-character spelling variants for discovery', async () => {
			await usingCatalog(async (catalog) => {
				const compact = await catalog.query({
					text: 'Bhotekoshi',
					kinds: ['waterway'],
				})
				expect(compact.items.map((entry) => entry.id)).toEqual(['waterway:bhote-koshi'])
				expect(compact.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'spacing_variant',
							from: 'bhotekoshi',
							to: 'bhote koshi',
						},
					],
					effectiveText: 'bhote koshi',
				})

				const typedAndQualified = await catalog.query({
					text: 'Bhotekoshi River Nepal',
					kinds: ['waterway'],
				})
				expect(typedAndQualified.items.map((entry) => entry.id)).toEqual([
					'waterway:bhote-koshi',
				])
				expect(typedAndQualified.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'trailing_geographic_qualifier',
							removedText: 'nepal',
							inferredCountryCode: 'NP',
						},
						{ strategy: 'generic_suffix', removedText: 'river' },
						{
							strategy: 'spacing_variant',
							from: 'bhotekoshi',
							to: 'bhote koshi',
						},
					],
					effectiveText: 'bhote koshi',
					appliedBbox: [80.05, 26.35, 88.2, 30.45],
				})

				const incompatibleKind = await catalog.query({
					text: 'Bhotekoshi River Nepal',
					kinds: ['road'],
				})
				expect(incompatibleKind.items).toEqual([])

				const spelling = await catalog.query({
					text: 'Lhende Khola',
					kinds: ['waterway'],
				})
				expect(spelling.items.map((entry) => entry.id)).toEqual(['waterway:lende-khola'])
				expect(spelling.metadata.query.diagnostics?.textRecovery).toEqual({
					status: 'applied',
					steps: [
						{
							strategy: 'single_character_deletion',
							from: 'lhende',
							to: 'lende',
						},
					],
					effectiveText: 'lende khola',
				})
			})
		})

		test('never applies text recovery to geometry-bearing or stable-id queries', async () => {
			await usingCatalog(async (catalog) => {
				const qualifiedGeometry = await catalog.query({
					text: 'Dhunche Nepal',
					includeGeometry: true,
				})
				expect(qualifiedGeometry.items).toEqual([])
				expect(qualifiedGeometry.metadata.query.diagnostics).toBeUndefined()

				const fuzzyGeometry = await catalog.query({
					text: 'Lhende Khola',
					kinds: ['waterway'],
					includeGeometry: true,
				})
				expect(fuzzyGeometry.items).toEqual([])
				expect(fuzzyGeometry.metadata.query.diagnostics).toBeUndefined()

				const stableIdWithMismatchedText = await catalog.query({
					ids: ['locality:dhunche'],
					text: 'Dhunche Nepal',
				})
				expect(stableIdWithMismatchedText.items).toEqual([])
				expect(stableIdWithMismatchedText.metadata.query.diagnostics).toBeUndefined()
			})
		})

		test('does not strip a meaningful feature-type suffix into an unrelated place', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ text: 'Rasuwagadhi Station' })
				expect(result.items).toEqual([])
				expect(result.metadata.query.diagnostics).toBeUndefined()
			})
		})

		test('diagnoses a category that eliminated text matches without silently widening it', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					text: 'hydropower',
					kinds: ['infrastructure'],
					categories: ['hydropower_plant'],
				})

				expect(result.items).toEqual([])
				expect(result.metadata.query.diagnostics?.categorySuggestions).toEqual([
					'generator',
					'power',
				])
				expect(result.metadata.query.diagnostics?.nearMatches).toEqual([
					{
						id: 'infrastructure:devighat-hydropower',
						name: 'Devighat Hydropower Plant',
						kind: 'infrastructure',
						categories: ['power', 'generator'],
					},
				])

				const withGeometry = await catalog.query({
					text: 'hydropower',
					kinds: ['infrastructure'],
					categories: ['hydropower_plant'],
					includeGeometry: true,
				})
				expect(
					withGeometry.metadata.query.diagnostics?.nearMatches?.[0]?.geometry?.type,
				).toBe('Point')
			})
		})

		test('reports whether a requested bounding box is inside, partial, or outside the snapshot', async () => {
			await usingCatalog(async (catalog) => {
				const inside = await catalog.query({
					bbox: [85.2, 28, 85.4, 28.3],
					kinds: ['locality'],
				})
				expect(inside.metadata.coverage).toMatchObject({
					spatial: { status: 'inside' },
					kinds: { status: 'available', missing: [] },
				})

				const partial = await catalog.query({ bbox: [84.9, 28, 85.2, 28.3] })
				expect(partial.metadata.coverage.spatial.status).toBe('partial')

				const outside = await catalog.query({ bbox: [70, 10, 71, 11] })
				expect(outside.items).toEqual([])
				expect(outside.metadata.coverage).toMatchObject({
					spatial: { status: 'outside' },
					zeroResultReason: 'outside_snapshot',
				})
			})
		})

		test('evaluates a near-radius query against snapshot coverage', async () => {
			await usingCatalog(async (catalog) => {
				const inside = await catalog.query({
					near: { longitude: 85.375, latitude: 28.275 },
					radiusMeters: 1_500,
				})
				expect(inside.metadata.coverage.spatial).toMatchObject({
					status: 'inside',
					snapshotBbox: [85.05, 27.75, 86.1, 29.1],
				})
				expect(inside.metadata.coverage.spatial.queryBbox).toHaveLength(4)

				const outside = await catalog.query({
					near: { longitude: 80, latitude: 25 },
					radiusMeters: 1_500,
				})
				expect(outside.metadata.coverage).toMatchObject({
					spatial: { status: 'outside' },
					zeroResultReason: 'outside_snapshot',
				})
			})
		})

		test('treats conjunctive spatial constraints as outside when either footprint is outside', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					bbox: [85.2, 28, 85.4, 28.3],
					near: { longitude: 80, latitude: 25 },
					radiusMeters: 1_500,
				})

				expect(result.items).toEqual([])
				expect(result.metadata.coverage).toMatchObject({
					spatial: { status: 'outside' },
					zeroResultReason: 'outside_snapshot',
				})
			})
		})

		test('marks a query without a spatial filter as unscoped within a bounded snapshot', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ text: 'feature that is not installed' })

				expect(result.metadata.coverage).toMatchObject({
					spatial: {
						status: 'unscoped',
						snapshotBbox: [85.05, 27.75, 86.1, 29.1],
					},
					zeroResultReason: 'query_location_unscoped',
				})
				expect(result.metadata.coverage.spatial).not.toHaveProperty('queryBbox')
			})
		})

		test('preserves explicit id order and reports truncation', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					ids: ['locality:rasuwagadhi', 'admin:np', 'locality:timure'],
					limit: 2,
				})
				expect(result.items.map((entry) => entry.id)).toEqual([
					'locality:rasuwagadhi',
					'admin:np',
				])
				expect(result.metadata.query).toEqual({ returned: 2, limit: 2, hasMore: true })
			})
		})

		test('filters and orders nearby entries by representative-point distance', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({
					near: { longitude: 85.375, latitude: 28.275 },
					radiusMeters: 1_500,
					limit: 10,
				})
				expect(result.items.map((entry) => entry.id)).toEqual([
					'infrastructure:rasuwa-bridge',
					'locality:rasuwagadhi',
					'place:kerung-port',
				])
			})
		})

		test('omits geometry by default and returns detached geometry on request', async () => {
			await usingCatalog(async (catalog) => {
				const withoutGeometry = await catalog.query({ ids: ['admin:np'] })
				expect('geometry' in (withoutGeometry.items[0] ?? {})).toBe(false)

				const withGeometry = await catalog.query({
					ids: ['admin:np'],
					includeGeometry: true,
				})
				expect(withGeometry.items[0]?.geometry?.type).toBe('Polygon')
				withGeometry.items[0]?.aliases.push('mutated by caller')
				withGeometry.items[0]?.categories.push('mutated-by-caller')
				if (withGeometry.items[0]) withGeometry.items[0].properties.rank = 999

				const fresh = await catalog.query({ ids: ['admin:np'], includeGeometry: true })
				expect(fresh.items[0]?.aliases).not.toContain('mutated by caller')
				expect(fresh.items[0]?.categories).not.toContain('mutated-by-caller')
				expect(fresh.items[0]?.properties.rank).toBe(1)
			})
		})

		test('keeps administrative label points available only for discovery', async () => {
			await usingCatalog(async (catalog) => {
				const discovery = await catalog.query({ ids: ['admin:np-synthetic-label'] })
				expect(discovery.items[0]).toMatchObject({
					id: 'admin:np-synthetic-label',
					kind: 'admin',
					categories: ['administrative-label', 'county'],
				})
				expect(discovery.items[0]).not.toHaveProperty('geometry')

				const authoring = await catalog.query({
					ids: ['admin:np-synthetic-label'],
					includeGeometry: true,
				})
				expect(authoring.items).toEqual([])
			})
		})

		test('returns snapshot and per-entry source release metadata', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ ids: ['waterway:trishuli'] })
				expect(result.metadata.snapshot.sources[0]?.documents?.[0]).toEqual({
					name: 'Source notice',
					url: 'https://example.test/NOTICE.txt',
				})
				expect(result.metadata.snapshot.sources[0]?.documents?.[0]).not.toHaveProperty(
					'content',
				)
				result.metadata.snapshot.sources[0]?.documents?.push({
					name: 'Caller mutation',
					url: 'https://example.test/mutated',
				})
				const fresh = await catalog.query({ ids: ['waterway:trishuli'] })
				expect(fresh.metadata.snapshot.sources[0]?.documents).toHaveLength(1)
				const editorResult = await catalog.query({
					ids: ['waterway:trishuli'],
					includeGeometry: true,
				})
				expect(editorResult.metadata.snapshot.sources[0]?.documents?.[0]?.content).toBe(
					'Preserve this source notice.',
				)
				expect(result.items[0]?.source).toEqual({
					name: 'HydroRIVERS',
					release: '1.0',
					recordId: 'hy-442',
				})
			})
		})

		test('rejects malformed source documents in snapshot metadata', () => {
			expect(() =>
				createInMemoryGeoCatalog({
					snapshot: {
						...snapshot,
						sources: [
							{
								name: 'Broken source',
								release: '1',
								documents: [{ name: 'NOTICE', url: 'file:///tmp/NOTICE' }],
							},
						],
					},
					entries: entries.slice(0, 1),
				}),
			).toThrow(/must use HTTP or HTTPS/)
		})

		test('raises typed validation errors at the Interface', async () => {
			await usingCatalog(async (catalog) => {
				const invalidRequests = [
					{ near: { longitude: 85, latitude: 28 } },
					{ categories: [] },
					{ categories: [' '] },
					{ adminLevels: [] },
					{ adminLevels: [-1] },
					{ adminLevels: [1.5] },
				]
				for (const request of invalidRequests) {
					try {
						await catalog.query(request)
						throw new Error('expected validation to fail')
					} catch (error) {
						expect(error).toBeInstanceOf(GeoCatalogError)
						expect(error).toMatchObject({ code: 'invalid_request', retryable: false })
					}
				}
			})
		})
	})
}

test('countryless recovery fails closed when an ISO code has multiple admin-0 boundaries', async () => {
	const nepal = entries.find((entry) => entry.id === 'admin:np')!
	const duplicateBoundary: GeoCatalogEntry = {
		...nepal,
		id: 'admin:np-duplicate',
		name: 'Duplicate Nepal boundary',
		aliases: [],
	}
	const catalog = createInMemoryGeoCatalog({
		snapshot,
		entries: [...entries, duplicateBoundary],
	})

	const result = await catalog.query({
		text: 'Trishuli River',
		kinds: ['waterway'],
		countryCode: 'NP',
	})

	expect(result.items).toEqual([])
	expect(result.metadata.query.diagnostics?.countrylessSpatialFallback).toBeUndefined()
})

test('recovery preserves adapter truncation after filtering a partial result page', async () => {
	const tibet = entries.find((entry) => entry.id === 'admin:cn-tibet')!
	const rongma = entries.find((entry) => entry.id === 'locality:rongma-tibet')!
	const prefixMatch: GeoCatalogEntry = {
		...rongma,
		id: 'locality:rongma-prefix-match',
		name: 'Rongma East',
	}
	const adapter: GeoCatalogAdapter = {
		snapshot,
		query(request) {
			if (request.text === 'rongma tibet') return { entries: [], hasMore: false }
			if (request.text === 'tibet' && request.kinds.includes('admin')) {
				return { entries: [tibet], hasMore: false }
			}
			if (request.text === 'rongma') {
				return { entries: [rongma, prefixMatch], hasMore: true }
			}
			return { entries: [], hasMore: false }
		},
	}

	const result = await createGeoCatalog(adapter).query({
		text: 'Rongma Tibet',
		limit: 2,
	})

	expect(result.items.map((entry) => entry.id)).toEqual(['locality:rongma-tibet'])
	expect(result.metadata.query).toMatchObject({
		returned: 1,
		limit: 2,
		hasMore: true,
	})
})

test('snapshot entries reject empty categories and invalid admin levels', () => {
	expect(() =>
		createInMemoryGeoCatalog({
			snapshot,
			entries: [{ ...entries[0]!, categories: [' '] }],
		}),
	).toThrow(/categories must not contain empty classifications/)
	expect(() =>
		createInMemoryGeoCatalog({
			snapshot,
			entries: [{ ...entries[0]!, adminLevel: 1.5 }],
		}),
	).toThrow(/adminLevel must be a finite nonnegative integer/)
})

test('reports an unavailable requested kind from declared snapshot coverage', async () => {
	const catalog = createInMemoryGeoCatalog({
		snapshot: {
			...snapshot,
			coverage: { spatial: { scope: 'global' }, kinds: ['admin'] },
		},
		entries: entries.filter((entry) => entry.kind === 'admin'),
	})

	const result = await catalog.query({ text: 'Trishuli', kinds: ['waterway'] })
	expect(result.items).toEqual([])
	expect(result.metadata.coverage).toEqual({
		spatial: { status: 'global' },
		kinds: { status: 'unavailable', available: [], missing: ['waterway'] },
		zeroResultReason: 'kind_unavailable',
	})
})

test('marks coverage as unknown for a legacy snapshot without a declaration', async () => {
	const { coverage: _coverage, ...legacySnapshot } = snapshot
	const catalog = createInMemoryGeoCatalog({
		snapshot: legacySnapshot,
		entries: entries.slice(0, 1),
	})

	const result = await catalog.query({ text: 'not installed' })
	expect(result.metadata.coverage).toEqual({
		spatial: { status: 'unknown' },
		kinds: { status: 'unknown', available: [], missing: [] },
		zeroResultReason: 'coverage_unknown',
	})
})

test('a missing SQLite snapshot fails on query without failing startup', async () => {
	const catalog = openSqliteGeoCatalog({
		path: `/tmp/earthly-geocatalog-does-not-exist-${crypto.randomUUID()}.sqlite`,
	})
	try {
		await catalog.query({ text: 'Nepal' })
		throw new Error('expected unavailable snapshot')
	} catch (error) {
		expect(error).toBeInstanceOf(GeoCatalogError)
		expect(error).toMatchObject({ code: 'snapshot_unavailable', retryable: false })
	}
})

test('the unfiltered SQLite query walks the result-order index without a temporary sort', () => {
	const database = new Database(':memory:', { strict: true })
	try {
		initializeSqliteGeoCatalogForTests(database, snapshot, [...entries].reverse())
		const plan = explainSqliteGeoCatalogQueryForTests(database, { limit: 1 })

		expect(plan.some((detail) => detail.includes('geocatalog_features_order'))).toBe(true)
		expect(plan.some((detail) => detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false)
	} finally {
		database.close()
	}
})

test('SQLite discovery does not read or parse stored geometry', async () => {
		const database = new Database(':memory:', { strict: true })
		try {
			initializeSqliteGeoCatalogForTests(database, snapshot, entries)
			database
				.query('UPDATE geocatalog_features SET geometry_json = ? WHERE id = ?')
				.run('{not-valid-json', 'admin:np')
			const catalog = createSqliteGeoCatalogForDatabase(database)

			const discovery = await catalog.query({ ids: ['admin:np'] })
			expect(discovery.items[0]?.id).toBe('admin:np')
			expect(discovery.items[0]).not.toHaveProperty('geometry')

			await expect(
				catalog.query({ ids: ['admin:np'], includeGeometry: true }),
			).rejects.toMatchObject({ code: 'snapshot_invalid' })
		} finally {
			database.close()
		}
	})

test('the SQLite snapshot writer consumes an async entry stream', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'earthly-geocatalog-'))
	const path = join(directory, 'snapshot.sqlite')
	let pulled = 0
	async function* streamEntries(): AsyncIterable<GeoCatalogEntry> {
		for (const entry of entries.slice(0, 3)) {
			await Promise.resolve()
			pulled += 1
			yield entry
		}
	}

	try {
		await writeSqliteGeoCatalogSnapshot({ path, snapshot, entries: streamEntries() })
		expect(pulled).toBe(3)
		expect(existsSync(`${path}-wal`)).toBe(false)
		expect(existsSync(`${path}-shm`)).toBe(false)
		const catalog = openSqliteGeoCatalog({ path })
		const result = await catalog.query({ countryCode: 'NP' })
		expect(result.items.map((entry) => entry.id)).toEqual([
			'admin:np',
			'locality:timure',
			'locality:rasuwagadhi',
		])
	} finally {
		rmSync(directory, { recursive: true })
	}
})

test('a failed snapshot build removes only its incomplete artifacts and can be retried', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'earthly-geocatalog-failed-'))
	const path = join(directory, 'snapshot.sqlite')
	const invalidEntry: GeoCatalogEntry = { ...entries[0]!, id: '' }

	try {
		try {
			await writeSqliteGeoCatalogSnapshot({ path, snapshot, entries: [invalidEntry] })
			throw new Error('expected snapshot build to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(GeoCatalogError)
			expect(error).toMatchObject({ code: 'snapshot_invalid' })
		}
		expect(existsSync(path)).toBe(false)
		expect(existsSync(`${path}-wal`)).toBe(false)
		expect(existsSync(`${path}-shm`)).toBe(false)

		await writeSqliteGeoCatalogSnapshot({ path, snapshot, entries: entries.slice(0, 1) })
		const catalog = openSqliteGeoCatalog({ path })
		const result = await catalog.query({ ids: ['admin:np'] })
		expect(result.items[0]?.name).toBe('Nepal')
	} finally {
		rmSync(directory, { recursive: true })
	}
})

test('the snapshot writer refuses an existing output without changing it', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'earthly-geocatalog-existing-'))
	const path = join(directory, 'snapshot.sqlite')

	try {
		await writeSqliteGeoCatalogSnapshot({ path, snapshot, entries: entries.slice(0, 1) })
		await expect(
			writeSqliteGeoCatalogSnapshot({ path, snapshot, entries: entries.slice(1, 2) }),
		).rejects.toMatchObject({ code: 'snapshot_invalid' })

		const catalog = openSqliteGeoCatalog({ path })
		const result = await catalog.query({ limit: 10 })
		expect(result.items.map((entry) => entry.id)).toEqual(['admin:np'])
	} finally {
		rmSync(directory, { recursive: true })
	}
})
