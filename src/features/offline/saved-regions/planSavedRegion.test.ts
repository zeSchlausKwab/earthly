import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import type { MapLayerState } from '@/features/geo-editor/store'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { SyncedNostrEvent } from '@/platform/contracts'
import { planSavedRegion } from './planSavedRegion'

const datasetSecretKey = generateSecretKey()

function signedDataset(tags: string[][], createdAt = 1_700_000_000): SyncedNostrEvent {
	return finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: createdAt,
			content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			tags: [['d', `dataset-${createdAt}`], ['bbox', '1,41,2,42'], ...tags],
		},
		datasetSecretKey,
	)
}

const layer: MapLayerState = {
	id: 'world',
	title: 'World',
	kind: 'chunked-vector',
	enabled: true,
	opacity: 1,
	blossomServers: ['https://one.example', 'https://two.example/'],
	signedBlossomServers: ['https://one.example', 'https://two.example/'],
	announcement: {
		u: { bbox: [0, 40, 30, 60], file: `${'a'.repeat(64)}.pmtiles`, maxZoom: 8, size: 10 },
		s: { bbox: [-30, 20, 0, 40], file: 'b'.repeat(64), maxZoom: 8 },
		z: { bbox: [100, 0, 120, 20], file: 'c'.repeat(64), maxZoom: 8, size: 30 },
	},
}

describe('planSavedRegion', () => {
	test('selects intersecting chunks and binds every mirror to its hash', () => {
		const plan = planSavedRegion({
			id: 'hike-1',
			name: 'Hike',
			bbox: [1, 41, 10, 50],
			sourcePubkey: '1'.repeat(64),
			announcementId: '2'.repeat(64),
			layer,
			events: [],
		})

		expect(plan.chunkCount).toBe(1)
		expect(plan.bytesTotal).toBe(10)
		expect(plan.unknownSizeCount).toBe(0)
		expect(plan.request.blobs[0]?.sha256).toBe('a'.repeat(64))
		expect(plan.request.blobs[0]?.mirrorUrls).toEqual([
			`https://one.example/${'a'.repeat(64)}.pmtiles`,
			`https://two.example/${'a'.repeat(64)}.pmtiles`,
		])
	})

	test('rejects basemap mirror lists above the native manifest limit', () => {
		const mirrors = Array.from({ length: 9 }, (_, index) => `https://mirror-${index}.example`)
		expect(() =>
			planSavedRegion({
				id: 'bounded-mirrors',
				name: 'Bounded mirrors',
				bbox: [1, 41, 10, 50],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer: { ...layer, blossomServers: mirrors, signedBlossomServers: mirrors },
				events: [],
			}),
		).toThrow('more than 8 mirrors')
	})

	test('rejects a basemap chunk above the native per-file limit', () => {
		expect(() =>
			planSavedRegion({
				id: 'oversized-map',
				name: 'Oversized map',
				bbox: [1, 41, 10, 50],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer: {
					...layer,
					announcement: {
						u: {
							bbox: [0, 40, 30, 60],
							file: `${'a'.repeat(64)}.pmtiles`,
							maxZoom: 8,
							size: 2 * 1024 * 1024 * 1024 + 1,
						},
					},
				},
				events: [],
			}),
		).toThrow('2 GiB')
	})

	test('rejects a generated mirror URL above the native UTF-8 bound', () => {
		expect(() =>
			planSavedRegion({
				id: 'long-mirror',
				name: 'Long mirror',
				bbox: [1, 41, 10, 50],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer: {
					...layer,
					blossomServers: [`https://maps.example/${'x'.repeat(2_000)}`],
					signedBlossomServers: [`https://maps.example/${'x'.repeat(2_000)}`],
				},
				events: [],
			}),
		).toThrow('mirror URL is too long')
	})

	test('rejects non-HTTPS signed mirrors before crossing the native boundary', () => {
		expect(() =>
			planSavedRegion({
				id: 'unsafe-mirror',
				name: 'Unsafe mirror',
				bbox: [1, 41, 10, 50],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer: { ...layer, signedBlossomServers: ['http://localhost:3333'] },
				events: [],
			}),
		).toThrow('safe HTTPS')
	})

	test('rejects a basemap chunk without a signed size before native download', () => {
		expect(() =>
			planSavedRegion({
				id: 'unknown-map-size',
				name: 'Unknown map size',
				bbox: [-20, 25, -10, 35],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer,
				events: [],
			}),
		).toThrow('signed download size')
	})

	test('rejects date-line wrapping instead of silently saving the wrong area', () => {
		expect(() =>
			planSavedRegion({
				id: 'wrap',
				name: 'Wrap',
				bbox: [170, -10, -170, 10],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer,
				events: [],
			}),
		).toThrow('date line')
	})

	test('appends required content blobs after map chunks and deduplicates them by hash', () => {
		const sharedHash = 'd'.repeat(64)
		const secondHash = 'e'.repeat(64)
		const newer = signedDataset(
			[
				[
					'blob',
					'collection',
					'https://z.example/shared.geojson',
					`sha256=${sharedHash}`,
					'size=20',
				],
				[
					'blob',
					'feature:trail-1',
					'https://content.example/feature.geojson',
					`sha256=${secondHash}`,
					'size=30',
				],
			],
			1_700_000_002,
		)
		const older = signedDataset(
			[
				[
					'blob',
					'collection',
					'https://a.example/shared.geojson',
					`sha256=${sharedHash}`,
					'size=20',
				],
			],
			1_700_000_001,
		)

		const plan = planSavedRegion({
			id: 'with-content',
			name: 'With content',
			bbox: [1, 41, 2, 42],
			sourcePubkey: '1'.repeat(64),
			announcementId: '2'.repeat(64),
			layer,
			events: [newer, older],
		})

		expect(plan.chunkCount).toBe(1)
		expect(plan.bytesTotal).toBe(60)
		expect(plan.unknownSizeCount).toBe(0)
		expect(
			plan.request.blobs.map(({ role, sha256, ordinal }) => ({ role, sha256, ordinal })),
		).toEqual([
			{ role: 'basemap', sha256: 'a'.repeat(64), ordinal: 0 },
			{ role: 'content', sha256: sharedHash, ordinal: 1 },
			{ role: 'content', sha256: secondHash, ordinal: 2 },
		])
		expect(plan.request.blobs[1]).toMatchObject({
			required: true,
			expectedSize: 20,
			mirrorUrls: ['https://a.example/shared.geojson', 'https://z.example/shared.geojson'],
		})
	})

	test('fails closed when selected geometry cannot be integrity-checked or downloaded safely', () => {
		const baseInput = {
			id: 'unsafe-content',
			name: 'Unsafe content',
			bbox: [1, 41, 2, 42] as [number, number, number, number],
			sourcePubkey: '1'.repeat(64),
			announcementId: '2'.repeat(64),
			layer,
		}
		expect(() =>
			planSavedRegion({
				...baseInput,
				events: [signedDataset([['blob', 'collection', 'https://content.example/data.geojson']])],
			}),
		).toThrow('lowercase SHA-256')
		expect(() =>
			planSavedRegion({
				...baseInput,
				events: [
					signedDataset([
						[
							'blob',
							'collection',
							'https://content.example/data.geojson',
							`sha256=${'F'.repeat(64)}`,
						],
					]),
				],
			}),
		).toThrow('lowercase SHA-256')
		for (const unsafeUrl of [
			'http://content.example/data.geojson',
			'file:///tmp/data.geojson',
			'https://user:secret@content.example/data.geojson',
			'https://127.0.0.1/data.geojson',
			'https://[::1]/data.geojson',
			'https://field-host.local/data.geojson',
			'https://content.example/data.geojson?token=public',
			'https://content.example/data.geojson#fragment',
		]) {
			expect(() =>
				planSavedRegion({
					...baseInput,
					events: [signedDataset([['blob', 'collection', unsafeUrl, `sha256=${'f'.repeat(64)}`]])],
				}),
			).toThrow('safe HTTPS URL')
		}
		expect(() =>
			planSavedRegion({
				...baseInput,
				events: [
					signedDataset([
						[
							'blob',
							'collection',
							'https://content.example/data.geojson',
							`sha256=${'f'.repeat(64)}`,
							`size=${50 * 1024 * 1024 + 1}`,
						],
					]),
				],
			}),
		).toThrow('50 MiB')
		for (const invalidSizes of [['size=0'], ['size=oops'], ['size=10', 'size=10']]) {
			expect(() =>
				planSavedRegion({
					...baseInput,
					events: [
						signedDataset([
							[
								'blob',
								'collection',
								'https://content.example/data.geojson',
								`sha256=${'f'.repeat(64)}`,
								...invalidSizes,
							],
						]),
					],
				}),
			).toThrow('invalid size')
		}
		const conflictingHash = 'e'.repeat(64)
		expect(() =>
			planSavedRegion({
				...baseInput,
				events: [
					signedDataset([
						[
							'blob',
							'collection',
							'https://one.example/data.geojson',
							`sha256=${conflictingHash}`,
							'size=10',
						],
						[
							'blob',
							'collection',
							'https://two.example/data.geojson',
							`sha256=${conflictingHash}`,
							'size=11',
						],
					]),
				],
			}),
		).toThrow('disagree on the signed size')
	})

	test('counts content references against the shared native blob ceiling', () => {
		const fullAnnouncement = Object.fromEntries(
			Array.from({ length: 2_048 }, (_, index) => [
				`chunk-${index}`,
				{
					bbox: [0, 0, 1, 1] as [number, number, number, number],
					file: index.toString(16).padStart(64, '0'),
					maxZoom: 8,
					size: 1,
				},
			]),
		)
		const fullLayer: MapLayerState = { ...layer, announcement: fullAnnouncement }
		expect(() =>
			planSavedRegion({
				id: 'too-many',
				name: 'Too many',
				bbox: [0, 0, 1, 1],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer: fullLayer,
				events: [
					signedDataset([
						[
							'blob',
							'collection',
							'https://content.example/data.geojson',
							`sha256=${'f'.repeat(64)}`,
						],
					]),
				],
			}),
		).toThrow('more than 2048 offline files')
	})
})
