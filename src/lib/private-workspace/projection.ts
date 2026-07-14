import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GeoComment } from '@/lib/nostr/geo-comment'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { StoredWorkspace } from './storage'

const workspaceByDataset = new WeakMap<GeoDataset, string>()

function dTag(tags: string[][]): string | undefined {
	return tags.find((tag) => tag[0] === 'd')?.[1]
}

/** The private workspace a projected in-memory dataset belongs to. */
export function privateWorkspaceIdForDataset(dataset: GeoDataset): string | undefined {
	return workspaceByDataset.get(dataset)
}

/**
 * Adapt decrypted kind-37515 envelopes to the existing read-only GeoDataset
 * interface without inserting unsigned private records into the public EventStore.
 */
export function projectPrivateWorkspaceDatasets(workspace: StoredWorkspace): GeoDataset[] {
	const latest = new Map<string, (typeof workspace.envelopes)[number]>()
	for (const envelope of workspace.envelopes) {
		if (envelope.kind !== GEO_EVENT_KIND) continue
		const identifier = dTag(envelope.tags)
		if (!identifier) continue
		latest.set(`${envelope.pubkey}:${identifier}`, envelope)
	}

	const datasets: GeoDataset[] = []
	for (const envelope of latest.values()) {
		try {
			const event: NostrEvent = { ...envelope, sig: '0'.repeat(128) }
			const dataset = castEvent(event, GeoDataset, eventStore)
			workspaceByDataset.set(dataset, workspace.workspaceId)
			datasets.push(dataset)
		} catch (error) {
			console.warn('[private-groups] Ignoring invalid encrypted dataset', envelope.id, error)
		}
	}
	return datasets
}

/**
 * Adapt decrypted private comment envelopes to the existing read-only comment
 * interface. The records stay out of the public EventStore and relay graph.
 */
export function projectPrivateWorkspaceComments(workspace: StoredWorkspace): GeoComment[] {
	const comments: GeoComment[] = []
	for (const envelope of workspace.envelopes) {
		if (envelope.kind !== GEO_COMMENT_KIND) continue
		try {
			const event: NostrEvent = { ...envelope, sig: '0'.repeat(128) }
			comments.push(castEvent(event, GeoComment, eventStore))
		} catch (error) {
			console.warn('[private-groups] Ignoring invalid encrypted comment', envelope.id, error)
		}
	}
	return comments.sort((a, b) => a.created_at - b.created_at)
}
