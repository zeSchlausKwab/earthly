import { describe, expect, test } from 'bun:test'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { createPrivateEnvelope } from './envelope'
import { privateWorkspaceIdForDataset, projectPrivateWorkspaceDatasets } from './projection'
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

		expect(dataset?.datasetId).toBe('dataset-1')
		expect(dataset?.featureCollection.features).toHaveLength(1)
		expect(privateWorkspaceIdForDataset(dataset!)).toBe('workspace-1')
	})

	test('keeps the newest snapshot for a replaceable dataset coordinate', () => {
		const datasets = projectPrivateWorkspaceDatasets(
			workspace([datasetEnvelope('Old'), datasetEnvelope('Current')]),
		)

		expect(datasets).toHaveLength(1)
		expect((datasets[0]?.featureCollection as { name?: string }).name).toBe('Current')
	})
})
