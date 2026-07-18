import { describe, expect, test } from 'bun:test'
import { EventStore } from 'applesauce-core'
import { finalizeEvent, generateSecretKey, type Filter, type NostrEvent } from 'nostr-tools'
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds'
import {
	applyVerifiedDeletionToCache,
	deletionFiltersForTargets,
	deletionTargetForEvent,
	filterDeletedCacheWrites,
	type DeletionEventCache,
	normalizeDeletionTargets,
	verifiedDeletionEvent,
	verifiedDeletionForTargets,
} from './deletionCache'

function identifierFor(event: NostrEvent): string {
	return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
}

function cacheKey(event: NostrEvent): string {
	return isReplaceableKind(event.kind) || isAddressableKind(event.kind)
		? `${event.kind}:${event.pubkey}:${identifierFor(event)}`
		: event.id
}

class MemoryDeletionCache implements DeletionEventCache {
	readonly events = new Map<string, NostrEvent>()
	flushCount = 0

	async add(event: NostrEvent): Promise<boolean> {
		this.events.set(cacheKey(event), event)
		return true
	}

	async query(filters: Filter | Filter[]): Promise<NostrEvent[]> {
		const list = Array.isArray(filters) ? filters : [filters]
		return [...this.events.values()].filter((event) =>
			list.some(
				(filter) =>
					(!filter.ids || filter.ids.includes(event.id)) &&
					(!filter.authors || filter.authors.includes(event.pubkey)) &&
					(!filter.kinds || filter.kinds.includes(event.kind)),
			),
		)
	}

	async deleteEvent(eventId: string): Promise<boolean> {
		return this.events.delete(eventId)
	}

	async deleteReplaceable(pubkey: string, kind: number, identifier = ''): Promise<boolean> {
		return this.events.delete(`${kind}:${pubkey}:${identifier}`)
	}

	async flush(): Promise<void> {
		this.flushCount += 1
	}
}

class QueuedDeletionCache implements DeletionEventCache {
	readonly stored = new Map<string, NostrEvent>()
	readonly pending: NostrEvent[] = []

	async add(event: NostrEvent): Promise<boolean> {
		this.pending.push(event)
		return true
	}

	async flush(): Promise<void> {
		for (const event of this.pending.splice(0)) this.stored.set(cacheKey(event), event)
	}

	async query(filters: Filter | Filter[]): Promise<NostrEvent[]> {
		const list = Array.isArray(filters) ? filters : [filters]
		return [...this.stored.values()].filter((event) =>
			list.some(
				(filter) =>
					(!filter.authors || filter.authors.includes(event.pubkey)) &&
					(!filter.kinds || filter.kinds.includes(event.kind)),
			),
		)
	}

	async deleteEvent(eventId: string): Promise<boolean> {
		return this.stored.delete(eventId)
	}

	async deleteReplaceable(pubkey: string, kind: number, identifier = ''): Promise<boolean> {
		return this.stored.delete(`${kind}:${pubkey}:${identifier}`)
	}
}

function isDeleted(store: EventStore, event: NostrEvent): boolean {
	return (store as unknown as { deletes: { check(candidate: NostrEvent): boolean } }).deletes.check(
		event,
	)
}

function dataset(secretKey: Uint8Array, createdAt = 100, identifier = 'trail'): NostrEvent {
	return finalizeEvent(
		{
			kind: 37_515,
			created_at: createdAt,
			tags: [['d', identifier]],
			content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
		},
		secretKey,
	)
}

function deletionFor(
	target: NostrEvent,
	secretKey: Uint8Array,
	createdAt = target.created_at + 1,
): NostrEvent {
	return finalizeEvent(
		{
			kind: 5,
			created_at: createdAt,
			tags: [
				['e', target.id],
				['a', `${target.kind}:${target.pubkey}:${identifierFor(target)}`],
			],
			content: 'deleted',
		},
		secretKey,
	)
}

describe('NIP-09 IndexedDB durability', () => {
	test('builds only bounded target-specific deletion filters', () => {
		const first = dataset(generateSecretKey())
		const second = finalizeEvent(
			{ kind: 1, created_at: 100, tags: [], content: 'comment' },
			generateSecretKey(),
		)
		const filters = deletionFiltersForTargets([
			{ eventId: first.id, pubkey: first.pubkey },
			deletionTargetForEvent(first),
			deletionTargetForEvent(second),
		])
		expect(
			normalizeDeletionTargets([
				{ eventId: first.id, pubkey: first.pubkey },
				deletionTargetForEvent(first),
			]),
		).toEqual([deletionTargetForEvent(first)])

		expect(filters).toHaveLength(3)
		for (const filter of filters) {
			expect(filter.kinds).toEqual([5])
			expect(filter.authors).toHaveLength(1)
			expect(filter.limit).toBe(256)
			expect(Boolean(filter['#e']?.length || filter['#a']?.length)).toBe(true)
		}
		expect(filters.find((filter) => filter['#e']?.includes(first.id))?.authors).toEqual([
			first.pubkey,
		])
		expect(filters.find((filter) => filter['#e']?.includes(second.id))?.authors).toEqual([
			second.pubkey,
		])
		expect(filters.some((filter) => filter['#e']?.includes(first.id))).toBe(true)
		expect(filters.some((filter) => filter['#e']?.includes(second.id))).toBe(true)
		expect(
			filters.some((filter) => filter['#a']?.includes(`${first.kind}:${first.pubkey}:trail`)),
		).toBe(true)
	})

	test('evicts the target, retains the tombstone, and suppresses it after a cold restart', async () => {
		const secretKey = generateSecretKey()
		const target = dataset(secretKey)
		const deletion = verifiedDeletionEvent(deletionFor(target, secretKey))
		const cache = new MemoryDeletionCache()
		await cache.add(target)
		expect(deletion).not.toBeNull()
		if (!deletion) throw new Error('fixture deletion did not verify')

		expect(await applyVerifiedDeletionToCache(cache, deletion)).toBe(1)
		expect(cache.flushCount).toBe(2)
		expect(await cache.query({ kinds: [target.kind] })).toEqual([])
		expect((await cache.query({ kinds: [5] })).map((event) => event.id)).toEqual([deletion.id])

		const restarted = new EventStore()
		for (const cachedDeletion of await cache.query({ kinds: [5] })) {
			const verified = verifiedDeletionEvent(cachedDeletion)
			if (verified) restarted.add(verified)
		}
		restarted.add(target)
		expect(isDeleted(restarted, target)).toBe(true)
		expect(restarted.hasEvent(target.id)).toBe(false)
	})

	test('drops an insert that was buffered before its deletion arrived', () => {
		const secretKey = generateSecretKey()
		const target = dataset(secretKey)
		const deletion = verifiedDeletionEvent(deletionFor(target, secretKey))
		const store = new EventStore()
		store.add(target)
		expect(deletion).not.toBeNull()
		if (!deletion) throw new Error('fixture deletion did not verify')
		store.add(deletion)

		expect(filterDeletedCacheWrites([target], (event) => isDeleted(store, event))).toEqual([])
	})

	test('flushes a pending target before eviction and flushes the tombstone after it', async () => {
		const secretKey = generateSecretKey()
		const target = dataset(secretKey)
		const deletion = verifiedDeletionEvent(deletionFor(target, secretKey))
		const cache = new QueuedDeletionCache()
		await cache.add(target)
		expect(deletion).not.toBeNull()
		if (!deletion) throw new Error('fixture deletion did not verify')

		expect(await applyVerifiedDeletionToCache(cache, deletion)).toBe(1)
		expect(cache.pending).toEqual([])
		expect(await cache.query({ kinds: [target.kind] })).toEqual([])
		expect((await cache.query({ kinds: [5] })).map((event) => event.id)).toEqual([deletion.id])
	})

	test('evicts a deleted regular map announcement referenced by event id', async () => {
		const secretKey = generateSecretKey()
		const announcement = finalizeEvent(
			{
				kind: 34_444,
				created_at: 100,
				tags: [],
				content: JSON.stringify({ version: 1, layers: [] }),
			},
			secretKey,
		)
		const deletion = verifiedDeletionEvent(deletionFor(announcement, secretKey))
		const cache = new MemoryDeletionCache()
		await cache.add(announcement)
		expect(deletion).not.toBeNull()
		if (!deletion) throw new Error('fixture deletion did not verify')

		expect(await applyVerifiedDeletionToCache(cache, deletion)).toBe(1)
		expect(await cache.query({ kinds: [announcement.kind] })).toEqual([])
	})

	test('does not let a different author evict a cached event', async () => {
		const ownerKey = generateSecretKey()
		const attackerKey = generateSecretKey()
		const target = dataset(ownerKey)
		const forgedAuthority = verifiedDeletionEvent(deletionFor(target, attackerKey))
		const cache = new MemoryDeletionCache()
		await cache.add(target)
		expect(forgedAuthority).not.toBeNull()
		if (!forgedAuthority) throw new Error('fixture deletion did not verify')

		expect(await applyVerifiedDeletionToCache(cache, forgedAuthority)).toBe(0)
		expect((await cache.query({ kinds: [target.kind] })).map((event) => event.id)).toEqual([
			target.id,
		])
	})

	test('does not let an older deletion remove a newer replacement', async () => {
		const secretKey = generateSecretKey()
		const newer = dataset(secretKey, 200)
		const olderDeletion = verifiedDeletionEvent(deletionFor(newer, secretKey, 199))
		const cache = new MemoryDeletionCache()
		await cache.add(newer)
		expect(olderDeletion).not.toBeNull()
		if (!olderDeletion) throw new Error('fixture deletion did not verify')

		expect(await applyVerifiedDeletionToCache(cache, olderDeletion)).toBe(0)
		expect((await cache.query({ kinds: [newer.kind] })).map((event) => event.id)).toEqual([
			newer.id,
		])
	})

	test('rebuilds the event before verification instead of trusting cached metadata', () => {
		const secretKey = generateSecretKey()
		const target = dataset(secretKey)
		const signed = deletionFor(target, secretKey)
		expect(verifiedDeletionEvent({ ...signed, sig: '0'.repeat(128) })).toBeNull()
	})

	test('rejects a signed tombstone that exceeds the hydration target-pointer bound', () => {
		const signed = finalizeEvent(
			{
				kind: 5,
				created_at: 200,
				tags: Array.from({ length: 4_097 }, (_, index) => [
					'e',
					index.toString(16).padStart(64, '0'),
				]),
				content: 'bounded deletion',
			},
			generateSecretKey(),
		)
		expect(verifiedDeletionEvent(signed)).toBeNull()
	})

	test('accepts only signature-verified tombstones relevant to the requested target', () => {
		const ownerKey = generateSecretKey()
		const target = dataset(ownerKey)
		const relevant = deletionFor(target, ownerKey)
		const wrongAuthor = deletionFor(target, generateSecretKey())
		const unrelatedTarget = dataset(ownerKey, target.created_at + 10, 'other-trail')
		const unrelated = deletionFor(unrelatedTarget, ownerKey)
		const targets = [deletionTargetForEvent(target)]

		expect(verifiedDeletionForTargets(relevant, targets)?.id).toBe(relevant.id)
		expect(verifiedDeletionForTargets(wrongAuthor, targets)).toBeNull()
		expect(verifiedDeletionForTargets(unrelated, targets)).toBeNull()
		expect(verifiedDeletionForTargets({ ...relevant, sig: '0'.repeat(128) }, targets)).toBeNull()
	})

	test('rejects oversized deletion envelopes before signature verification', () => {
		const signed = finalizeEvent(
			{
				kind: 5,
				created_at: 200,
				tags: [['e', 'a'.repeat(64)]],
				content: 'x'.repeat(64 * 1024 + 1),
			},
			generateSecretKey(),
		)
		expect(verifiedDeletionEvent(signed)).toBeNull()
	})

	test('rejects malformed relay-shaped deletion envelopes without throwing', () => {
		for (const malformed of [
			{ kind: 5, content: null, tags: null },
			{ kind: 5, content: '', tags: [null] },
			{ kind: 5, content: '', tags: [['e', null]] },
		]) {
			expect(() => verifiedDeletionEvent(malformed as unknown as NostrEvent)).not.toThrow()
			expect(verifiedDeletionEvent(malformed as unknown as NostrEvent)).toBeNull()
		}
	})
})
