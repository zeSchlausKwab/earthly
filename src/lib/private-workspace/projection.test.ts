import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { createPrivateEnvelope } from './envelope'
import {
	privateWorkspaceIdForDataset,
	projectPrivateWorkspaceComments,
	projectPrivateWorkspaceDatasets,
} from './projection'
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
		expect((datasets[0]?.featureCollection as { name?: string }).name).toBe('Current')
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
})
