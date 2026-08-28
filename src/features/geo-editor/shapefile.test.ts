import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import JSZip from 'jszip'
import {
	EARTHLY_SHAPEFILE_METADATA_FILE,
	EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY,
	exportShapefile,
	importShapefile,
} from './shapefile'

const MANIFEST_PROPERTY = 'earthly:geoCatalogSourceManifest:snapshot-2026-08-19'
const APACHE_LICENSE = `Apache License\nVersion 2.0, January 2004\n${'terms '.repeat(100)}`
const FOURSQUARE_NOTICE = `Foursquare Places NOTICE\n${'notice '.repeat(100)}`
const SOURCE = {
	name: 'Overture Maps',
	release: '2026-08-19.0',
	recordId: 'overture:place:fixture',
	snapshotId: 'snapshot-2026-08-19',
	manifestProperty: MANIFEST_PROPERTY,
	attribution: 'Overture Maps Foundation',
	license: 'Apache-2.0',
}
const SOURCE_RECORDS = [
	{
		dataset: 'Overture Places',
		recordId: 'fixture-source-record',
		license: 'Apache-2.0',
		notice: 'x'.repeat(1_000),
	},
]
const MANIFEST = JSON.stringify({
	schemaVersion: 1,
	snapshotId: 'snapshot-2026-08-19',
	createdAt: '2026-08-19T00:00:00.000Z',
	sources: [
		{
			name: 'Overture Maps',
			release: '2026-08-19.0',
			license: 'Apache-2.0',
			documents: [
				{ name: 'Apache License 2.0', url: 'https://example.test/apache', content: APACHE_LICENSE },
				{
					name: 'Foursquare Places NOTICE',
					url: 'https://example.test/notice',
					content: FOURSQUARE_NOTICE,
				},
			],
		},
	],
})

function catalogCollection(): FeatureCollection {
	return {
		type: 'FeatureCollection',
		bbox: [16, 48, 17, 49],
		name: 'Overture provenance fixture',
		description: 'A collection whose legal metadata must survive export.',
		color: '#123456',
		revision: 'fixture-revision',
		properties: {
			name: 'Overture provenance fixture',
			description: 'A collection whose legal metadata must survive export.',
			color: '#123456',
			[MANIFEST_PROPERTY]: MANIFEST,
		},
		features: [
			{
				type: 'Feature',
				id: 'overture:place:fixture',
				geometry: {
					type: 'MultiPoint',
					coordinates: [
						[16.1, 48.1],
						[16.2, 48.2],
					],
				},
				properties: {
					name: 'Fixture place',
					catalogId: 'overture:place:fixture',
					source: SOURCE,
					sourceRecords: SOURCE_RECORDS,
					customProperties: {
						theme: 'places',
						source: SOURCE,
						sourceRecords: SOURCE_RECORDS,
					},
				},
			},
		],
	} as FeatureCollection
}

async function genericShapefileBlob(
	properties: Record<string, unknown> = { label: 'generic' },
	featureCount = 1,
): Promise<Blob> {
	const { zip } = await import('@mapbox/shp-write')
	return zip<'blob'>(
		{
			type: 'FeatureCollection',
			features: Array.from({ length: featureCount }, (_, index) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [16.3 + index * 0.01, 48.3] },
				properties,
			})),
		},
		{
			filename: 'generic',
			folder: 'generic',
			outputType: 'blob',
			compression: 'STORE',
		},
	)
}

describe('Earthly Shapefile provenance sidecar', () => {
	test('exports complete collection metadata and exact per-row provenance', async () => {
		const exported = await exportShapefile(catalogCollection(), 'catalog-fixture')
		const archive = await JSZip.loadAsync(await exported.blob.arrayBuffer())
		const entry = archive.file(EARTHLY_SHAPEFILE_METADATA_FILE)
		expect(entry).not.toBeNull()
		if (!entry) throw new Error('Expected Earthly metadata sidecar in Shapefile ZIP')

		const sidecar = JSON.parse(await entry.async('text'))
		expect(sidecar).toMatchObject({
			schemaVersion: 1,
			collection: {
				bbox: [16, 48, 17, 49],
				name: 'Overture provenance fixture',
				description: 'A collection whose legal metadata must survive export.',
				color: '#123456',
				revision: 'fixture-revision',
			},
		})
		expect(sidecar.collection.properties[MANIFEST_PROPERTY]).toBe(MANIFEST)
		const preservedManifest = JSON.parse(sidecar.collection.properties[MANIFEST_PROPERTY])
		expect(preservedManifest.sources[0].documents[0].content).toBe(APACHE_LICENSE)
		expect(preservedManifest.sources[0].documents[1].content).toBe(FOURSQUARE_NOTICE)
		expect(sidecar.rows).toHaveLength(2)
		expect(sidecar.rows[0]).toEqual({
			token: 'e0000000',
			id: 'overture:place:fixture:0',
			source: SOURCE,
			sourceRecords: SOURCE_RECORDS,
		})
		expect(sidecar.rows[1]).toEqual({
			token: 'e0000001',
			id: 'overture:place:fixture:1',
			source: SOURCE,
			sourceRecords: SOURCE_RECORDS,
		})
	})

	test('restores collection metadata, expanded feature ids, and structured provenance', async () => {
		const exported = await exportShapefile(catalogCollection(), 'catalog-fixture')
		const imported = await importShapefile(
			new File([exported.blob], exported.downloadName, { type: 'application/zip' }),
		)

		expect(imported.bbox).toEqual([16, 48, 17, 49])
		expect((imported as FeatureCollection & { name?: string }).name).toBe(
			'Overture provenance fixture',
		)
		expect((imported as FeatureCollection & { revision?: string }).revision).toBe(
			'fixture-revision',
		)
		expect(
			(imported as FeatureCollection & { properties?: Record<string, unknown> }).properties?.[
				MANIFEST_PROPERTY
			],
		).toBe(MANIFEST)
		expect(imported.features.map((feature) => feature.id)).toEqual([
			'overture:place:fixture:0',
			'overture:place:fixture:1',
		])

		for (const feature of imported.features) {
			expect(feature.properties?.source).toEqual(SOURCE)
			expect(feature.properties?.sourceRecords).toEqual(SOURCE_RECORDS)
			expect(feature.properties).not.toHaveProperty(EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY)
			expect(feature.properties).not.toHaveProperty('sourceReco')
		}
	})

	test('keeps provenance out of truncation-prone DBF fields', async () => {
		const exported = await exportShapefile(catalogCollection(), 'catalog-fixture')
		const archive = await JSZip.loadAsync(await exported.blob.arrayBuffer())
		archive.remove(EARTHLY_SHAPEFILE_METADATA_FILE)
		const shapefileOnly = await archive.generateAsync({ type: 'blob', compression: 'STORE' })
		const imported = await importShapefile(
			new File([shapefileOnly], 'without-sidecar.zip', { type: 'application/zip' }),
		)

		expect(imported.features).toHaveLength(2)
		for (const feature of imported.features) {
			expect(feature.properties).not.toHaveProperty(EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY)
			expect(feature.properties).not.toHaveProperty('source')
			expect(feature.properties).not.toHaveProperty('sourceRecords')
			expect(feature.properties).not.toHaveProperty('sourceReco')
			expect(feature.properties).not.toHaveProperty('customProperties')
		}
	})

	test('continues to import generic ZIPs without an Earthly sidecar', async () => {
		const blob = await genericShapefileBlob()
		const imported = await importShapefile(
			new File([blob], 'generic.zip', { type: 'application/zip' }),
		)

		expect(imported.features).toHaveLength(1)
		expect(imported.features[0]?.properties?.label).toBe('generic')
	})

	test('keeps raw SHP imports metadata-less', async () => {
		const archive = await JSZip.loadAsync(await (await genericShapefileBlob()).arrayBuffer())
		const shapeEntry = Object.values(archive.files).find(
			(entry) => !entry.dir && entry.name.toLowerCase().endsWith('.shp'),
		)
		if (!shapeEntry) throw new Error('Expected a .shp entry in the generic fixture')
		const shape = await shapeEntry.async('arraybuffer')
		const imported = await importShapefile(
			new File([shape], 'generic.shp', { type: 'application/octet-stream' }),
		)

		expect(imported.features).toHaveLength(1)
		expect(imported.features[0]?.properties).not.toHaveProperty('source')
		expect(imported.features[0]?.properties).not.toHaveProperty('sourceRecords')
		expect(imported).not.toHaveProperty('properties')
	})

	test('fails closed when a reserved Earthly sidecar is malformed', async () => {
		const archive = await JSZip.loadAsync(await (await genericShapefileBlob()).arrayBuffer())
		archive.file(
			EARTHLY_SHAPEFILE_METADATA_FILE,
			JSON.stringify({ schemaVersion: 2, collection: {}, rows: [] }),
		)
		const blob = await archive.generateAsync({ type: 'blob', compression: 'STORE' })

		await expect(
			importShapefile(new File([blob], 'malformed.zip', { type: 'application/zip' })),
		).rejects.toThrow('aborted to avoid losing source and license information')
	})

	test('fails closed when an imported row has no matching sidecar token', async () => {
		const archive = await JSZip.loadAsync(await (await genericShapefileBlob()).arrayBuffer())
		archive.file(
			EARTHLY_SHAPEFILE_METADATA_FILE,
			JSON.stringify({ schemaVersion: 1, collection: {}, rows: [] }),
		)
		const blob = await archive.generateAsync({ type: 'blob', compression: 'STORE' })

		await expect(
			importShapefile(new File([blob], 'missing-token.zip', { type: 'application/zip' })),
		).rejects.toThrow('aborted to avoid losing source and license information')
	})

	test('fails closed when a sidecar row is unused', async () => {
		const exported = await exportShapefile(catalogCollection(), 'catalog-fixture')
		const archive = await JSZip.loadAsync(await exported.blob.arrayBuffer())
		const entry = archive.file(EARTHLY_SHAPEFILE_METADATA_FILE)
		if (!entry) throw new Error('Expected Earthly metadata sidecar in Shapefile ZIP')
		const sidecar = JSON.parse(await entry.async('text'))
		sidecar.rows.push({ token: 'ezzzzzzz', id: 'orphaned-feature' })
		archive.file(EARTHLY_SHAPEFILE_METADATA_FILE, JSON.stringify(sidecar))
		const blob = await archive.generateAsync({ type: 'blob', compression: 'STORE' })

		await expect(
			importShapefile(new File([blob], 'unused-row.zip', { type: 'application/zip' })),
		).rejects.toThrow('aborted to avoid losing source and license information')
	})

	test('fails closed when DBF rows reuse a sidecar token', async () => {
		const archive = await JSZip.loadAsync(
			await (
				await genericShapefileBlob(
					{
						[EARTHLY_SHAPEFILE_ROW_TOKEN_PROPERTY]: 'e0000000',
					},
					2,
				)
			).arrayBuffer(),
		)
		archive.file(
			EARTHLY_SHAPEFILE_METADATA_FILE,
			JSON.stringify({
				schemaVersion: 1,
				collection: {},
				rows: [{ token: 'e0000000', id: 'single-source-row' }],
			}),
		)
		const blob = await archive.generateAsync({ type: 'blob', compression: 'STORE' })

		await expect(
			importShapefile(new File([blob], 'duplicate-token.zip', { type: 'application/zip' })),
		).rejects.toThrow('aborted to avoid losing source and license information')
	})
})
