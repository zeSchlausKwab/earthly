import { describe, expect, it } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { devUser1 } from '@/lib/fixtures'
import { computeChecksum } from '@/lib/nostr/geo-event/helpers'
import { isGroup } from '@/lib/nostr/group'
import { MAX_INLINE_DATASET_CONTENT_BYTES } from '@/lib/nostr/limits'
import { MapContextFactory } from '@/lib/nostr/map-context/factory'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { bboxFromFeatures } from '../geo/bbox'
import { geohashFromBbox } from '../geo/hash'
import { identityFromHex } from '../identities'
import {
	buildCanonicalDatasetEvent,
	buildCanonicalDatasetStub,
	buildCanonicalContextContent,
	planCanonicalDatasetContent,
	resolveCanonicalDatasetBlob,
	type CanonicalDatasetBlobUploader,
} from './canonical'

const signer = identityFromHex(devUser1.sk, 'Canonical test').signer

describe('canonical context compatibility', () => {
	it('is both a current Group and an open legacy map scope', async () => {
		const content = buildCanonicalContextContent({
			name: 'Canonical context',
			contextUse: 'taxonomy',
			validationMode: 'none',
			allowForeignAttachments: true,
		})
		const event = await MapContextFactory.create(content)
			.modifyPublicTags((tags) => [['d', 'canonical-context'], ...tags])
			.sign(signer)

		expect(content.modelVersion).toBe(MODEL_VERSION)
		expect(content.governance).toBe('open')
		expect(content.allowForeignAttachments).toBe(true)
		expect(isGroup(event)).toBe(true)
	})

	it('maps a closed legacy scope to closed Group governance', () => {
		expect(
			buildCanonicalContextContent({
				name: 'Closed context',
				contextUse: 'taxonomy',
				validationMode: 'none',
				allowForeignAttachments: false,
			}).governance,
		).toBe('closed')
	})
})

function collection(payload = 'small'): FeatureCollection & Record<string, unknown> {
	return {
		type: 'FeatureCollection',
		name: 'Test collection',
		description: 'Metadata retained by the external stub',
		properties: { source: 'fixture' },
		features: [
			{
				type: 'Feature',
				id: 'point-1',
				geometry: { type: 'Point', coordinates: [16.37, 48.21] },
				properties: { payload },
			},
		],
	}
}

function tagValue(tags: string[][], name: string): string | undefined {
	return tags.find((tag) => tag[0] === name)?.[1]
}

describe('canonical dataset externalization planning', () => {
	it('externalizes only when UTF-8 content bytes exceed the shared inline budget', () => {
		const fc = collection('\u00e4'.repeat(MAX_INLINE_DATASET_CONTENT_BYTES / 2))
		const plan = planCanonicalDatasetContent(fc)

		expect(plan.contentBytes).toBeGreaterThan(plan.content.length)
		expect(plan.externalize).toBe(true)

		const exactBudget = planCanonicalDatasetContent(fc, plan.contentBytes)
		expect(exactBudget.externalize).toBe(false)
		expect(planCanonicalDatasetContent(fc, plan.contentBytes - 1).externalize).toBe(true)
	})

	it('dry-run computes a deterministic reference without invoking an uploader', async () => {
		const plan = planCanonicalDatasetContent(collection('x'.repeat(256)), 1)
		let uploadCalls = 0
		const uploader: CanonicalDatasetBlobUploader = async () => {
			uploadCalls += 1
			throw new Error('network seam must not be reached')
		}

		const first = await resolveCanonicalDatasetBlob(plan, {
			blossomServer: 'http://localhost:3544',
			signer,
			dryRun: true,
			uploader,
		})
		const second = await resolveCanonicalDatasetBlob(plan, {
			blossomServer: 'http://localhost:3544/',
			signer,
			dryRun: true,
			uploader,
		})

		expect(uploadCalls).toBe(0)
		expect(second).toEqual(first)
		expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
		expect(first.size).toBe(plan.contentBytes)
		expect(first.url).toBe(`http://localhost:3544/${first.sha256}`)
		expect(first.dryRun).toBe(true)
	})

	it('rejects an upload descriptor that does not match the exact planned content', async () => {
		const plan = planCanonicalDatasetContent(collection('x'.repeat(256)), 1)
		await expect(
			resolveCanonicalDatasetBlob(plan, {
				blossomServer: 'https://blossom.example',
				signer,
				dryRun: false,
				uploader: async () => ({
					sha256: '0'.repeat(64),
					url: 'https://blossom.example/wrong',
					size: plan.contentBytes,
				}),
			}),
		).rejects.toThrow(/checksum mismatch/)
	})
})

describe('canonical external dataset event', () => {
	it('publishes a small stub while preserving discovery tags and split integrity metadata', async () => {
		const fc = collection('x'.repeat(MAX_INLINE_DATASET_CONTENT_BYTES))
		const plan = planCanonicalDatasetContent(fc)
		const blob = await resolveCanonicalDatasetBlob(plan, {
			blossomServer: 'https://blossom.example',
			signer,
			dryRun: true,
		})
		const event = await buildCanonicalDatasetEvent({
			signer,
			datasetId: 'canonical-test-id',
			featureCollection: fc,
			hashtags: ['canonical', 'fixture'],
			contextCoordinate: `37518:${'f'.repeat(64)}:test-context`,
			relayUrl: 'ws://localhost:3334',
			blob,
		})

		const stub = buildCanonicalDatasetStub(fc, blob.url)
		expect(JSON.parse(event.content)).toEqual(stub)
		expect(new TextEncoder().encode(event.content).length).toBeLessThan(
			MAX_INLINE_DATASET_CONTENT_BYTES,
		)
		expect(tagValue(event.tags, 'd')).toBe('canonical-test-id')
		expect(tagValue(event.tags, 'bbox')).toBe(bboxFromFeatures(fc.features).join(','))
		expect(tagValue(event.tags, 'g')).toBe(geohashFromBbox(bboxFromFeatures(fc.features)))
		expect(event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1])).toEqual([
			'canonical',
			'fixture',
		])
		expect(tagValue(event.tags, 'c')).toBe(`37518:${'f'.repeat(64)}:test-context`)
		expect(tagValue(event.tags, 'r')).toBe('ws://localhost:3334')
		expect(event.tags.find((tag) => tag[0] === 'blob')).toEqual([
			'blob',
			'collection',
			blob.url,
			`sha256=${blob.sha256}`,
			`size=${plan.contentBytes}`,
			'mime=application/geo+json',
		])

		const stubBytes = new TextEncoder().encode(event.content).length
		expect(tagValue(event.tags, 'size')).toBe(String(stubBytes))
		expect(tagValue(event.tags, 'checksum')).toBe(await computeChecksum(event.content))
		expect(tagValue(event.tags, 'checksum')).not.toBe(blob.sha256)
	})
})
