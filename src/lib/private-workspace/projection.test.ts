import { describe, expect, test } from 'bun:test'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { createPrivateEnvelope } from './envelope'
import {
	privateWorkspaceIdForDataset,
	projectPrivateWorkspaceComments,
	projectPrivateWorkspaceDatasets,
} from './projection'
import type { StoredWorkspace } from './storage'

function workspace(envelopes: StoredWorkspace['envelopes']): StoredWorkspace {
	return {
		workspaceId: 'workspace-1',
		groupId: 'group-1',
		ownerPubkey: 'a'.repeat(64),
		adminPubkey: 'a'.repeat(64),
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
		pubkey: 'a'.repeat(64),
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
	test('adapts decrypted datasets for the existing map pipeline', () => {
		const [dataset] = projectPrivateWorkspaceDatasets(workspace([datasetEnvelope('Trailhead')]))

		expect(dataset).toBeDefined()
		expect(dataset?.datasetId).toBe('dataset-1')
		expect(dataset?.featureCollection.features).toHaveLength(1)
		if (!dataset) throw new Error('Expected the private dataset projection')
		expect(privateWorkspaceIdForDataset(dataset)).toBe('workspace-1')
	})

	test('keeps the newest snapshot for a replaceable dataset coordinate', () => {
		const datasets = projectPrivateWorkspaceDatasets(
			workspace([datasetEnvelope('Old'), datasetEnvelope('Current')]),
		)

		expect(datasets).toHaveLength(1)
		expect((datasets[0]?.featureCollection as { name?: string }).name).toBe('Current')
	})
})

describe('projectPrivateWorkspaceComments', () => {
	test('keeps geometry optional for ordinary private comments', () => {
		const comment = createPrivateEnvelope({
			pubkey: 'a'.repeat(64),
			kind: GEO_COMMENT_KIND,
			tags: [['d', 'comment-1']],
			content: JSON.stringify({ text: 'Text only' }),
		})

		const [projected] = projectPrivateWorkspaceComments(workspace([comment]))

		expect(projected?.text).toBe('Text only')
		expect(projected?.geojson).toBeUndefined()
	})

	test('keeps optional GeoJSON attachments on encrypted comments', () => {
		const comment = createPrivateEnvelope({
			pubkey: 'a'.repeat(64),
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

	test('ignores standalone datasets in the comment projection', () => {
		expect(projectPrivateWorkspaceComments(workspace([datasetEnvelope('Trailhead')]))).toEqual([])
	})
})
