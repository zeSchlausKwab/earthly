import type { Filter, NostrEvent } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import { isAddressableKind, isReplaceableKind } from 'nostr-tools/kinds'

/** The subset of NostrIDB used to make NIP-09 state survive a cold restart. */
export interface DeletionEventCache {
	add(event: NostrEvent): Promise<boolean>
	query(filters: Filter | Filter[]): Promise<NostrEvent[]>
	deleteEvent(eventId: string): Promise<boolean>
	deleteReplaceable(pubkey: string, kind: number, identifier?: string): Promise<boolean>
	/** NostrIDB implements this at runtime but currently marks it private in its declaration. */
	flush?(): Promise<void>
}

interface AddressPointer {
	kind: number
	pubkey: string
	identifier: string
}

export interface DeletionTarget {
	eventId: string
	pubkey: string
	address?: string
}

const HEX_64 = /^[0-9a-f]{64}$/u
const DELETION_TARGETS_PER_FILTER = 64
const DELETION_FILTER_LIMIT = 256
const MAX_DELETION_TARGET_POINTERS = 4_096
const MAX_DELETION_TAGS = 4_096
const MAX_DELETION_TAG_ENTRIES = 16
const MAX_DELETION_TAG_VALUE_CHARS = 2_048
const MAX_DELETION_TAG_CHARS = 256 * 1024
const MAX_DELETION_CONTENT_CHARS = 64 * 1024

function addressPointer(value: string | undefined): AddressPointer | null {
	if (!value) return null
	const [kindText, pubkey, ...identifierParts] = value.split(':')
	const kind = Number(kindText)
	if (
		!Number.isInteger(kind) ||
		String(kind) !== kindText ||
		!HEX_64.test(pubkey ?? '') ||
		(!isReplaceableKind(kind) && !isAddressableKind(kind))
	) {
		return null
	}
	return { kind, pubkey: pubkey as string, identifier: identifierParts.join(':') }
}

function identifierFor(event: NostrEvent): string {
	return event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
}

export function deletionCoordinateFor(event: NostrEvent): string | null {
	if (!isReplaceableKind(event.kind) && !isAddressableKind(event.kind)) return null
	return `${event.kind}:${event.pubkey}:${identifierFor(event)}`
}

export function deletionTargetForEvent(event: NostrEvent): DeletionTarget {
	const address = deletionCoordinateFor(event)
	return {
		eventId: event.id,
		pubkey: event.pubkey,
		...(address ? { address } : {}),
	}
}

/** Deduplicate targets by signed-event identity while retaining an available address pointer. */
export function normalizeDeletionTargets(targets: readonly DeletionTarget[]): DeletionTarget[] {
	const unique = new Map<string, DeletionTarget>()
	for (const target of targets) {
		if (!HEX_64.test(target.eventId) || !HEX_64.test(target.pubkey)) continue
		if (target.address) {
			const pointer = addressPointer(target.address)
			if (!pointer || pointer.pubkey !== target.pubkey) continue
		}
		const key = `${target.pubkey}:${target.eventId}`
		const existing = unique.get(key)
		if (!existing || (!existing.address && target.address)) unique.set(key, target)
	}
	return [...unique.values()].sort(
		(left, right) =>
			left.pubkey.localeCompare(right.pubkey) ||
			left.eventId.localeCompare(right.eventId) ||
			(left.address ?? '').localeCompare(right.address ?? ''),
	)
}

/**
 * Build bounded NIP-09 lookups for only the records Earthly is about to retain.
 *
 * Each filter is constrained by both signer and referenced event/address. Grouping
 * 64 targets keeps relay requests manageable without falling back to an unbounded
 * author-history subscription. The per-filter limit is a second line of defence;
 * callers must still enforce a total event/byte budget across all filters.
 */
export function deletionFiltersForTargets(targets: readonly DeletionTarget[]): Filter[] {
	const ordered = normalizeDeletionTargets(targets)
	const byAuthor = new Map<string, DeletionTarget[]>()
	for (const target of ordered) {
		const authorTargets = byAuthor.get(target.pubkey) ?? []
		authorTargets.push(target)
		byAuthor.set(target.pubkey, authorTargets)
	}
	const filters: Filter[] = []
	for (const [author, authorTargets] of byAuthor) {
		for (let offset = 0; offset < authorTargets.length; offset += DELETION_TARGETS_PER_FILTER) {
			const chunk = authorTargets.slice(offset, offset + DELETION_TARGETS_PER_FILTER)
			filters.push({
				kinds: [5],
				authors: [author],
				'#e': chunk.map((target) => target.eventId),
				limit: DELETION_FILTER_LIMIT,
			})
			const addresses = [
				...new Set(chunk.flatMap((target) => (target.address ? [target.address] : []))),
			]
			if (addresses.length > 0) {
				filters.push({
					kinds: [5],
					authors: [author],
					'#a': addresses,
					limit: DELETION_FILTER_LIMIT,
				})
			}
		}
	}
	return filters
}

/**
 * Whether a signature-verified NIP-09 event is authorized to suppress this exact record.
 * This explicitly handles `e`-only tombstones for addressable events; Applesauce's
 * DeleteManager remembers future addressable deletions only through `a` coordinates.
 */
export function deletionTargetsEvent(deletion: NostrEvent, target: NostrEvent): boolean {
	if (
		deletion.kind !== 5 ||
		deletion.pubkey !== target.pubkey ||
		deletion.created_at < target.created_at
	) {
		return false
	}
	for (const tag of deletion.tags) {
		if (tag[0] === 'e' && tag[1] === target.id) return true
		if (tag[0] !== 'a') continue
		const pointer = addressPointer(tag[1])
		if (!pointer || pointer.pubkey !== deletion.pubkey) continue
		if (
			`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}` === deletionCoordinateFor(target)
		) {
			return true
		}
	}
	return false
}

/**
 * Return a freshly-cloned, signature-verified kind-5 event.
 *
 * `nostr-tools` memoizes verification on the input object. Rebuilding the canonical
 * event prevents an IndexedDB object carrying a stale verification Symbol from being
 * trusted, and is especially important because Applesauce's kind-5 fast path does not
 * call the EventStore's normal verifier.
 */
export function verifiedDeletionEvent(event: NostrEvent): NostrEvent | null {
	if (
		!event ||
		typeof event !== 'object' ||
		event.kind !== 5 ||
		!Number.isSafeInteger(event.created_at) ||
		event.created_at < 0 ||
		typeof event.id !== 'string' ||
		typeof event.pubkey !== 'string' ||
		typeof event.sig !== 'string' ||
		typeof event.content !== 'string' ||
		!Array.isArray(event.tags)
	) {
		return null
	}
	if (event.content.length > MAX_DELETION_CONTENT_CHARS || event.tags.length > MAX_DELETION_TAGS) {
		return null
	}
	let tagChars = 0
	for (const tag of event.tags) {
		if (
			!Array.isArray(tag) ||
			tag.length > MAX_DELETION_TAG_ENTRIES ||
			tag.some((value) => typeof value !== 'string')
		) {
			return null
		}
		for (const value of tag) {
			if (value.length > MAX_DELETION_TAG_VALUE_CHARS) return null
			tagChars += value.length
			if (tagChars > MAX_DELETION_TAG_CHARS) return null
		}
	}
	if (
		event.tags.filter((tag) => tag[0] === 'e' || tag[0] === 'a').length >
		MAX_DELETION_TARGET_POINTERS
	) {
		return null
	}
	const candidate: NostrEvent = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig,
	}
	try {
		return verifyEvent(candidate) ? candidate : null
	} catch {
		return null
	}
}

/** Verify a relay/cache tombstone and require an exact requested signer + e/a pointer. */
export interface DeletionTargetIndex {
	eventIdsByAuthor: ReadonlyMap<string, ReadonlySet<string>>
	addressesByAuthor: ReadonlyMap<string, ReadonlySet<string>>
}

export function indexDeletionTargets(targets: readonly DeletionTarget[]): DeletionTargetIndex {
	const eventIdsByAuthor = new Map<string, Set<string>>()
	const addressesByAuthor = new Map<string, Set<string>>()
	for (const target of normalizeDeletionTargets(targets)) {
		const eventIds = eventIdsByAuthor.get(target.pubkey) ?? new Set<string>()
		eventIds.add(target.eventId)
		eventIdsByAuthor.set(target.pubkey, eventIds)
		if (target.address) {
			const addresses = addressesByAuthor.get(target.pubkey) ?? new Set<string>()
			addresses.add(target.address)
			addressesByAuthor.set(target.pubkey, addresses)
		}
	}
	return { eventIdsByAuthor, addressesByAuthor }
}

export function verifiedDeletionForTargetIndex(
	event: NostrEvent,
	index: DeletionTargetIndex,
): NostrEvent | null {
	const verified = verifiedDeletionEvent(event)
	if (!verified) return null
	const eventIds = index.eventIdsByAuthor.get(verified.pubkey)
	const addresses = index.addressesByAuthor.get(verified.pubkey)
	if (!eventIds && !addresses) return null
	for (const tag of verified.tags) {
		if (tag[0] === 'e' && eventIds?.has(tag[1] ?? '')) return verified
		if (tag[0] === 'a' && addresses?.has(tag[1] ?? '')) return verified
	}
	return null
}

export function verifiedDeletionForTargets(
	event: NostrEvent,
	targets: readonly DeletionTarget[],
): NostrEvent | null {
	return verifiedDeletionForTargetIndex(event, indexDeletionTargets(targets))
}

async function removeCachedTarget(cache: DeletionEventCache, target: NostrEvent): Promise<boolean> {
	if (isReplaceableKind(target.kind) || isAddressableKind(target.kind)) {
		return cache.deleteReplaceable(target.pubkey, target.kind, identifierFor(target))
	}
	return cache.deleteEvent(target.id)
}

/**
 * Persist a verified deletion tombstone and evict only targets it is authorized to delete.
 *
 * NIP-09 cannot erase copies another person already holds. This routine has the narrower
 * goal of preventing Earthly's own IndexedDB cache from resurrecting an event after its
 * author deleted it. Both event-id and address pointers are checked against the cached
 * target's author and timestamp before any local deletion occurs.
 */
export async function applyVerifiedDeletionToCache(
	cache: DeletionEventCache,
	deletion: NostrEvent,
): Promise<number> {
	// A target may still be in NostrIDB's write queue. Flush it before deleting so a later
	// scheduled flush cannot resurrect the target after this routine returns ready.
	await cache.flush?.()
	const eventIds = new Set<string>()
	const replaceableKinds = new Set<number>()
	const addressableIdentifiers = new Map<number, Set<string>>()
	for (const tag of deletion.tags) {
		if (tag[0] === 'e' && HEX_64.test(tag[1] ?? '')) {
			eventIds.add(tag[1] as string)
			continue
		}
		if (tag[0] !== 'a') continue
		const pointer = addressPointer(tag[1])
		if (!pointer || pointer.pubkey !== deletion.pubkey) continue
		if (isAddressableKind(pointer.kind)) {
			const identifiers = addressableIdentifiers.get(pointer.kind) ?? new Set<string>()
			identifiers.add(pointer.identifier)
			addressableIdentifiers.set(pointer.kind, identifiers)
		} else {
			replaceableKinds.add(pointer.kind)
		}
	}
	const targetPointerCount =
		eventIds.size +
		replaceableKinds.size +
		[...addressableIdentifiers.values()].reduce((total, identifiers) => total + identifiers.size, 0)
	if (targetPointerCount > MAX_DELETION_TARGET_POINTERS) {
		throw new Error('Deletion event exceeds the bounded target-pointer limit')
	}
	const targetFilters: Filter[] = []
	if (eventIds.size > 0) {
		targetFilters.push({ ids: [...eventIds], authors: [deletion.pubkey] })
	}
	if (replaceableKinds.size > 0) {
		targetFilters.push({ kinds: [...replaceableKinds], authors: [deletion.pubkey] })
	}
	for (const [kind, identifiers] of addressableIdentifiers) {
		targetFilters.push({
			kinds: [kind],
			authors: [deletion.pubkey],
			'#d': [...identifiers],
		})
	}
	const authored = targetFilters.length > 0 ? await cache.query(targetFilters) : []
	const byId = new Map(authored.map((event) => [event.id, event]))
	const byCoordinate = new Map<string, NostrEvent>()
	for (const event of authored) {
		const coordinate = deletionCoordinateFor(event)
		if (coordinate) byCoordinate.set(coordinate, event)
	}

	const targets = new Map<string, NostrEvent>()
	for (const tag of deletion.tags) {
		if (tag[0] === 'e' && HEX_64.test(tag[1] ?? '')) {
			const target = byId.get(tag[1] as string)
			if (target) targets.set(target.id, target)
			continue
		}
		if (tag[0] !== 'a') continue
		const pointer = addressPointer(tag[1])
		// NIP-09 only authorizes deleting the signer's own address.
		if (!pointer || pointer.pubkey !== deletion.pubkey) continue
		const target = byCoordinate.get(`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`)
		if (target) targets.set(target.id, target)
	}

	let removed = 0
	for (const target of targets.values()) {
		if (target.pubkey !== deletion.pubkey || target.created_at > deletion.created_at) continue
		if (await removeCachedTarget(cache, target)) removed += 1
	}

	// EventStore never emits kind 5 on insert$, so this explicit write is what lets a
	// later cold start restore the DeleteManager before saved content is selected.
	await cache.add(deletion)
	await cache.flush?.()
	return removed
}

/** Drop an event that became deleted while persistEventsToCache was buffering it. */
export function filterDeletedCacheWrites(
	events: readonly NostrEvent[],
	isDeleted: (event: NostrEvent) => boolean,
): NostrEvent[] {
	return events.filter((event) => !isDeleted(event))
}
