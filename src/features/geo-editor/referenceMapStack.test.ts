import { describe, expect, it } from 'bun:test'
import type { MapStackEntry } from './store'
import { datasetReferenceEntryId, deriveReferenceMapRenderState } from './referenceMapStack'

function entry(overrides: Partial<MapStackEntry>): MapStackEntry {
	return {
		id: 'dataset:owner:data',
		entityType: 'dataset',
		entityKey: 'owner:data',
		title: 'Data',
		source: 'story',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 1,
		...overrides,
	}
}

describe('fine-grained reference map stack', () => {
	it('creates stable entry ids for OSM-style feature ids', () => {
		expect(datasetReferenceEntryId('owner:data', 'relation/62504')).toBe(
			'dataset:owner:data#relation%2F62504',
		)
	})

	it('unions feature selectors from multiple visible references', () => {
		const state = deriveReferenceMapRenderState([
			entry({ id: 'one', featureIds: ['checkpoint-alpha'] }),
			entry({ id: 'two', featureIds: ['relation/62504'] }),
		])
		expect(state.datasetFeatureSelectors['owner:data']).toEqual([
			'checkpoint-alpha',
			'relation/62504',
		])
	})

	it('a whole-dataset entry overrides feature-only selectors', () => {
		const state = deriveReferenceMapRenderState([
			entry({ id: 'one', featureIds: ['checkpoint-alpha'] }),
			entry({ id: 'whole', featureIds: undefined }),
		])
		expect(state.datasetFeatureSelectors['owner:data']).toBeNull()
	})

	it('derives a single coordinate pin and honors isolation', () => {
		const coordinate = entry({
			id: 'coordinate:berlin',
			entityType: 'coordinate',
			entityKey: 'geo:52.516275,13.377704',
			title: '52.516275, 13.377704',
			isolated: true,
		})
		const state = deriveReferenceMapRenderState([
			entry({ featureIds: ['checkpoint-alpha'] }),
			coordinate,
		])
		expect(state.datasetFeatureSelectors).toEqual({})
		expect(state.coordinates[0]).toMatchObject({ latitude: 52.516275, longitude: 13.377704 })
	})
})
