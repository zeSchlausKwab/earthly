import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GeoComment } from '@/lib/nostr/geo-comment'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { parseEncryptedMediaImetaTags, type EncryptedMediaAttachment } from './media'
import type { StoredWorkspace } from './storage'

export interface ProjectedMediaAttachment extends EncryptedMediaAttachment {
	/** MLS epoch in which the parent envelope was decrypted or sent (for `cordn-em-v1`). */
	epoch?: number
}

export type ProjectedGeoDataset = GeoDataset & {
	mediaAttachments: ProjectedMediaAttachment[]
	epoch?: number
}

export type ProjectedGeoComment = GeoComment & {
	mediaAttachments: ProjectedMediaAttachment[]
	epoch?: number
}

const workspaceByDataset = new WeakMap<GeoDataset, string>()
const mediaByDataset = new WeakMap<GeoDataset, ProjectedMediaAttachment[]>()
const mediaByComment = new WeakMap<GeoComment, ProjectedMediaAttachment[]>()
const epochByRecord = new WeakMap<GeoDataset | GeoComment, number>()

function dTag(tags: string[][]): string | undefined {
	return tags.find((tag) => tag[0] === 'd')?.[1]
}

function projectMediaAttachments(
	tags: string[][],
	epoch: number | undefined,
): ProjectedMediaAttachment[] {
	return parseEncryptedMediaImetaTags(tags).map((attachment) => ({
		...attachment,
		...(epoch !== undefined ? { epoch } : {}),
	}))
}

/** The private workspace a projected in-memory dataset belongs to. */
export function privateWorkspaceIdForDataset(dataset: GeoDataset): string | undefined {
	return workspaceByDataset.get(dataset)
}

/** Parsed encrypted media attachments (`cordn-em-v1` / `earthly-pm-v1`) on a private dataset. */
export function privateMediaAttachmentsForDataset(dataset: GeoDataset): ProjectedMediaAttachment[] {
	return mediaByDataset.get(dataset) ?? []
}

/** Parsed encrypted media attachments (`cordn-em-v1` / `earthly-pm-v1`) on a private comment. */
export function privateMediaAttachmentsForComment(comment: GeoComment): ProjectedMediaAttachment[] {
	return mediaByComment.get(comment) ?? []
}

/** The MLS epoch recorded for a projected private dataset or comment, if known. */
export function privateEpochForRecord(record: GeoDataset | GeoComment): number | undefined {
	return epochByRecord.get(record)
}

/**
 * Adapt decrypted kind-37515 envelopes to the existing read-only GeoDataset
 * interface without inserting unsigned private records into the public EventStore.
 */
export function projectPrivateWorkspaceDatasets(workspace: StoredWorkspace): ProjectedGeoDataset[] {
	const latest = new Map<string, (typeof workspace.envelopes)[number]>()
	for (const envelope of workspace.envelopes) {
		if (envelope.kind !== GEO_EVENT_KIND) continue
		const identifier = dTag(envelope.tags)
		if (!identifier) continue
		latest.set(`${envelope.pubkey}:${identifier}`, envelope)
	}

	const datasets: ProjectedGeoDataset[] = []
	for (const envelope of latest.values()) {
		try {
			const event: NostrEvent = { ...envelope, sig: '0'.repeat(128) }
			const dataset = castEvent(event, GeoDataset, eventStore)
			const epoch = workspace.envelopeEpochs?.[envelope.id]
			const mediaAttachments = projectMediaAttachments(envelope.tags, epoch)
			workspaceByDataset.set(dataset, workspace.workspaceId)
			mediaByDataset.set(dataset, mediaAttachments)
			if (epoch !== undefined) epochByRecord.set(dataset, epoch)
			const projected = Object.assign(dataset, {
				mediaAttachments,
				...(epoch !== undefined ? { epoch } : {}),
			}) as ProjectedGeoDataset
			datasets.push(projected)
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
export function projectPrivateWorkspaceComments(workspace: StoredWorkspace): ProjectedGeoComment[] {
	const comments: ProjectedGeoComment[] = []
	for (const envelope of workspace.envelopes) {
		if (envelope.kind !== GEO_COMMENT_KIND) continue
		try {
			const event: NostrEvent = { ...envelope, sig: '0'.repeat(128) }
			const comment = castEvent(event, GeoComment, eventStore)
			const epoch = workspace.envelopeEpochs?.[envelope.id]
			const mediaAttachments = projectMediaAttachments(envelope.tags, epoch)
			mediaByComment.set(comment, mediaAttachments)
			if (epoch !== undefined) epochByRecord.set(comment, epoch)
			const projected = Object.assign(comment, {
				mediaAttachments,
				...(epoch !== undefined ? { epoch } : {}),
			}) as ProjectedGeoComment
			comments.push(projected)
		} catch (error) {
			console.warn('[private-groups] Ignoring invalid encrypted comment', envelope.id, error)
		}
	}
	return comments.sort((a, b) => a.created_at - b.created_at)
}
