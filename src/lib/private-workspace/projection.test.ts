import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { createPrivateEnvelope } from './envelope'
import {
	privateEpochForRecord,
	privateMediaAttachmentsForComment,
	privateMediaAttachmentsForDataset,
	privateWorkspaceIdForDataset,
	projectPrivateWorkspaceComments,
	projectPrivateWorkspaceDatasets,
} from './projection'
import {
	buildEncryptedMediaImetaTag,
	CORDN_ENCRYPTED_MEDIA_VERSION,
	EARTHLY_PERSISTENT_MEDIA_VERSION,
} from './media'
import type { StoredWorkspace } from './storage'

const testSecretKey = generateSecretKey()
const testPubkey = getPublicKey(testSecretKey)
const testSigner = {
	signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
		finalizeEvent(event, testSecretKey),
}
const testGroupId = 'group-1'

function workspace(envelopes: StoredWorkspace['envelopes']): StoredWorkspace {
	return {
		workspaceId: 'workspace-1',
		groupId: 'group-1',
		ownerPubkey: testPubkey,
		adminPubkey: testPubkey,
		coordinatorPubkey: 'b'.repeat(64),
		relays: ['ws://localhost:3334'],
		role: 'administrator',
		status: 'active',
		stateBase64: '',
		cursor: envelopes.length,
		envelopes,
		createdAt: 1,
	}
}

function datasetEnvelope(name: string, datasetId = 'dataset-1') {
	return createPrivateEnvelope({
		signer: testSigner,
		groupId: testGroupId,
		pubkey: testPubkey,
		kind: GEO_EVENT_KIND,
		tags: [['d', datasetId]],
		content: JSON.stringify({
			type: 'FeatureCollection',
			name,
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [16.3725, 48.2089] },
					properties: { name },
				},
			],
		}),
	})
}

describe('projectPrivateWorkspaceDatasets', () => {
	test('adapts decrypted datasets for the existing map pipeline', async () => {
		const [dataset] = projectPrivateWorkspaceDatasets(
			workspace([await datasetEnvelope('Trailhead')]),
		)

		expect(dataset).toBeDefined()
		expect(dataset?.datasetId).toBe('dataset-1')
		expect(dataset?.featureCollection.features).toHaveLength(1)
		if (!dataset) throw new Error('Expected the private dataset projection')
		expect(privateWorkspaceIdForDataset(dataset)).toBe('workspace-1')
	})

	test('keeps the newest snapshot for a replaceable dataset coordinate', async () => {
		const datasets = projectPrivateWorkspaceDatasets(
			workspace([await datasetEnvelope('Old'), await datasetEnvelope('Current')]),
		)

		expect(datasets).toHaveLength(1)
		expect((datasets[0]?.featureCollection as { name?: string } | undefined)?.name).toBe('Current')
	})
})

describe('projectPrivateWorkspaceComments', () => {
	test('keeps geometry optional for ordinary private comments', async () => {
		const comment = await createPrivateEnvelope({
			signer: testSigner,
			groupId: testGroupId,
			pubkey: testPubkey,
			kind: GEO_COMMENT_KIND,
			tags: [['d', 'comment-1']],
			content: JSON.stringify({ text: 'Text only' }),
		})

		const [projected] = projectPrivateWorkspaceComments(workspace([comment]))

		expect(projected?.text).toBe('Text only')
		expect(projected?.geojson).toBeUndefined()
	})

	test('keeps optional GeoJSON attachments on encrypted comments', async () => {
		const comment = await createPrivateEnvelope({
			signer: testSigner,
			groupId: testGroupId,
			pubkey: testPubkey,
			kind: GEO_COMMENT_KIND,
			tags: [['d', 'comment-1']],
			content: JSON.stringify({
				text: 'Check this crossing',
				geojson: {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							geometry: { type: 'Point', coordinates: [16.37, 48.2] },
							properties: {},
						},
					],
				},
			}),
		})

		const [projected] = projectPrivateWorkspaceComments(workspace([comment]))

		expect(projected?.text).toBe('Check this crossing')
		expect(projected?.geojson?.features).toHaveLength(1)
	})

	test('ignores standalone datasets in the comment projection', async () => {
		expect(
			projectPrivateWorkspaceComments(workspace([await datasetEnvelope('Trailhead')])),
		).toEqual([])
	})

	test('projects parsed cordn-em-v1 and earthly-pm-v1 mediaAttachments with envelope epochs', async () => {
		const commentImeta = buildEncryptedMediaImetaTag({
			url: 'https://blossom.earthly.city/photo1',
			mime: 'image/jpeg',
			filename: 'abc123.jpg',
			x: '11'.repeat(32),
			n: '22'.repeat(12),
			v: CORDN_ENCRYPTED_MEDIA_VERSION,
			dim: '800x600',
			alt: 'Camp view',
		})
		const datasetImeta = buildEncryptedMediaImetaTag({
			url: 'https://blossom.earthly.city/mapphoto',
			mime: 'image/webp',
			filename: 'def456.webp',
			x: '33'.repeat(32),
			n: '44'.repeat(12),
			v: EARTHLY_PERSISTENT_MEDIA_VERSION,
			k: '55'.repeat(32),
		})

		const comment = await createPrivateEnvelope({
			signer: testSigner,
			groupId: testGroupId,
			pubkey: testPubkey,
			kind: GEO_COMMENT_KIND,
			tags: [['d', 'comment-media'], commentImeta],
			content: JSON.stringify({ text: 'See photo' }),
		})
		const dataset = await createPrivateEnvelope({
			signer: testSigner,
			groupId: testGroupId,
			pubkey: testPubkey,
			kind: GEO_EVENT_KIND,
			tags: [['d', 'dataset-media'], ['name', 'Survey'], datasetImeta],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: 'Survey',
				features: [],
			}),
		})

		const ws = workspace([comment, dataset])
		ws.envelopeEpochs = { [comment.id]: 3, [dataset.id]: 1 }

		const [projectedComment] = projectPrivateWorkspaceComments(ws)
		if (!projectedComment) throw new Error('Expected projected comment')
		expect(projectedComment.mediaAttachments).toHaveLength(1)
		expect(projectedComment.mediaAttachments[0]?.v).toBe(CORDN_ENCRYPTED_MEDIA_VERSION)
		expect(projectedComment.mediaAttachments[0]?.epoch).toBe(3)
		expect(privateMediaAttachmentsForComment(projectedComment)).toEqual(
			projectedComment.mediaAttachments,
		)
		expect(privateEpochForRecord(projectedComment)).toBe(3)

		const [projectedDataset] = projectPrivateWorkspaceDatasets(ws)
		if (!projectedDataset) throw new Error('Expected projected dataset')
		expect(projectedDataset.mediaAttachments).toHaveLength(1)
		expect(projectedDataset.mediaAttachments[0]?.v).toBe(EARTHLY_PERSISTENT_MEDIA_VERSION)
		expect(projectedDataset.mediaAttachments[0]?.k).toBe('55'.repeat(32))
		expect(privateMediaAttachmentsForDataset(projectedDataset)).toEqual(
			projectedDataset.mediaAttachments,
		)
	})
})
