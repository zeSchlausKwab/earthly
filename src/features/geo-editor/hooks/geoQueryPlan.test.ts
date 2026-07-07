import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import type { MapStackEntry } from '../store/types'
import { geoQueryEntryId, planGeoQueryEntry, planGeoQueryReconciliation } from './geoQueryPlan'

const NOW = 1_780_000_000

const base = {
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	created_at: NOW - 100,
	sig: '',
}

function stackEntry(partial: Partial<MapStackEntry> & Pick<MapStackEntry, 'id'>): MapStackEntry {
	return {
		entityType: 'dataset',
		entityKey: partial.id.split(':').slice(1).join(':'),
		title: partial.id,
		source: 'geo-query',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 0,
		...partial,
	} as MapStackEntry
}

describe('planGeoQueryEntry', () => {
	test('dataset maps to pubkey:d key (getDatasetKey convention)', () => {
		const event: NostrEvent = {
			...base,
			kind: 37515,
			content: JSON.stringify({ type: 'FeatureCollection', name: 'Vienna Parks', features: [] }),
			tags: [['d', 'parks1']],
		}
		const plan = planGeoQueryEntry(event, NOW)
		expect(plan).toEqual({
			entityType: 'dataset',
			entityKey: `${'b'.repeat(64)}:parks1`,
			title: 'Vienna Parks',
		})
	})

	test('sighting maps to naddr key and gates on modelVersion', () => {
		const event: NostrEvent = {
			...base,
			kind: 37522,
			content: JSON.stringify({ modelVersion: 'earthly/2', title: 'Heron' }),
			tags: [['d', 's1']],
		}
		const plan = planGeoQueryEntry(event, NOW)
		expect(plan?.entityType).toBe('sighting')
		expect(plan?.entityKey).toStartWith('naddr1')
		expect(plan?.title).toBe('Heron')

		const legacy: NostrEvent = { ...event, content: JSON.stringify({ title: 'Old' }) }
		expect(planGeoQueryEntry(legacy, NOW)).toBeNull()
	})

	test('expired events and ended beacons are rejected', () => {
		const expired: NostrEvent = {
			...base,
			kind: 37522,
			content: JSON.stringify({ modelVersion: 'earthly/2', title: 'Old news' }),
			tags: [
				['d', 's2'],
				['expiration', String(NOW - 10)],
			],
		}
		expect(planGeoQueryEntry(expired, NOW)).toBeNull()

		const ended: NostrEvent = {
			...base,
			kind: 37521,
			content: JSON.stringify({ modelVersion: 'earthly/2', label: 'Walk', status: 'ended' }),
			tags: [['d', 'b1']],
		}
		expect(planGeoQueryEntry(ended, NOW)).toBeNull()
	})

	test('unknown kinds and missing d tags are rejected', () => {
		const noD: NostrEvent = { ...base, kind: 37515, content: '{}', tags: [] }
		expect(planGeoQueryEntry(noD, NOW)).toBeNull()

		const story: NostrEvent = {
			...base,
			kind: 37520,
			content: JSON.stringify({ modelVersion: 'earthly/2', title: 'A story' }),
			tags: [['d', 'st1']],
		}
		expect(planGeoQueryEntry(story, NOW)).toBeNull()
	})
})

describe('planGeoQueryReconciliation', () => {
	const freshA = { entityType: 'dataset' as const, entityKey: 'pk:a', title: 'A' }
	const freshB = { entityType: 'sighting' as const, entityKey: 'naddr1b', title: 'B' }

	test('adds new results, removes stale unpinned geo-query entries', () => {
		const current = {
			[geoQueryEntryId(freshA)]: stackEntry({ id: geoQueryEntryId(freshA) }),
			'dataset:pk:gone': stackEntry({ id: 'dataset:pk:gone' }),
		}
		const { toAdd, toRemove } = planGeoQueryReconciliation(current, [freshA, freshB])
		expect(toAdd).toEqual([freshB])
		expect(toRemove).toEqual(['dataset:pk:gone'])
	})

	test('pinned geo-query entries survive leaving the viewport', () => {
		const current = {
			'dataset:pk:kept': stackEntry({ id: 'dataset:pk:kept', pinned: true }),
		}
		const { toRemove } = planGeoQueryReconciliation(current, [])
		expect(toRemove).toEqual([])
	})

	test('never touches entries from other sources', () => {
		const current = {
			'dataset:pk:manual': stackEntry({ id: 'dataset:pk:manual', source: 'manual' }),
		}
		const { toAdd, toRemove } = planGeoQueryReconciliation(current, [])
		expect(toRemove).toEqual([])
		expect(toAdd).toEqual([])
	})

	test('never re-adds an existing id (would reset user visible/pin toggles)', () => {
		const current = {
			[geoQueryEntryId(freshA)]: stackEntry({
				id: geoQueryEntryId(freshA),
				visible: false, // user hid it — a re-add would flip it back on
			}),
		}
		const { toAdd } = planGeoQueryReconciliation(current, [freshA])
		expect(toAdd).toEqual([])
	})
})
