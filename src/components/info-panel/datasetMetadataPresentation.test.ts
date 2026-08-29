import { describe, expect, test } from 'bun:test'
import { presentDatasetMetadata } from './datasetMetadataPresentation'

const MANIFEST_KEY = 'earthly:geoCatalogSourceManifest:overture-2026-08-19.0-v1'

const fullManifest = {
	schemaVersion: 1,
	snapshotId: 'overture-2026-08-19.0-v1',
	createdAt: '2026-08-28T00:00:00.000Z',
	sources: [
		{
			name: 'Overture Maps',
			release: '2026-08-19.0',
			license: 'ODbL-1.0',
			attribution: 'Overture Maps Foundation; © OpenStreetMap contributors',
			attributionUrl: 'https://docs.overturemaps.org/attribution/',
			documents: [
				{
					name: 'Open Database License 1.0',
					url: 'https://opendatacommons.org/licenses/odbl/1-0/',
					content: 'A very long license document that must not enter the inspect UI.',
				},
			],
			nativeSchema: { large: 'internal detail' },
		},
	],
	coverage: { scope: 'global' },
}

describe('presentDatasetMetadata', () => {
	test('preserves ordinary nonempty properties and their order', () => {
		const result = presentDatasetMetadata({
			theme: 'flash flood',
			eventCount: 0,
			confirmed: false,
			tags: ['Nepal', 'China'],
			emptyText: '   ',
			emptyList: [],
			emptyObject: {},
			missing: undefined,
		})

		expect(result.properties).toEqual([
			['theme', 'flash flood'],
			['eventCount', 0],
			['confirmed', false],
			['tags', ['Nepal', 'China']],
		])
		expect(result.manifests).toEqual([])
	})

	test('suppresses a JSON-string manifest and returns only allow-listed summary fields', () => {
		const result = presentDatasetMetadata({
			theme: 'flood',
			[MANIFEST_KEY]: JSON.stringify(fullManifest),
		})

		expect(result.properties).toEqual([['theme', 'flood']])
		expect(result.manifests).toEqual([
			{
				snapshotId: 'overture-2026-08-19.0-v1',
				createdAt: '2026-08-28T00:00:00.000Z',
				sources: [
					{
						name: 'Overture Maps',
						release: '2026-08-19.0',
						license: 'ODbL-1.0',
						attribution: 'Overture Maps Foundation; © OpenStreetMap contributors',
						attributionUrl: 'https://docs.overturemaps.org/attribution/',
						documents: [
							{
								name: 'Open Database License 1.0',
								url: 'https://opendatacommons.org/licenses/odbl/1-0/',
							},
						],
					},
				],
			},
		])
		expect(JSON.stringify(result)).not.toContain('A very long license')
		expect(JSON.stringify(result)).not.toContain('nativeSchema')
	})

	test('accepts object manifests and ignores malformed sources, documents, and URLs', () => {
		const result = presentDatasetMetadata({
			[MANIFEST_KEY]: {
				...fullManifest,
				sources: [
					...fullManifest.sources,
					{ name: 'Missing release' },
					'not an object',
					{
						name: 'Safe source',
						release: '1',
						attributionUrl: 'javascript:alert(1)',
						documents: [{ name: 'Missing URL' }, { name: 'Unsafe URL', url: 'file:///tmp/notice' }],
					},
				],
			},
		})

		expect(result.properties).toEqual([])
		expect(result.manifests[0]?.sources).toHaveLength(2)
		expect(result.manifests[0]?.sources[1]).toEqual({ name: 'Safe source', release: '1' })
	})

	test('suppresses malformed manifests and falls back to the snapshot id in the key', () => {
		const result = presentDatasetMetadata({
			[MANIFEST_KEY]: '{not valid json',
			'earthly:geoCatalogSourceManifest:legacy-snapshot': null,
			note: 'still visible',
		})

		expect(result.properties).toEqual([['note', 'still visible']])
		expect(result.manifests).toEqual([
			{ snapshotId: 'overture-2026-08-19.0-v1', sources: [] },
			{ snapshotId: 'legacy-snapshot', sources: [] },
		])
	})

	test('falls back to the key when a parsed manifest has no usable identity', () => {
		const result = presentDatasetMetadata({
			[MANIFEST_KEY]: {
				snapshotId: ' ',
				createdAt: 'not a date',
				sources: {},
			},
		})

		expect(result).toEqual({
			properties: [],
			manifests: [{ snapshotId: 'overture-2026-08-19.0-v1', sources: [] }],
		})
	})
})
