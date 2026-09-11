import type { EntitySearchResult, EntityType } from '@/components/entity-search/types'
import type { ChatReference } from '@/features/chat/store'
import type { ThreadWorkTarget } from '@/features/chat/workingSet'
import { nip19 } from 'nostr-tools'
import {
	GEO_EVENT_KIND,
	ARTICLE_KIND,
	MAP_CONTEXT_KIND,
	LIVE_BEACON_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'

export type EntityTransfer = ChatReference & { workTarget?: ThreadWorkTarget }
type ConversationContext = { chatId: string | null; pubkey: string | null }
let conversationContext: (() => ConversationContext) | undefined
export function registerEntityConversationContext(reader: () => ConversationContext) {
	conversationContext = reader
}
export const getEntityConversationContext = () => conversationContext?.() ?? null
const kinds: Partial<Record<EntityType, number>> = {
	dataset: GEO_EVENT_KIND,
	story: ARTICLE_KIND,
	context: MAP_CONTEXT_KIND,
	beacon: LIVE_BEACON_KIND,
	sighting: TEMPORAL_SIGHTING_KIND,
}

export function transferFromResult(result: EntitySearchResult): EntityTransfer {
	const entity = result.entity as { dTag?: string; featureId?: string }
	let address = result.address
	if (!address && kinds[result.type] && result.pubkey && entity?.dTag) {
		address = nip19.naddrEncode({
			kind: kinds[result.type]!,
			pubkey: result.pubkey,
			identifier: entity.dTag,
		})
	}
	return {
		id: result.id,
		type: result.type,
		name: result.name,
		subtitle: result.subtitle,
		address,
		featureId: result.featureId ?? (result.type === 'feature' ? entity?.featureId : undefined),
		localWorkspaceId: result.localWorkspaceId,
		localStoryDraftKey: result.localStoryDraftKey,
		pubkey: result.pubkey,
		createdAt: result.createdAt,
	}
}

export function transferFromTarget(target: ThreadWorkTarget): EntityTransfer {
	return {
		id: target.id,
		name: target.title,
		type: target.kind,
		localWorkspaceId: target.kind === 'dataset' ? target.workspaceId : undefined,
		localStoryDraftKey: target.kind === 'story' ? target.draftKey : undefined,
		address: target.kind === 'story' ? target.storyReference?.replace(/^nostr:/, '') : undefined,
		workTarget: target,
	}
}

// Only same-document gestures can grant permissions. Do not trust arbitrary
// JSON dropped from another website, or put private geometry in DataTransfer.
export const ENTITY_TRANSFER_MIME = 'application/x-earthly-entity'
let dragging: { token: string; item: EntityTransfer; pubkey: string | null } | null = null
const listeners = new Set<() => void>()
export const getEntityDrag = () => dragging
export function subscribeEntityDrag(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
export function startEntityDrag(data: DataTransfer, item: EntityTransfer) {
	dragging = {
		token: crypto.randomUUID(),
		item,
		pubkey: getEntityConversationContext()?.pubkey ?? null,
	}
	data.setData(ENTITY_TRANSFER_MIME, dragging.token)
	data.effectAllowed = 'copyMove'
	for (const listener of listeners) listener()
}
export function endEntityDrag() {
	dragging = null
	for (const listener of listeners) listener()
}
export function readEntityDrop(data: DataTransfer): EntityTransfer | null {
	return dragging &&
		data.getData(ENTITY_TRANSFER_MIME) === dragging.token &&
		dragging.pubkey === (getEntityConversationContext()?.pubkey ?? null)
		? dragging.item
		: null
}
