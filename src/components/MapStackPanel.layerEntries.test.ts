/**
 * Phase 13 (D-05 / SPEC §3.4): MapStackPanel aggregate-layer + individual-entry
 * bucketing/ordering.
 *
 * These pin the pure ordering contract WITHOUT the DOM:
 *   - aggregate `sighting-layer` / `beacon-layer` entries pin to the TOP, above
 *     every individual dataset/context entry (D-05 top-pin);
 *   - an individual `sighting`/`beacon` entry buckets into a rendered group (it is
 *     NOT silently dropped) and carries a non-empty label/icon (no `unknown`
 *     fallthrough for any of the four new entity types).
 *
 * The panel's render body maps `orderedMapStackEntries(bucketMapStackEntries(...))`
 * onto React groups, so asserting the pure order == asserting the visual order.
 */

import { describe, expect, it } from 'bun:test'
import type { MapStackEntry, MapStackEntryType } from '@/features/geo-editor/store'
import {
	bucketMapStackEntries,
	entityTypeLabel,
	entryTypeMetaLabel,
	orderedMapStackEntries,
} from './MapStackPanel'

function entry(entityType: MapStackEntryType, title = ''): MapStackEntry {
	return {
		id: `${entityType}:${entityType}-${title || 'k'}`,
		entityType,
		entityKey: entityType === 'sighting-layer' || entityType === 'beacon-layer' ? 'all' : 'k',
		title,
		source: 'manual',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 0,
	}
}

describe('MapStackPanel bucketing / ordering (D-05)', () => {
	it('pins aggregate sighting-layer + beacon-layer entries ABOVE dataset/context entries', () => {
		// Insertion order deliberately interleaves the aggregate layers AFTER the
		// dataset/context entries so a naive insertion-order render would put them
		// last. The top-pin must reorder them to the front.
		const mixed = [
			entry('dataset', 'ds'),
			entry('context', 'ctx'),
			entry('sighting-layer'),
			entry('beacon-layer'),
		]
		const ordered = orderedMapStackEntries(bucketMapStackEntries(mixed))
		const types = ordered.map((e) => e.entityType)

		const sightingLayerIdx = types.indexOf('sighting-layer')
		const beaconLayerIdx = types.indexOf('beacon-layer')
		const datasetIdx = types.indexOf('dataset')
		const contextIdx = types.indexOf('context')

		expect(sightingLayerIdx).toBeGreaterThanOrEqual(0)
		expect(beaconLayerIdx).toBeGreaterThanOrEqual(0)
		// Both aggregate layers render before BOTH the dataset and context entries.
		expect(sightingLayerIdx).toBeLessThan(datasetIdx)
		expect(sightingLayerIdx).toBeLessThan(contextIdx)
		expect(beaconLayerIdx).toBeLessThan(datasetIdx)
		expect(beaconLayerIdx).toBeLessThan(contextIdx)
	})

	it('buckets an individual sighting/beacon entry into otherEntries (not dropped)', () => {
		const buckets = bucketMapStackEntries([
			entry('sighting', 'A sighting'),
			entry('beacon', 'A beacon'),
			entry('dataset', 'ds'),
		])
		const otherKeys = buckets.otherEntries.map((e) => e.entityType)
		expect(otherKeys).toContain('sighting')
		expect(otherKeys).toContain('beacon')
		// The individual pins are NOT aggregate-layer entries.
		expect(buckets.sightingLayerEntries).toHaveLength(0)
		expect(buckets.beaconLayerEntries).toHaveLength(0)
		// Nothing lost: every input entry lands in exactly one bucket.
		const total =
			buckets.sightingLayerEntries.length +
			buckets.beaconLayerEntries.length +
			buckets.draftEntries.length +
			buckets.contextEntries.length +
			buckets.datasetEntries.length +
			buckets.otherEntries.length
		expect(total).toBe(3)
	})

	it('aggregate layers bucket separately (one each)', () => {
		const buckets = bucketMapStackEntries([entry('sighting-layer'), entry('beacon-layer')])
		expect(buckets.sightingLayerEntries).toHaveLength(1)
		expect(buckets.beaconLayerEntries).toHaveLength(1)
	})

	it('every new entity type carries a non-empty label (no unknown fallthrough)', () => {
		for (const t of ['sighting', 'beacon', 'sighting-layer', 'beacon-layer'] as const) {
			const label = entityTypeLabel(entry(t))
			expect(label.length).toBeGreaterThan(0)
			expect(label).not.toBe('')
			const meta = entryTypeMetaLabel(t)
			expect(meta.length).toBeGreaterThan(0)
		}
		// Aggregate layers read as their whole-layer names.
		expect(entityTypeLabel(entry('sighting-layer'))).toBe('Sightings')
		expect(entityTypeLabel(entry('beacon-layer'))).toBe('Live beacons')
		// Individual pins fall back to a friendly default when title is blank.
		expect(entityTypeLabel(entry('sighting'))).toBe('Sighting')
		expect(entityTypeLabel(entry('beacon'))).toBe('Live location')
		// ...and honor an explicit title when present.
		expect(entityTypeLabel(entry('sighting', 'Owl at dusk'))).toBe('Owl at dusk')
	})
})

describe('geo-query bucket (query-by-view)', () => {
	it('unpinned geo-query entries bucket into their own section by SOURCE', () => {
		const geoQueryDataset: MapStackEntry = {
			...entry('dataset'),
			id: 'dataset:pk:found',
			source: 'geo-query',
		}
		const buckets = bucketMapStackEntries([geoQueryDataset])
		expect(buckets.geoQueryEntries).toHaveLength(1)
		expect(buckets.datasetEntries).toHaveLength(0)
	})

	it('pinning a geo-query entry graduates it to its type bucket', () => {
		const pinned: MapStackEntry = {
			...entry('dataset'),
			id: 'dataset:pk:kept',
			source: 'geo-query',
			pinned: true,
		}
		const buckets = bucketMapStackEntries([pinned])
		expect(buckets.geoQueryEntries).toHaveLength(0)
		expect(buckets.datasetEntries).toHaveLength(1)
	})

	it('geo-query section orders below aggregate layers, above contexts/datasets', () => {
		const ordered = orderedMapStackEntries(
			bucketMapStackEntries([
				{ ...entry('dataset'), id: 'dataset:pk:manual' },
				{ ...entry('dataset'), id: 'dataset:pk:found', source: 'geo-query' },
				{ ...entry('sighting-layer'), id: 'sighting-layer:all' },
			]),
		)
		expect(ordered.map((e) => e.id)).toEqual([
			'sighting-layer:all',
			'dataset:pk:found',
			'dataset:pk:manual',
		])
	})
})
