import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryGeoCatalog } from './in-memory'
import {
	createSqliteGeoCatalogForDatabase,
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
	sources: [
		{
			name: 'Overture Maps',
			release: '2026-08-19.0',
			attribution: 'Overture Maps Foundation',
			license: 'CDLA-Permissive-2.0',
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
		countryCode: 'NP',
		bbox: [80.05, 26.35, 88.2, 30.45],
		center: { longitude: 84.12, latitude: 28.39 },
		importance: 100,
		source: { name: 'Overture Maps', release: '2026-08-19.0', recordId: 'gers-nepal' },
		properties: { adminLevel: 2, rank: 1 },
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
		countryCode: 'NP',
		bbox: [85.37, 28.24, 85.38, 28.25],
		center: { longitude: 85.374, latitude: 28.245 },
		importance: 31,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { populationClass: 'village' },
		geometry: { type: 'Point', coordinates: [85.374, 28.245] },
	},
	{
		id: 'place:kerung-port',
		kind: 'place',
		name: 'Gyirong Port',
		aliases: ['Kerung Port'],
		countryCode: 'CN',
		bbox: [85.36, 28.28, 85.37, 28.29],
		center: { longitude: 85.365, latitude: 28.285 },
		importance: 42,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { category: 'border_crossing' },
		geometry: { type: 'Point', coordinates: [85.365, 28.285] },
	},
	{
		id: 'road:pasang-lhamu',
		kind: 'road',
		name: 'Pasang Lhamu Highway',
		aliases: [],
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
		countryCode: 'NP',
		bbox: [84.9, 27.6, 85.5, 28.3],
		center: { longitude: 85.2, latitude: 27.95 },
		importance: 44,
		source: { name: 'HydroRIVERS', release: '1.0', recordId: 'hy-442' },
		properties: { order: 5 },
	},
	{
		id: 'infrastructure:rasuwa-bridge',
		kind: 'infrastructure',
		name: 'Rasuwagadhi Friendship Bridge',
		aliases: ['China–Nepal Friendship Bridge'],
		countryCode: 'NP',
		bbox: [85.374, 28.274, 85.376, 28.276],
		center: { longitude: 85.375, latitude: 28.275 },
		importance: 35,
		source: { name: 'Overture Maps', release: '2026-08-19.0' },
		properties: { class: 'bridge' },
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

		test('uses deterministic text, importance, name, and id ordering', async () => {
			await usingCatalog(async (catalog) => {
				const first = await catalog.query({ countryCode: 'NP', limit: 20 })
				const second = await catalog.query({ countryCode: 'NP', limit: 20 })
				expect(second.items.map((entry) => entry.id)).toEqual(
					first.items.map((entry) => entry.id),
				)
				expect(first.items.slice(0, 3).map((entry) => entry.id)).toEqual([
					'admin:np',
					'road:pasang-lhamu',
					'waterway:trishuli',
				])

				const aliasMatch = await catalog.query({ text: 'Kerung Port' })
				expect(aliasMatch.items[0]?.id).toBe('place:kerung-port')
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
				if (withGeometry.items[0]) withGeometry.items[0].properties.rank = 999

				const fresh = await catalog.query({ ids: ['admin:np'], includeGeometry: true })
				expect(fresh.items[0]?.aliases).not.toContain('mutated by caller')
				expect(fresh.items[0]?.properties.rank).toBe(1)
			})
		})

		test('returns snapshot and per-entry source release metadata', async () => {
			await usingCatalog(async (catalog) => {
				const result = await catalog.query({ ids: ['waterway:trishuli'] })
				expect(result.metadata.snapshot).toEqual(snapshot)
				expect(result.items[0]?.source).toEqual({
					name: 'HydroRIVERS',
					release: '1.0',
					recordId: 'hy-442',
				})
			})
		})

		test('raises typed validation errors at the Interface', async () => {
			await usingCatalog(async (catalog) => {
				try {
					await catalog.query({ near: { longitude: 85, latitude: 28 } })
					throw new Error('expected validation to fail')
				} catch (error) {
					expect(error).toBeInstanceOf(GeoCatalogError)
					expect(error).toMatchObject({ code: 'invalid_request', retryable: false })
				}
			})
		})
	})
}

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
