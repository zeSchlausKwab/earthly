import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryGeoCatalog } from './in-memory'
import {
	formatGeoCatalogReadiness,
	preflightGeoCatalog,
} from './preflight'
import { openSqliteGeoCatalog } from './sqlite'
import type {
	GeoCatalog,
	GeoCatalogEntry,
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
