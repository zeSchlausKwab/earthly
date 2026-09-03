import { nip19 } from 'nostr-tools'
import type { InboxTarget } from './types'
import { parseInboxCoordinate } from './deriveInbox'

const ENTITY_PATHS = {
	map: 'map',
	atlas: 'atlas',
	story: 'story',
	sighting: 'sighting',
	live: 'live',
} as const

/** Build the canonical app route for a notification target. */
export function buildInboxTargetHref(target: InboxTarget | undefined): string | null {
	if (!target) return null
	if (target.type === 'person') {
		try {
			return `/person/${nip19.npubEncode(target.pubkey)}`
		} catch {
			return null
		}
	}

	const parsed = parseInboxCoordinate(target.coordinate)
	if (!parsed) return null
	try {
		const naddr = nip19.naddrEncode({
			kind: parsed.kind,
			pubkey: parsed.pubkey,
			identifier: parsed.identifier,
		})
		const root = `/${ENTITY_PATHS[target.entityKind]}/${naddr}`
		const path = target.commentId ? `${root}/comment/${encodeURIComponent(target.commentId)}` : root
		return `${path}?tab=${target.tab}`
	} catch {
		return null
	}
}
