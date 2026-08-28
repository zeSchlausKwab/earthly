import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	buildOvertureGeoCatalogSnapshot,
	parseBuildGeoCatalogArgs,
} from '../../scripts/build-geocatalog'
import { openSqliteGeoCatalog } from './index'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	)
})

async function temporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'earthly-water-corridor-test-'))
	temporaryDirectories.push(path)
	return path
}

interface RiverOptions {
	primary?: string
	common?: Array<[string, string]>
	wikidata?: string
	sourceRecordId?: string
}

function river(id: string, coordinates: number[][], options: RiverOptions = {}) {
	const primary = options.primary ?? 'Trishuli River'
	return {
		type: 'Feature',
		id,
		geometry: { type: 'LineString', coordinates },
		properties: {
			theme: 'base',
			type: 'water',
			version: 1,
			sources: [
				{
					property: '',
					dataset: 'OpenStreetMap',
					license: 'ODbL-1.0',
					record_id: options.sourceRecordId ?? `way/${id}`,
				},
			],
			subtype: 'river',
			class: 'river',
			names: {
				primary,
				common: options.common ?? [['ne', 'त्रिशूली नदी']],
			},
			...(options.wikidata ? { wikidata: options.wikidata } : {}),
			source_tags: [['waterway', 'river']],
		},
	}
}

describe('Overture base-water corridor assembly', () => {
	test('accepts an explicit AOI footprint for operator-built snapshots', () => {
		const parsed = parseBuildGeoCatalogArgs([
			'--release',
			'2026-08-19.0',
			'--snapshot-id',
			'nepal-aoi-v2',
			'--output',
			'catalog.sqlite',
			'--coverage',
			'85.05,27.75,86.1,29.1',
			'--input',
			'water=water.geojsonseq',
		])

		expect(parsed?.coverage).toEqual({
			scope: 'bbox',
			bbox: [85.05, 27.75, 86.1, 29.1],
		})
	})

	test('rejects wrapped antimeridian coverage before starting a build', () => {
		expect(() =>
			parseBuildGeoCatalogArgs([
				'--release',
				'2026-08-19.0',
				'--snapshot-id',
				'antimeridian-aoi',
				'--output',
				'catalog.sqlite',
				'--coverage',
				'170,-10,-170,10',
				'--input',
				'water=water.geojsonseq',
			]),
		).toThrow(
			'--coverage west must be less than or equal to east; wrapped antimeridian bounds are not supported',
		)
	})

	test('creates one deterministic aggregate for connected named river fragments', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'water.geojsonseq')
		const output = join(directory, 'catalog.sqlite')
		const records = [
			river('trishuli-a', [
				[85.2, 28.1],
				[85.21, 28.05],
			]),
			river(
				'trishuli-b',
				[
					[85.21, 28.05],
					[85.22, 28.0],
				],
				{
					primary: 'त्रिशूली नदी',
					common: [['en', 'Trishuli-River']],
				},
			),
			// A same-name collision must remain a raw fragment rather than being
			// merged across a genuine geometry gap.
			river('trishuli-disconnected', [
				[86, 28],
				[86.1, 28],
			]),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'overture-water-corridors-v1',
			createdAt: '2026-08-28T00:00:00Z',
			coverage: { scope: 'bbox', bbox: [85.05, 27.75, 86.1, 29.1] },
			output,
			inputs: [{ featureType: 'water', path: input }],
		})

		expect(result).toMatchObject({
			recordsRead: 3,
			entriesWritten: 4,
			corridorsWritten: 1,
		})
		expect(result.snapshot.coverage).toEqual({
			spatial: { scope: 'bbox', bbox: [85.05, 27.75, 86.1, 29.1] },
			kinds: ['waterway'],
		})
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Trishuli River',
			kinds: ['waterway'],
			includeGeometry: true,
			limit: 20,
		})
		const aggregate = query.items.find(
			(entry) => entry.properties.overtureType === 'water_corridor',
		)
		expect(query.items[0]?.properties.overtureType).toBe('water_corridor')
		expect(aggregate).toMatchObject({
			kind: 'waterway',
			name: 'Trishuli River',
			aliases: expect.arrayContaining(['Trishuli-River', 'त्रिशूली नदी']),
			categories: ['corridor', 'river'],
			properties: {
				overtureTheme: 'base',
				overtureType: 'water_corridor',
				corridorScope: 'connected-name',
				memberCount: 2,
				derivedFrom: {
					name: 'Overture Maps',
					release: '2026-08-19.0',
					featureType: 'water',
				},
			},
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[85.2, 28.1],
						[85.21, 28.05],
					],
					[
						[85.21, 28.05],
						[85.22, 28],
					],
				],
			},
		})
		expect(aggregate?.id).toMatch(/^overture:base:water_corridor:/u)
	})

	test('connects conservative hydronym variants but not geometry collisions', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'water.geojsonseq')
		const output = join(directory, 'catalog.sqlite')
		const records = [
			river(
				'kalphu-a',
				[
					[85.1, 27.9],
					[85.11, 27.91],
				],
				{ primary: 'Kalphu Khola', common: [] },
			),
			river(
				'kalphu-b',
				[
					[85.11, 27.91],
					[85.12, 27.92],
				],
				{ primary: 'Kalphu River', common: [] },
			),
			// The normalized name still cannot bridge a real geometry gap.
			river(
				'kalphu-disconnected',
				[
					[86, 28],
					[86.1, 28],
				],
				{ primary: 'Kalphu River', common: [] },
			),
			// A different named waterway may meet at a confluence but must not
			// become part of the Kalphu aggregate.
			river(
				'other-confluence',
				[
					[85.11, 27.91],
					[85.1, 27.92],
				],
				{ primary: 'Other River', common: [] },
			),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'overture-water-name-variants-v1',
			createdAt: '2026-08-28T00:00:00Z',
			output,
			inputs: [{ featureType: 'water', path: input }],
		})

		expect(result).toMatchObject({
			recordsRead: 4,
			entriesWritten: 5,
			corridorsWritten: 1,
		})
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Kalphu',
			kinds: ['waterway'],
			includeGeometry: true,
			limit: 20,
		})
		const aggregate = query.items.find(
			(entry) => entry.properties.overtureType === 'water_corridor',
		)
		expect(aggregate).toMatchObject({
			name: 'Kalphu Khola',
			aliases: ['Kalphu River'],
			properties: { memberCount: 2 },
		})
	})

	test('uses a shared strong source identity when adjacent names differ', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'water.geojsonseq')
		const output = join(directory, 'catalog.sqlite')
		const records = [
			river(
				'source-a',
				[
					[85.3, 28.2],
					[85.31, 28.21],
				],
				{ primary: 'Upper River', common: [], wikidata: 'Q1234' },
			),
			river(
				'source-b',
				[
					[85.31, 28.21],
					[85.32, 28.22],
				],
				{ primary: 'Lower River', common: [], wikidata: 'Q1234' },
			),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'overture-water-source-identity-v1',
			createdAt: '2026-08-28T00:00:00Z',
			output,
			inputs: [{ featureType: 'water', path: input }],
		})

		expect(result.corridorsWritten).toBe(1)
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Upper River',
			kinds: ['waterway'],
			includeGeometry: true,
			limit: 20,
		})
		expect(
			query.items.find((entry) => entry.properties.overtureType === 'water_corridor'),
		).toMatchObject({
			name: 'Lower River',
			aliases: ['Upper River'],
			properties: { memberCount: 2 },
		})
	})
})
