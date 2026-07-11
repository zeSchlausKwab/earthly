/**
 * Session publish breadcrumbs — a tiny module-level log of entities the user
 * published THIS app session (dataset publishes/updates, story publishes).
 *
 * Consumed by the AI chat's map-context system message so "now write the
 * article about what I just published" works without the user re-attaching
 * entities they published seconds ago: each publish contributes ONE line
 * (name + nostr:naddr mention). Deliberately not persisted and capped small —
 * this is a breadcrumb trail, not a feed. Publish paths call `noteSessionPublish`;
 * nothing here imports UI or chat code (dependency direction: features → lib).
 */

import { coordinateToNaddrReference } from '@/lib/nostr/references'

export interface SessionPublish {
	/** Model-facing entity type name ('dataset' | 'story' | 'group' | …). */
	type: string
	/** Display name/title at publish time. */
	name: string
	/** `kind:pubkey:d` coordinate of the published replaceable event. */
	coordinate: string
	/** Ready-to-embed `nostr:naddr1…` mention (null if encoding failed). */
	mention: string | null
	/** Epoch ms of the publish. */
	at: number
}

const MAX_ENTRIES = 8

const entries: SessionPublish[] = []

/** Record a successful entity publish (replaces an older entry for the same coordinate). */
export function noteSessionPublish(input: {
	type: string
	name: string
	coordinate: string
}): void {
	const existingIndex = entries.findIndex((entry) => entry.coordinate === input.coordinate)
	if (existingIndex !== -1) entries.splice(existingIndex, 1)
	entries.push({
		type: input.type,
		name: input.name,
		coordinate: input.coordinate,
		mention: coordinateToNaddrReference(input.coordinate),
		at: Date.now(),
	})
	if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

/** Newest-last list of this session's publish breadcrumbs. */
export function getSessionPublishes(): readonly SessionPublish[] {
	return entries
}

/** Test/reset helper. */
export function clearSessionPublishes(): void {
	entries.length = 0
}
