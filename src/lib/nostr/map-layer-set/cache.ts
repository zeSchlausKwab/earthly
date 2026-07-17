import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { deletionTargetsEvent, verifiedDeletionEvent } from '../deletionCache'
import { MAP_LAYER_SET_KIND } from '../kinds'
import { parseMapLayerSetContent } from './trust'

export const CACHED_MAP_LAYER_SET_STORAGE_KEY = 'earthly-trusted-map-layer-set-v1'

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u
const MAX_REMEMBERED_MAP_DELETIONS = 4_096
let invalidationRevision = 0
const invalidationListeners = new Set<() => void>()
const rememberedMapDeletions = new Map<string, NostrEvent>()

/** Subscribe to same-window cache invalidations (the browser `storage` event does not fire there). */
export function subscribeCachedMapLayerSetInvalidation(listener: () => void): () => void {
	invalidationListeners.add(listener)
	return () => invalidationListeners.delete(listener)
}

export function getCachedMapLayerSetInvalidationRevision(): number {
	return invalidationRevision
}

function notifyInvalidation(): void {
	invalidationRevision += 1
	for (const listener of invalidationListeners) {
		try {
			listener()
		} catch (error) {
			console.warn('Trusted map announcement invalidation listener failed', error)
		}
	}
}

/** Covers e-only addressable tombstones that Applesauce's DeleteManager cannot recall later. */
export function isMapLayerSetEventDeleted(event: NostrEvent): boolean {
	return [...rememberedMapDeletions.values()].some((deletion) =>
		deletionTargetsEvent(deletion, event),
	)
}

function rememberMapDeletion(deletion: NostrEvent, trustedPubkeys: readonly string[]): boolean {
	if (!trustedPubkeys.includes(deletion.pubkey) || rememberedMapDeletions.has(deletion.id)) {
		return false
	}
	const mayTargetMap = deletion.tags.some(
		(tag) =>
			tag[0] === 'e' ||
			(tag[0] === 'a' && tag[1]?.startsWith(`${MAP_LAYER_SET_KIND}:${deletion.pubkey}:`)),
	)
	if (!mayTargetMap) return false
	rememberedMapDeletions.set(deletion.id, deletion)
	while (rememberedMapDeletions.size > MAX_REMEMBERED_MAP_DELETIONS) {
		const oldest = rememberedMapDeletions.keys().next().value
		if (typeof oldest !== 'string') break
		rememberedMapDeletions.delete(oldest)
	}
	return true
}

export function parseCachedMapLayerSet(
	value: unknown,
	trustedPubkeys: readonly string[],
): NostrEvent | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Partial<NostrEvent>
	if (
		candidate.kind !== MAP_LAYER_SET_KIND ||
		typeof candidate.pubkey !== 'string' ||
		!PUBKEY_PATTERN.test(candidate.pubkey) ||
		!trustedPubkeys.includes(candidate.pubkey) ||
		typeof candidate.content !== 'string' ||
		!parseMapLayerSetContent(candidate.content) ||
		!Array.isArray(candidate.tags) ||
		typeof candidate.id !== 'string' ||
		typeof candidate.sig !== 'string' ||
		typeof candidate.created_at !== 'number'
	) {
		return null
	}
	try {
		// Reconstruct the protocol object so nostr-tools cannot reuse a non-protocol
		// verification cache symbol that may have been serialized alongside a
		// mutated in-memory object.
		const event: NostrEvent = {
			id: candidate.id,
			pubkey: candidate.pubkey,
			created_at: candidate.created_at,
			kind: candidate.kind,
			tags: candidate.tags,
			content: candidate.content,
			sig: candidate.sig,
		}
		return verifyEvent(event) ? event : null
	} catch {
		return null
	}
}

export function readCachedMapLayerSet(
	trustedPubkeys: readonly string[],
	storage?: Pick<Storage, 'getItem'>,
): NostrEvent | null {
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return null
	try {
		const raw = target.getItem(CACHED_MAP_LAYER_SET_STORAGE_KEY)
		const parsed = raw ? parseCachedMapLayerSet(JSON.parse(raw), trustedPubkeys) : null
		return parsed && !isMapLayerSetEventDeleted(parsed) ? parsed : null
	} catch {
		return null
	}
}

export function writeCachedMapLayerSet(
	event: NostrEvent,
	trustedPubkeys: readonly string[],
	storage?: Pick<Storage, 'setItem'>,
): void {
	if (!parseCachedMapLayerSet(event, trustedPubkeys) || isMapLayerSetEventDeleted(event)) return
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return
	try {
		target.setItem(CACHED_MAP_LAYER_SET_STORAGE_KEY, JSON.stringify(event))
	} catch (error) {
		console.warn('Unable to cache the trusted map announcement for offline startup', error)
	}
}

/** Remove a trusted cached announcement when its verified author tombstones it. */
export function invalidateCachedMapLayerSetForDeletion(
	deletion: NostrEvent,
	trustedPubkeys: readonly string[],
	storage?: Pick<Storage, 'getItem' | 'removeItem'>,
): boolean {
	const verified = verifiedDeletionEvent(deletion)
	if (!verified) return false
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	const remembered = rememberMapDeletion(verified, trustedPubkeys)
	if (!target) {
		if (remembered) notifyInvalidation()
		return false
	}
	let cached: NostrEvent | null = null
	try {
		const raw = target.getItem(CACHED_MAP_LAYER_SET_STORAGE_KEY)
		cached = raw ? parseCachedMapLayerSet(JSON.parse(raw), trustedPubkeys) : null
	} catch (error) {
		console.warn('Unable to read the trusted map announcement during invalidation', error)
	}
	if (!cached || !deletionTargetsEvent(verified, cached)) {
		if (remembered) notifyInvalidation()
		return false
	}
	try {
		target.removeItem(CACHED_MAP_LAYER_SET_STORAGE_KEY)
		notifyInvalidation()
		return true
	} catch (error) {
		console.warn('Unable to invalidate the deleted trusted map announcement cache', error)
		if (remembered) notifyInvalidation()
		return false
	}
}
