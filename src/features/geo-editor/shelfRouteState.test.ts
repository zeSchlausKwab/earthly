import { describe, expect, test } from 'bun:test'
import type { MapPresentationSource } from '@/lib/map-presentation'
import type { MapStackEntry } from './store/types'
import {
	applyShelfRouteIntentToSearch,
	convertLegacyShelfSearch,
	createPublicShelfMap,
	deriveShelfRouteIntent,
	planShelfRouteReconciliation,
	resolveShelfRouteIntent,
	SHELF_ROUTE_BEACON_LAYER_ID,
	SHELF_ROUTE_SIGHTING_LAYER_ID,
	shelfRouteDatasetEntryId,
	type PublicShelfMap,
} from './shelfRouteState'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)
const SOURCE_A = `37515:${PUBKEY_A}:alpha` as MapPresentationSource
const SOURCE_B = `37515:${PUBKEY_B}:bravo` as MapPresentationSource

const maps: readonly PublicShelfMap[] = [
	{ source: SOURCE_A, datasetKey: `${PUBKEY_A}:alpha`, title: 'Alpha' },
	{ source: SOURCE_B, datasetKey: `${PUBKEY_B}:bravo`, title: 'Bravo' },
]

function entry(overrides: Partial<MapStackEntry> = {}): MapStackEntry {
	return {
		id: `dataset:${PUBKEY_A}:alpha`,
		entityType: 'dataset',
		entityKey: `${PUBKEY_A}:alpha`,
		title: 'Alpha',
		source: 'manual',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 1,
		...overrides,
	}
}

function record(entries: readonly MapStackEntry[]): Record<string, MapStackEntry> {
	return Object.fromEntries(entries.map((item) => [item.id, item]))
}

describe('canonical Shelf route conversion', () => {
	test('creates only exact kind-37515 public map sources', () => {
		expect(
			createPublicShelfMap({
				kind: 37515,
				pubkey: PUBKEY_A.toUpperCase(),
				identifier: 'alpha',
				datasetKey: `${PUBKEY_A}:alpha`,
				title: 'Alpha',
			}),
		).toEqual({ source: SOURCE_A, datasetKey: `${PUBKEY_A}:alpha`, title: 'Alpha' })
		expect(
			createPublicShelfMap({
				kind: 30000,
				pubkey: PUBKEY_A,
				identifier: 'alpha',
				datasetKey: 'bad',
				title: 'Bad',
			}),
		).toBeNull()
	})

	test('resolves exact and unambiguous legacy on entries without guessing', () => {
		const exactMissing = `37515:${'c'.repeat(64)}:later` as MapPresentationSource
		const resolved = resolveShelfRouteIntent(
			[SOURCE_A, 'bravo', exactMissing, 'missing'],
			maps,
			true,
		)
		expect(resolved.sources).toEqual([SOURCE_A, SOURCE_B, exactMissing])
		expect(resolved.unresolvedSources).toEqual([exactMissing])
		expect(resolved.hasLegacyTokens).toBe(true)
		expect(resolved.hasUnresolvedLegacyTokens).toBe(true)
		expect(resolved.live).toBe(true)
	})

	test('flattens old dataset/context/isolation/exclusions and aggregate Live state', () => {
		const expanded: Array<[string, readonly string[]]> = []
		const converted = convertLegacyShelfSearch(
			`?ms=context:atlas,dataset:${PUBKEY_B}:bravo,sighting-layer:all&iso=context:atlas&ex=atlas|${PUBKEY_B}:bravo`,
			maps,
			(key, exclusions) => {
				expanded.push([key, exclusions])
				return [SOURCE_A]
			},
		)
		expect(converted.sources).toEqual([SOURCE_A])
		expect(converted.live).toBe(false)
		expect(converted.needsContextCatalog).toBe(true)
		expect(expanded).toEqual([['atlas', [`${PUBKEY_B}:bravo`]]])

		expect(
			convertLegacyShelfSearch('?ms=sighting:one,beacon:two,beacon-layer:all', maps).live,
		).toBe(true)
	})
})

describe('Shelf route reconciliation', () => {
	test('owns only missing route rows and preserves manual/story/draft/private rows', () => {
		const manual = entry()
		const story = entry({
			id: `story:${PUBKEY_B}:bravo`,
			entityKey: `${PUBKEY_B}:bravo`,
			source: 'story',
		})
		const draft = entry({ id: 'draft:active', entityType: 'draft', source: 'workspace' })
		const privateMap = entry({ id: 'private:a', source: 'private-group' })
		const entries = record([manual, story, draft, privateMap])
		const plan = planShelfRouteReconciliation(
			{ sources: [SOURCE_A, SOURCE_B], live: true },
			maps,
			entries,
		)
		expect(plan.upsertEntries.map((item) => item.id)).toEqual([
			shelfRouteDatasetEntryId(SOURCE_B),
			SHELF_ROUTE_SIGHTING_LAYER_ID,
			SHELF_ROUTE_BEACON_LAYER_ID,
		])
		expect(plan.removeEntryIds).toEqual([])
		expect(plan.orderedOwnedEntryIds).toEqual([
			shelfRouteDatasetEntryId(SOURCE_B),
			SHELF_ROUTE_SIGHTING_LAYER_ID,
			SHELF_ROUTE_BEACON_LAYER_ID,
		])
		expect(Object.keys(entries)).toHaveLength(4)
	})

	test('removes obsolete adapter rows only', () => {
		const ownedA = entry({ id: shelfRouteDatasetEntryId(SOURCE_A), source: 'route' })
		const manual = entry({ id: 'manual:a' })
		const entries = record([ownedA, manual])
		const plan = planShelfRouteReconciliation({ sources: [], live: false }, maps, entries)
		expect(plan.removeEntryIds).toEqual([ownedA.id])
		expect(entries['manual:a']).toBe(manual)
	})

	test('is idempotent for an already materialized route source', () => {
		const owned = entry({ id: shelfRouteDatasetEntryId(SOURCE_A), source: 'route' })
		const plan = planShelfRouteReconciliation(
			{ sources: [SOURCE_A], live: false },
			maps,
			record([owned]),
		)
		expect(plan).toEqual({
			removeEntryIds: [],
			upsertEntries: [],
			orderedOwnedEntryIds: [owned.id],
		})
	})

	test('materializes an exact source incrementally when its public event arrives', () => {
		const missing = `37515:${'c'.repeat(64)}:later` as MapPresentationSource
		expect(
			planShelfRouteReconciliation({ sources: [missing], live: false }, maps, {}).upsertEntries,
		).toEqual([])
		const later: PublicShelfMap = {
			source: missing,
			datasetKey: `${'c'.repeat(64)}:later`,
			title: 'Later',
		}
		expect(
			planShelfRouteReconciliation({ sources: [missing], live: false }, [...maps, later], {})
				.upsertEntries[0],
		).toMatchObject({ id: shelfRouteDatasetEntryId(missing), entityKey: later.datasetKey })
	})
})

describe('Shelf route writeback', () => {
	test('preserves order/dedup and never widens feature selectors or private/story defaults', () => {
		const selected = entry({ id: 'selected', featureIds: ['only-me'] })
		const explicitlyEmpty = entry({ id: 'empty', featureIds: [] })
		const privateMap = entry({ id: 'private', source: 'private-group' })
		const storyMap = entry({ id: 'story', source: 'story' })
		const defaultMap = entry({ id: 'default', source: 'browse-default' })
		const bravo = entry({
			id: 'bravo',
			entityKey: `${PUBKEY_B}:bravo`,
			source: 'manual',
		})
		const alpha = entry({ id: 'alpha' })
		const live = entry({
			id: 'live-layer',
			entityType: 'sighting-layer',
			entityKey: 'all',
		})
		const individual = entry({ id: 'beacon:one', entityType: 'beacon', entityKey: 'one' })
		const entries = record([
			selected,
			explicitlyEmpty,
			privateMap,
			storyMap,
			defaultMap,
			bravo,
			alpha,
			live,
			individual,
		])
		const intent = deriveShelfRouteIntent(entries, Object.keys(entries), maps)
		expect(intent).toEqual({ sources: [SOURCE_B, SOURCE_A], live: true })
	})

	test('retains unresolved exact intent, but a hidden resolved adapter row removes it', () => {
		const missing = `37515:${'c'.repeat(64)}:later` as MapPresentationSource
		expect(deriveShelfRouteIntent({}, [], maps, [missing])).toEqual({
			sources: [missing],
			live: false,
		})
		const hidden = entry({
			id: shelfRouteDatasetEntryId(SOURCE_A),
			source: 'route',
			visible: false,
		})
		expect(deriveShelfRouteIntent(record([hidden]), [hidden.id], maps, [SOURCE_A]).sources).toEqual(
			[],
		)
	})

	test('flattens local isolation without removing adapter-owned route intent', () => {
		const alpha = entry({ id: 'alpha' })
		const bravo = entry({
			id: 'bravo',
			entityKey: `${PUBKEY_B}:bravo`,
			source: 'manual',
			isolated: true,
		})
		const ownedAlpha = entry({ id: shelfRouteDatasetEntryId(SOURCE_A), source: 'route' })
		const entries = record([alpha, bravo, ownedAlpha])
		expect(deriveShelfRouteIntent(entries, [alpha.id, bravo.id, ownedAlpha.id], maps)).toEqual({
			sources: [SOURCE_B, SOURCE_A],
			live: false,
		})
	})

	test('deletes legacy keys and preserves unrelated route state', () => {
		const params = new URLSearchParams(
			'ms=dataset:old&iso=dataset:old&ex=atlas%7Cone&in=atlas&tab=thread',
		)
		applyShelfRouteIntentToSearch(params, { sources: [SOURCE_A], live: true })
		expect(params.get('on')).toBe(SOURCE_A)
		expect(params.get('live')).toBe('1')
		expect(params.get('in')).toBe('atlas')
		expect(params.get('tab')).toBe('thread')
		expect(params.has('ms')).toBe(false)
		expect(params.has('iso')).toBe(false)
		expect(params.has('ex')).toBe(false)
	})
})
