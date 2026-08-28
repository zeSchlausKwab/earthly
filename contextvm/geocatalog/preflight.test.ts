import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryGeoCatalog } from './in-memory'
import { createOvertureSourceRelease } from './overture'
import {
	formatGeoCatalogReadiness,
	preflightGeoCatalog,
} from './preflight'
import { openSqliteGeoCatalog, writeSqliteGeoCatalogSnapshot } from './sqlite'
import type {
	GeoCatalog,
	GeoCatalogEntry,
	GeoCatalogSourceDocument,
	GeoCatalogSourceRelease,
	GeoCatalogSnapshotMetadata,
} from './types'

const snapshot: GeoCatalogSnapshotMetadata = {
	id: 'earthly-production-2026-08-28',
	createdAt: '2026-08-28T14:00:00.000Z',
	schemaVersion: 1,
	sources: [
		{ name: 'Overture Maps', release: '2026-08-20.0' },
		{ name: 'Natural Earth', release: '5.1.2' },
	],
}

const entry: GeoCatalogEntry = {
	id: 'admin:at',
	kind: 'admin',
	name: 'Austria',
	aliases: ['Republic of Austria'],
	categories: ['country', 'administrative-boundary'],
	countryCode: 'AT',
	adminLevel: 0,
	bbox: [9.53, 46.37, 17.16, 49.02],
	center: { longitude: 14.13, latitude: 47.59 },
	importance: 100,
	source: { name: 'Overture Maps', release: '2026-08-20.0' },
	properties: {},
}

function currentPlacesSnapshot(): GeoCatalogSnapshotMetadata {
	return {
		id: 'earthly-production-places-2026-08-28',
		createdAt: '2026-08-28T14:00:00.000Z',
		schemaVersion: 1,
		sources: [createOvertureSourceRelease('2026-08-20.0', ['place'])],
	}
}

function requiredPlacesSource(snapshot: GeoCatalogSnapshotMetadata): GeoCatalogSourceRelease {
	const source = snapshot.sources.find((candidate) => candidate.name === 'Overture Maps')
	if (!source) throw new Error('Test snapshot is missing its Overture source')
	return source
}

function requiredSourceDocument(
	snapshot: GeoCatalogSnapshotMetadata,
	name: string,
): GeoCatalogSourceDocument {
	const document = requiredPlacesSource(snapshot).documents?.find(
		(candidate) => candidate.name === name,
	)
	if (!document) throw new Error(`Test snapshot is missing ${name}`)
	return document
}

async function usingStoredPlacesSnapshot(
	mutate: ((stored: GeoCatalogSnapshotMetadata) => void) | undefined,
	run: (catalog: GeoCatalog) => Promise<void>,
): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), 'earthly-geocatalog-places-preflight-'))
	const path = join(directory, 'places.sqlite')
	const validSnapshot = currentPlacesSnapshot()
	await writeSqliteGeoCatalogSnapshot({ path, snapshot: validSnapshot, entries: [entry] })

	if (mutate) {
		const database = new Database(path, { strict: true })
		try {
			const row = database
				.query<{ snapshot_json: string }, []>(
					'SELECT snapshot_json FROM geocatalog_metadata WHERE singleton = 1',
				)
				.get()
			if (!row) throw new Error('Test snapshot metadata is missing')
			const stored = JSON.parse(row.snapshot_json) as GeoCatalogSnapshotMetadata
			mutate(stored)
			database
				.query<never, [string]>(
					'UPDATE geocatalog_metadata SET snapshot_json = ? WHERE singleton = 1',
				)
				.run(JSON.stringify(stored))
		} finally {
			database.close()
		}
	}

	try {
		await run(openSqliteGeoCatalog({ path }))
	} finally {
		rmSync(directory, { recursive: true })
	}
}

const incompletePlacesManifests: Array<{
	name: string
	expectedMessage: string
	mutate(snapshot: GeoCatalogSnapshotMetadata): void
}> = [
	{
		name: 'missing Apache license document',
		expectedMessage: 'is missing the full Apache License 2.0 text',
		mutate(stored) {
			const source = requiredPlacesSource(stored)
			source.documents = source.documents?.filter(
				(document) => document.name !== 'Apache License 2.0',
			)
		},
	},
	{
		name: 'truncated Apache license document',
		expectedMessage: 'is missing the full Apache License 2.0 text',
		mutate(stored) {
			const document = requiredSourceDocument(stored, 'Apache License 2.0')
			document.content = document.content?.slice(0, -1)
		},
	},
	{
		name: 'missing Foursquare NOTICE document',
		expectedMessage: 'is missing the full Foursquare Places NOTICE',
		mutate(stored) {
			const source = requiredPlacesSource(stored)
			source.documents = source.documents?.filter(
				(document) => document.name !== 'Foursquare OS Places NOTICE.txt',
			)
		},
	},
	{
		name: 'truncated Foursquare NOTICE document',
		expectedMessage: 'is missing the full Foursquare Places NOTICE',
		mutate(stored) {
			const document = requiredSourceDocument(stored, 'Foursquare OS Places NOTICE.txt')
			document.content = document.content?.slice(0, -1)
		},
	},
	{
		name: 'missing Earthly modification notice',
		expectedMessage: "is missing Earthly's Places modification notice",
		mutate(stored) {
			const source = requiredPlacesSource(stored)
			source.attribution = source.attribution?.replace(
				/; Earthly modification notice:[^;]+/u,
				'',
			)
		},
	},
]

describe('GeoCatalog production preflight', () => {
	test('keeps development lazy and does not query the catalog', async () => {
		let queries = 0
		const catalog: GeoCatalog = {
			async query() {
				queries += 1
				throw new Error('development must not query during startup')
			},
		}

		await expect(preflightGeoCatalog({ catalog, required: false })).resolves.toBeNull()
		expect(queries).toBe(0)
	})

	test('fails when the production snapshot is missing', async () => {
		const catalog = openSqliteGeoCatalog({
			path: join(tmpdir(), `earthly-missing-${crypto.randomUUID()}.sqlite`),
		})

		await expect(
			preflightGeoCatalog({ catalog, required: true }),
		).rejects.toMatchObject({
			code: 'snapshot_unavailable',
			retryable: false,
		})
	})

	test('fails when the production snapshot is invalid', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'earthly-geocatalog-preflight-'))
		const path = join(directory, 'invalid.sqlite')
		writeFileSync(path, 'not a SQLite snapshot')

		try {
			const catalog = openSqliteGeoCatalog({ path })
			await expect(
				preflightGeoCatalog({ catalog, required: true }),
			).rejects.toMatchObject({
				code: 'snapshot_invalid',
				retryable: false,
			})
		} finally {
			rmSync(directory, { recursive: true })
		}
	})

	test('fails when a valid snapshot has no queryable entries', async () => {
		const catalog = createInMemoryGeoCatalog({ snapshot, entries: [] })

		await expect(
			preflightGeoCatalog({ catalog, required: true }),
		).rejects.toMatchObject({
			code: 'snapshot_invalid',
			message: `GeoCatalog snapshot ${snapshot.id} contains no queryable entries`,
			retryable: false,
		})
	})

	test('accepts a stored snapshot with the current complete Overture Places manifest', async () => {
		await usingStoredPlacesSnapshot(undefined, async (catalog) => {
			const summary = await preflightGeoCatalog({ catalog, required: true })
			expect(summary).toMatchObject({
				snapshot: { id: 'earthly-production-places-2026-08-28', schemaVersion: 1 },
				sampleEntryId: 'admin:at',
			})
		})
	})

	for (const scenario of incompletePlacesManifests) {
		test(`rejects a stored Places snapshot with a ${scenario.name}`, async () => {
			await usingStoredPlacesSnapshot(scenario.mutate, async (catalog) => {
				await expect(
					preflightGeoCatalog({ catalog, required: true }),
				).rejects.toMatchObject({
					code: 'snapshot_invalid',
					message: expect.stringContaining(scenario.expectedMessage),
					retryable: false,
				})
			})
		})
	}

	test('returns a loggable snapshot and source summary for a usable catalog', async () => {
		const catalog = createInMemoryGeoCatalog({ snapshot, entries: [entry] })
		const summary = await preflightGeoCatalog({ catalog, required: true })

		expect(summary).toEqual({ snapshot, sampleEntryId: 'admin:at' })
		if (!summary) throw new Error('expected production readiness summary')
		expect(formatGeoCatalogReadiness(summary)).toBe(
			'earthly-production-2026-08-28 (Overture Maps@2026-08-20.0, Natural Earth@5.1.2)',
		)
	})
})
