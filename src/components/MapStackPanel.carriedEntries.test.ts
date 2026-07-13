/**
 * Carrier-nested Map Stack entries (`MapStackEntry.via`).
 *
 * When a Story is open, useStoryMapRefs auto-stacks its referenced datasets with
 * `via: { entityType: 'story', ... }`. The panel must render those NESTED under
 * a synthetic carrier row (the story) instead of as mystery top-level dataset
 * rows. These tests pin the pure grouping contract WITHOUT the DOM:
 *   - via-carrying entries leave the flat dataset bucket and group per carrier;
 *   - entries WITHOUT via render exactly as before (back-compat);
 *   - geo-query reconciliation wins over via (viewport results stay reconcilable);
 *   - nothing is dropped from the flat ordered render list.
 */

import { describe, expect, it } from 'bun:test'
import type { MapStackEntry, MapStackEntryVia } from '@/features/geo-editor/store'
import { bucketMapStackEntries, orderedMapStackEntries } from './MapStackPanel'

const STORY_A: MapStackEntryVia = { entityType: 'story', entityKey: 'pk:story-a', title: 'Story A' }
const STORY_B: MapStackEntryVia = { entityType: 'story', entityKey: 'pk:story-b', title: 'Story B' }

function datasetEntry(key: string, overrides: Partial<MapStackEntry> = {}): MapStackEntry {
	return {
		id: `dataset:${key}`,
		entityType: 'dataset',
		entityKey: key,
		title: key,
		source: 'manual',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 0,
		...overrides,
	}
}

describe('carrier-nested bucketing (MapStackEntry.via)', () => {
	it('groups via-carrying entries under their carrier and out of the dataset bucket', () => {
		const buckets = bucketMapStackEntries([
			datasetEntry('pk:plain'),
			datasetEntry('pk:ref-1', { source: 'story', via: STORY_A }),
			datasetEntry('pk:ref-2', { source: 'story', via: STORY_A }),
		])
		expect(buckets.datasetEntries.map((e) => e.entityKey)).toEqual(['pk:plain'])
		expect(buckets.carriedGroups).toHaveLength(1)
		expect(buckets.carriedGroups[0]?.via).toEqual(STORY_A)
		expect(buckets.carriedGroups[0]?.entries.map((e) => e.entityKey)).toEqual([
			'pk:ref-1',
			'pk:ref-2',
		])
	})

	it('keeps one group per carrier, in first-appearance order', () => {
		const buckets = bucketMapStackEntries([
			datasetEntry('pk:b1', { source: 'story', via: STORY_B }),
			datasetEntry('pk:a1', { source: 'story', via: STORY_A }),
			datasetEntry('pk:b2', { source: 'story', via: STORY_B }),
		])
		expect(buckets.carriedGroups.map((g) => g.via.title)).toEqual(['Story B', 'Story A'])
		expect(buckets.carriedGroups[0]?.entries.map((e) => e.entityKey)).toEqual(['pk:b1', 'pk:b2'])
	})

	it('entries without via render as today (back-compat: all in the dataset bucket)', () => {
		const buckets = bucketMapStackEntries([datasetEntry('pk:x'), datasetEntry('pk:y')])
		expect(buckets.carriedGroups).toHaveLength(0)
		expect(buckets.datasetEntries).toHaveLength(2)
	})

	it('geo-query reconciliation wins over via for unpinned viewport results', () => {
		const buckets = bucketMapStackEntries([
			datasetEntry('pk:found', { source: 'geo-query', via: STORY_A }),
		])
		expect(buckets.geoQueryEntries).toHaveLength(1)
		expect(buckets.carriedGroups).toHaveLength(0)
	})

	it('ordered render list keeps every entry: carriers between contexts and datasets', () => {
		const context: MapStackEntry = {
			...datasetEntry('ctx'),
			id: 'context:ctx',
			entityType: 'context',
		}
		const ordered = orderedMapStackEntries(
			bucketMapStackEntries([
				datasetEntry('pk:plain'),
				context,
				datasetEntry('pk:carried', { source: 'story', via: STORY_A }),
			]),
		)
		expect(ordered.map((e) => e.id)).toEqual([
			'context:ctx',
			'dataset:pk:carried',
			'dataset:pk:plain',
		])
	})
})
