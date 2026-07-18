import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { eventStore, ingestDeletionEvent, isEventDeleted } from '@/lib/nostr'
import { deletionTargetForEvent } from '@/lib/nostr/deletionCache'
import type { SavedRegion, SavedRegionService } from '@/platform/contracts'
import { hydrateSavedRegionEvents } from './useSavedRegionHydration'

const region = {
	id: 'offline-hike',
	announcementId: 'a'.repeat(64),
} as unknown as SavedRegion

describe('saved-region event hydration', () => {
	test('loads exact native-manifest events into the shared store and reports missing ids', async () => {
		const event = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_000,
				tags: [['d', 'offline-dataset']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			generateSecretKey(),
		)
		const service = {
			supported: true,
			list: async () => [region],
			events: async () => ({
				regionId: region.id,
				expectedEvents: 2,
				cursor: 0,
				nextCursor: null,
				events: [event],
				missingEventIds: ['b'.repeat(64)],
			}),
		} as unknown as SavedRegionService

		try {
			expect(await hydrateSavedRegionEvents(service)).toEqual({
				state: 'ready',
				regions: 1,
				events: 1,
				missing: 1,
				authors: [event.pubkey],
				deletionTargets: [deletionTargetForEvent(event)],
				incompleteRegionIds: [region.id],
				deferredRegionIds: [],
				regionDeletionTargets: { [region.id]: [deletionTargetForEvent(event)] },
			})
			expect(eventStore.getEvent(event.id)?.id).toBe(event.id)
		} finally {
			eventStore.remove(event.id)
		}
	})

	test('keeps the browser adapter truthful', async () => {
		expect(
			await hydrateSavedRegionEvents({ supported: false } as unknown as SavedRegionService),
		).toEqual({ state: 'unsupported' })
	})

	test('hydrates bounded pages and deduplicates overlapping region events', async () => {
		const event = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_001,
				tags: [['d', 'shared-offline-dataset']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			generateSecretKey(),
		)
		const secondRegion = { ...region, id: 'second-offline-hike' }
		const calls: Array<[string, number | undefined]> = []
		const service = {
			supported: true,
			list: async () => [region, secondRegion],
			events: async (id: string, cursor?: number) => {
				calls.push([id, cursor])
				if (id === region.id && cursor === 0) {
					return {
						regionId: id,
						expectedEvents: 2,
						cursor: 0,
						nextCursor: 1,
						events: [event],
						missingEventIds: [],
					}
				}
				if (id === region.id) {
					return {
						regionId: id,
						expectedEvents: 2,
						cursor: 1,
						nextCursor: null,
						events: [],
						missingEventIds: ['c'.repeat(64)],
					}
				}
				return {
					regionId: id,
					expectedEvents: 1,
					cursor: 0,
					nextCursor: null,
					events: [event],
					missingEventIds: [],
				}
			},
		} as unknown as SavedRegionService

		try {
			expect(await hydrateSavedRegionEvents(service)).toEqual({
				state: 'ready',
				regions: 2,
				events: 1,
				missing: 1,
				authors: [event.pubkey],
				deletionTargets: [deletionTargetForEvent(event)],
				incompleteRegionIds: [region.id],
				deferredRegionIds: [],
				regionDeletionTargets: {
					[region.id]: [deletionTargetForEvent(event)],
					[secondRegion.id]: [deletionTargetForEvent(event)],
				},
			})
			expect(calls).toEqual([
				[region.id, 0],
				[region.id, 1],
				[secondRegion.id, 0],
			])
		} finally {
			eventStore.remove(event.id)
		}
	})

	test('restores cached tombstones before adding a saved page and does not count a rejected event', async () => {
		const secretKey = generateSecretKey()
		const event = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_010,
				tags: [['d', 'deleted-offline-dataset']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			secretKey,
		)
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: event.created_at + 1,
				tags: [['e', event.id]],
				content: 'deleted',
			},
			secretKey,
		)
		const calls: string[] = []
		const service = {
			supported: true,
			list: async () => [region],
			events: async () => {
				calls.push('page')
				return {
					regionId: region.id,
					expectedEvents: 1,
					cursor: 0,
					nextCursor: null,
					events: [event],
					missingEventIds: [],
				}
			},
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(service, {
			queryDeletionEvents: async (filters) => {
				calls.push('tombstones')
				expect(filters).toContainEqual({
					kinds: [5],
					authors: [event.pubkey],
					'#e': [event.id],
					limit: 256,
				})
				return [deletion]
			},
			ingestDeletion: async (tombstone) => {
				calls.push('ingest')
				return ingestDeletionEvent(tombstone)
			},
		})

		expect(calls).toEqual(['page', 'tombstones', 'ingest'])
		expect(result).toEqual({
			state: 'ready',
			regions: 1,
			events: 0,
			missing: 0,
			authors: [event.pubkey],
			deletionTargets: [deletionTargetForEvent(event)],
			incompleteRegionIds: [],
			deferredRegionIds: [],
			regionDeletionTargets: { [region.id]: [deletionTargetForEvent(event)] },
		})
		expect(eventStore.getEvent(event.id)).toBeUndefined()
	})

	test('restores a native-pinned tombstone before its immutable target without IndexedDB help', async () => {
		const secretKey = generateSecretKey()
		const event = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_015,
				tags: [['d', 'natively-deleted-dataset']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			secretKey,
		)
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: event.created_at + 1,
				tags: [['e', event.id]],
				content: 'deleted',
			},
			secretKey,
		)
		const service = {
			supported: true,
			list: async () => [region],
			events: async () => ({
				regionId: region.id,
				expectedEvents: 2,
				cursor: 0,
				nextCursor: null,
				events: [deletion, event],
				missingEventIds: [],
			}),
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(service, {
			queryDeletionEvents: async () => [],
			ingestDeletion: ingestDeletionEvent,
		})

		expect(result.state).toBe('ready')
		if (result.state !== 'ready') throw new Error('saved-region hydration did not finish')
		expect(result.events).toBe(0)
		expect(eventStore.getEvent(event.id)).toBeUndefined()
	})

	test('restores a later native tombstone before cross-page targets and even when the region is deferred', async () => {
		const secretKey = generateSecretKey()
		const event = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_016,
				tags: [['d', 'cross-page-deleted-dataset']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			secretKey,
		)
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: event.created_at + 1,
				tags: [['e', event.id]],
				content: 'deleted',
			},
			secretKey,
		)
		const service = {
			supported: true,
			list: async () => [region],
			events: async (_id: string, cursor?: number) =>
				cursor === 0
					? {
							regionId: region.id,
							expectedEvents: 2,
							cursor: 0,
							nextCursor: 1,
							events: [event],
							missingEventIds: [],
						}
					: {
							regionId: region.id,
							expectedEvents: 2,
							cursor: 1,
							nextCursor: null,
							events: [deletion],
							missingEventIds: [],
						},
		} as unknown as SavedRegionService

		eventStore.add(event)
		const result = await hydrateSavedRegionEvents(
			service,
			{
				queryDeletionEvents: async () => [],
				ingestDeletion: ingestDeletionEvent,
			},
			{ maxEvents: 1, maxBytes: 64 * 1024 },
		)

		expect(result.state).toBe('ready')
		if (result.state !== 'ready') throw new Error('saved-region hydration did not finish')
		expect(result.deferredRegionIds).toEqual([region.id])
		expect(eventStore.getEvent(event.id)).toBeUndefined()
	})

	test('does not repromote an e-only-deleted saved map announcement', async () => {
		const secretKey = generateSecretKey()
		const announcement = finalizeEvent(
			{
				kind: 34_444,
				created_at: 1_900_000_020,
				tags: [['d', 'saved-map-source']],
				content: JSON.stringify({ version: 1, layers: [] }),
			},
			secretKey,
		)
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: announcement.created_at + 1,
				tags: [['e', announcement.id]],
				content: 'deleted',
			},
			secretKey,
		)
		const announcementRegion = { ...region, announcementId: announcement.id }
		const service = {
			supported: true,
			list: async () => [announcementRegion],
			events: async () => ({
				regionId: region.id,
				expectedEvents: 1,
				cursor: 0,
				nextCursor: null,
				events: [announcement],
				missingEventIds: [],
			}),
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(service, {
			queryDeletionEvents: async () => [deletion],
			ingestDeletion: async (tombstone) => ingestDeletionEvent(tombstone),
		})

		expect(result.state).toBe('ready')
		if (result.state !== 'ready') throw new Error('saved-region hydration did not finish')
		expect(result.events).toBe(0)
		expect(eventStore.getEvent(announcement.id)).toBeUndefined()
	})

	test('restores and exposes the required map source author even when its announcement is missing', async () => {
		const sourceKey = generateSecretKey()
		const sourcePubkey = getPublicKey(sourceKey)
		const announcementId = 'd'.repeat(64)
		const sourceRegion = { ...region, sourcePubkey, announcementId }
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: 1_900_000_031,
				tags: [['e', announcementId]],
				content: 'deleted map source',
			},
			sourceKey,
		)
		const ingested: string[] = []
		const service = {
			supported: true,
			list: async () => [sourceRegion],
			events: async () => ({
				regionId: sourceRegion.id,
				expectedEvents: 1,
				cursor: 0,
				nextCursor: null,
				events: [],
				missingEventIds: [announcementId],
			}),
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(service, {
			queryDeletionEvents: async (filters) => {
				expect(filters).toEqual([
					{
						kinds: [5],
						authors: [sourcePubkey],
						'#e': [announcementId],
						limit: 256,
					},
				])
				return [deletion]
			},
			ingestDeletion: async (event) => {
				ingested.push(event.id)
				return ingestDeletionEvent(event)
			},
		})

		expect(ingested).toEqual([deletion.id])
		expect(result).toEqual({
			state: 'ready',
			regions: 1,
			events: 0,
			missing: 1,
			authors: [sourcePubkey],
			deletionTargets: [{ pubkey: sourcePubkey, eventId: announcementId }],
			incompleteRegionIds: [sourceRegion.id],
			deferredRegionIds: [],
			regionDeletionTargets: {
				[sourceRegion.id]: [{ pubkey: sourcePubkey, eventId: announcementId }],
			},
		})
	})

	test('defers an over-budget region atomically instead of partially hydrating it', async () => {
		const secretKey = generateSecretKey()
		const first = finalizeEvent(
			{ kind: 1, created_at: 1_900_000_200, tags: [], content: 'first staged page' },
			secretKey,
		)
		const second = finalizeEvent(
			{ kind: 1, created_at: 1_900_000_201, tags: [], content: 'second staged page' },
			secretKey,
		)
		const service = {
			supported: true,
			list: async () => [region],
			events: async (_id: string, cursor?: number) =>
				cursor === 0
					? {
							regionId: region.id,
							expectedEvents: 2,
							cursor: 0,
							nextCursor: 1,
							events: [first],
							missingEventIds: [],
						}
					: {
							regionId: region.id,
							expectedEvents: 2,
							cursor: 1,
							nextCursor: null,
							events: [second],
							missingEventIds: [],
						},
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(
			service,
			{
				queryDeletionEvents: async () => [],
				ingestDeletion: ingestDeletionEvent,
			},
			{ maxEvents: 1, maxBytes: 64 * 1024 },
		)

		expect(result.state).toBe('ready')
		if (result.state !== 'ready') throw new Error('saved-region hydration did not finish')
		expect(result.events).toBe(0)
		expect(result.deferredRegionIds).toEqual([region.id])
		expect(result.regionDeletionTargets[region.id]?.map((target) => target.eventId)).toEqual(
			[first.id, second.id].sort(),
		)
		expect(eventStore.getEvent(first.id)).toBeUndefined()
		expect(eventStore.getEvent(second.id)).toBeUndefined()
	})

	test('uses the cached source coordinate to restore an address-only deletion on cold start', async () => {
		const sourceKey = generateSecretKey()
		const announcement = finalizeEvent(
			{
				kind: 34_444,
				created_at: 1_900_000_032,
				tags: [['d', 'offline-map-source']],
				content: JSON.stringify({ version: 1, layers: [] }),
			},
			sourceKey,
		)
		const address = `${announcement.kind}:${announcement.pubkey}:offline-map-source`
		const deletion = finalizeEvent(
			{
				kind: 5,
				created_at: announcement.created_at + 1,
				tags: [['a', address]],
				content: 'deleted map source',
			},
			sourceKey,
		)
		const sourceRegion = {
			...region,
			sourcePubkey: announcement.pubkey,
			announcementId: announcement.id,
		}
		const service = {
			supported: true,
			list: async () => [sourceRegion],
			events: async () => ({
				regionId: sourceRegion.id,
				expectedEvents: 1,
				cursor: 0,
				nextCursor: null,
				events: [],
				missingEventIds: [announcement.id],
			}),
		} as unknown as SavedRegionService

		const result = await hydrateSavedRegionEvents(service, {
			readCachedAnnouncement: () => announcement,
			queryDeletionEvents: async (filters) => {
				expect(filters).toContainEqual({
					kinds: [5],
					authors: [announcement.pubkey],
					'#a': [address],
					limit: 256,
				})
				return [deletion]
			},
			ingestDeletion: ingestDeletionEvent,
		})

		expect(result.state).toBe('ready')
		if (result.state !== 'ready') throw new Error('saved-region hydration did not finish')
		expect(result.deletionTargets).toEqual([deletionTargetForEvent(announcement)])
	})

	test('replays accumulated address tombstones oldest-first across hydration pages', async () => {
		const secretKey = generateSecretKey()
		const pubkey = getPublicKey(secretKey)
		const filler = finalizeEvent(
			{ kind: 1, created_at: 1_900_000_040, tags: [], content: 'first page' },
			secretKey,
		)
		const target = finalizeEvent(
			{
				kind: 37_515,
				created_at: 1_900_000_075,
				tags: [['d', 'ordered-deletion']],
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
			},
			secretKey,
		)
		const deletion = (created_at: number) =>
			finalizeEvent(
				{
					kind: 5,
					created_at,
					tags: [['a', `${target.kind}:${pubkey}:ordered-deletion`]],
					content: 'deleted',
				},
				secretKey,
			)
		const older = deletion(1_900_000_050)
		const newer = deletion(1_900_000_100)
		const orderedRegion = { ...region, sourcePubkey: pubkey }
		let queryCount = 0
		const ingestedAt: number[] = []
		const service = {
			supported: true,
			list: async () => [orderedRegion],
			events: async (_id: string, cursor?: number) =>
				cursor === 0
					? {
							regionId: orderedRegion.id,
							expectedEvents: 2,
							cursor: 0,
							nextCursor: 1,
							events: [filler],
							missingEventIds: [],
						}
					: {
							regionId: orderedRegion.id,
							expectedEvents: 2,
							cursor: 1,
							nextCursor: null,
							events: [target],
							missingEventIds: [],
						},
		} as unknown as SavedRegionService

		try {
			const result = await hydrateSavedRegionEvents(service, {
				queryDeletionEvents: async () => (queryCount++ === 0 ? [newer] : [older]),
				ingestDeletion: async (event) => {
					ingestedAt.push(event.created_at)
					return ingestDeletionEvent(event)
				},
			})

			expect(ingestedAt).toEqual([newer.created_at, older.created_at])
			expect(isEventDeleted(target)).toBe(true)
			expect(eventStore.getEvent(target.id)).toBeUndefined()
			expect(result.state === 'ready' ? result.events : -1).toBe(1)
		} finally {
			eventStore.remove(filler.id)
			eventStore.remove(target.id)
		}
	})
})
