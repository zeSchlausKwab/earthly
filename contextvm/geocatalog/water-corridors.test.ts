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

function routedRoad(id: string, coordinates: number[][]) {
	return {
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
			subtype: 'road',
			class: 'primary',
			country: 'NP',
			names: { primary: 'Deterministic Route' },
			routes: [{ name: 'Deterministic Route', network: 'Test', ref: 'T1' }],
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
					[85.22, 28.0],
					[85.21, 28.05],
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
				componentCount: 1,
				gapCount: 0,
				pathCount: 1,
				stitchedJoinCount: 1,
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
						[85.22, 28],
					],
				],
			},
		})
		expect(aggregate?.id).toMatch(/^overture:base:water_corridor:/u)
	})

	test('stitches only unambiguous endpoints and reports branches, gaps, and duplicates', async () => {
		const directory = await temporaryDirectory()
		const firstInput = join(directory, 'route-a.geojsonseq')
		const secondInput = join(directory, 'route-b.geojsonseq')
		const firstOutput = join(directory, 'route-a.sqlite')
		const secondOutput = join(directory, 'route-b.sqlite')
		const records = [
			routedRoad('route-a', [
				[0, 0],
				[1, 0],
			]),
			// Reversed source orientation must be corrected in the derived path.
			routedRoad('route-b-reversed', [
				[2, 0],
				[1, 0],
			]),
			// A third edge at the shared endpoint is a real branch. The builder
			// must not choose an arbitrary mainline through it.
			routedRoad('route-branch', [
				[1, 0],
				[1, 1],
			]),
			// Reversed byte-identical geometry remains a raw feature but is not
			// repeated in the derived MultiLineString.
			routedRoad('route-duplicate', [
				[1, 0],
				[0, 0],
			]),
			routedRoad('route-gap', [
				[10, 0],
				[11, 0],
			]),
		]
		await Bun.write(firstInput, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
		await Bun.write(
			secondInput,
			`${records
				.slice()
				.reverse()
				.map((record) => JSON.stringify(record))
				.join('\n')}\n`,
		)

		const build = (input: string, output: string, snapshotId: string) =>
			buildOvertureGeoCatalogSnapshot({
				release: '2026-08-19.0',
				snapshotId,
				createdAt: '2026-08-28T00:00:00Z',
				output,
				inputs: [{ featureType: 'segment', path: input }],
			})
		const firstResult = await build(firstInput, firstOutput, 'corridor-assembly-a')
		const secondResult = await build(secondInput, secondOutput, 'corridor-assembly-b')
		expect(firstResult).toMatchObject({
			recordsRead: 5,
			entriesWritten: 6,
			corridorsWritten: 1,
			corridorAssembly: {
				components: 2,
				paths: 4,
				stitchedJoins: 0,
				duplicateGeometryMembers: 1,
				branchPoints: 1,
				corridorsWithGaps: 1,
			},
		})
		expect(firstResult.outputBytes).toBeGreaterThan(0)

		const readCorridor = async (path: string) => {
			const catalog = openSqliteGeoCatalog({ path })
			const result = await catalog.query({
				text: 'Deterministic Route',
				includeGeometry: true,
				limit: 20,
			})
			return result.items.find((entry) => entry.properties.overtureType === 'corridor')
		}
		const firstCorridor = await readCorridor(firstOutput)
		const secondCorridor = await readCorridor(secondOutput)
		expect(firstCorridor).toBeDefined()
		expect(secondCorridor).toBeDefined()
		expect(secondCorridor).toEqual(firstCorridor)
		expect(firstCorridor?.properties).toMatchObject({
			memberCount: 5,
			componentCount: 2,
			gapCount: 1,
			pathCount: 4,
			stitchedJoinCount: 0,
			branchPointCount: 1,
			duplicateGeometryMemberCount: 1,
		})
		expect(firstCorridor?.properties.memberIdSample).toEqual([
			'overture:transportation:segment:route-a',
			'overture:transportation:segment:route-b-reversed',
			'overture:transportation:segment:route-branch',
			'overture:transportation:segment:route-duplicate',
			'overture:transportation:segment:route-gap',
		])
		expect(firstCorridor?.properties.memberIdSampleTruncated).toBe(false)
		expect(firstCorridor?.properties.memberIds).toBeUndefined()
		expect(firstCorridor?.properties.components).toBeUndefined()
		expect(firstCorridor?.properties.pathMemberIndexes).toBeUndefined()
		expect(firstCorridor?.geometry).toMatchObject({
			type: 'MultiLineString',
			coordinates: expect.arrayContaining([
				[
					[0, 0],
					[1, 0],
				],
				[
					[1, 0],
					[2, 0],
				],
				[
					[1, 0],
					[1, 1],
				],
				[
					[10, 0],
					[11, 0],
				],
			]),
		})
	})

	test('keeps an endpoint-connected backtrack separate instead of creating a false self-overlap', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'backtrack.geojsonseq')
		const output = join(directory, 'backtrack.sqlite')
		const records = [
			routedRoad('backtrack-a', [
				[0, 0],
				[1, 0],
				[2, 0],
			]),
			routedRoad('backtrack-b', [
				[2, 0],
				[1, 0],
				[1, 1],
			]),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'corridor-backtrack-v1',
			createdAt: '2026-08-28T00:00:00Z',
			output,
			inputs: [{ featureType: 'segment', path: input }],
		})
		expect(result.corridorAssembly).toMatchObject({
			paths: 2,
			stitchedJoins: 0,
			repeatedSegmentJoinsPrevented: 1,
		})
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Deterministic Route',
			includeGeometry: true,
			limit: 10,
		})
		const corridor = query.items.find(
			(entry) => entry.properties.overtureType === 'corridor',
		)
		expect(corridor?.properties).toMatchObject({
			componentCount: 1,
			pathCount: 2,
			repeatedSegmentJoinCount: 1,
		})
		expect(corridor?.geometry).toMatchObject({
			type: 'MultiLineString',
			coordinates: expect.arrayContaining([
				[
					[0, 0],
					[1, 0],
					[2, 0],
				],
				[
					[1, 1],
					[1, 0],
					[2, 0],
				],
			]),
		})
	})

	test('retains a source-authored crossing when endpoint topology is unambiguous', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'crossing.geojsonseq')
		const output = join(directory, 'crossing.sqlite')
		const records = [
			routedRoad('crossing-a', [
				[0, 0],
				[2, 2],
				[0, 2],
			]),
			routedRoad('crossing-b', [
				[0, 2],
				[2, 0],
			]),
		]
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		const result = await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'corridor-crossing-v1',
			createdAt: '2026-08-28T00:00:00Z',
			output,
			inputs: [{ featureType: 'segment', path: input }],
		})
		expect(result.corridorAssembly).toMatchObject({
			paths: 1,
			stitchedJoins: 1,
			repeatedSegmentJoinsPrevented: 0,
		})
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Deterministic Route',
			includeGeometry: true,
			limit: 10,
		})
		const corridor = query.items.find(
			(entry) => entry.properties.overtureType === 'corridor',
		)
		expect(corridor?.geometry).toEqual({
			type: 'MultiLineString',
			coordinates: [
				[
					[0, 0],
					[2, 2],
					[0, 2],
					[2, 0],
				],
			],
		})
	})

	test('bounds corridor provenance metadata while raw members remain queryable', async () => {
		const directory = await temporaryDirectory()
		const input = join(directory, 'many-members.geojsonseq')
		const output = join(directory, 'many-members.sqlite')
		const records = Array.from({ length: 15 }, (_, index) =>
			routedRoad(`many-${String(index).padStart(2, '0')}`, [
				[index, 0],
				[index, 1],
			]),
		)
		await Bun.write(input, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)

		await buildOvertureGeoCatalogSnapshot({
			release: '2026-08-19.0',
			snapshotId: 'corridor-bounded-metadata-v1',
			createdAt: '2026-08-28T00:00:00Z',
			output,
			inputs: [{ featureType: 'segment', path: input }],
		})
		const catalog = openSqliteGeoCatalog({ path: output })
		const query = await catalog.query({
			text: 'Deterministic Route',
			includeGeometry: true,
			limit: 30,
		})
		const corridor = query.items.find(
			(entry) => entry.properties.overtureType === 'corridor',
		)
		expect(corridor?.properties).toMatchObject({
			memberCount: 15,
			memberIdSampleTruncated: true,
			componentCount: 15,
			gapCount: 14,
		})
		expect(corridor?.properties.memberIdSample).toHaveLength(12)
		expect(corridor?.properties.memberIds).toBeUndefined()
		expect(corridor?.properties.components).toBeUndefined()
		expect(corridor?.properties.pathMemberIndexes).toBeUndefined()
		expect(query.items.filter((entry) => entry.properties.overtureType === 'segment')).toHaveLength(
			15,
		)
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
