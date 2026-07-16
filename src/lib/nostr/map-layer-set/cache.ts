import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { MAP_LAYER_SET_KIND } from '../kinds'
import { parseMapLayerSetContent } from './trust'

export const CACHED_MAP_LAYER_SET_STORAGE_KEY = 'earthly-trusted-map-layer-set-v1'

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u

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
		return raw ? parseCachedMapLayerSet(JSON.parse(raw), trustedPubkeys) : null
	} catch {
		return null
	}
}

export function writeCachedMapLayerSet(
	event: NostrEvent,
	trustedPubkeys: readonly string[],
	storage?: Pick<Storage, 'setItem'>,
): void {
	if (!parseCachedMapLayerSet(event, trustedPubkeys)) return
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return
	try {
		target.setItem(CACHED_MAP_LAYER_SET_STORAGE_KEY, JSON.stringify(event))
	} catch (error) {
		console.warn('Unable to cache the trusted map announcement for offline startup', error)
	}
}
