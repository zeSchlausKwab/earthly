export type InboxFilter = 'all' | 'replies' | 'proposals'

export type InboxItemKind =
	| 'proposal'
	| 'reply'
	| 'mention'
	| 'atlas-arrival'
	| 'accepted'
	| 'declined'
	| 'follow'
	| 'reaction'
	| 'zap'

export type InboxItemCategory = 'replies' | 'proposals' | 'activity'

export type InboxEntityKind = 'map' | 'atlas' | 'story' | 'sighting' | 'live'

export interface InboxEntityTarget {
	type: 'entity'
	entityKind: InboxEntityKind
	/** Nostr addressable-event coordinate: `<kind>:<pubkey>:<identifier>`. */
	coordinate: string
	tab: 'details' | 'comments' | 'thread'
	commentId?: string
}

export interface InboxPersonTarget {
	type: 'person'
	pubkey: string
}

export type InboxTarget = InboxEntityTarget | InboxPersonTarget

/** A notification derived from already-published Nostr events. */
export interface InboxItem {
	id: string
	eventId: string
	kind: InboxItemKind
	category: InboxItemCategory
	actorPubkey: string
	createdAt: number
	action: string
	thingLabel: string
	preview?: string
	target?: InboxTarget
}

export interface InboxItemWithReadState extends InboxItem {
	read: boolean
}
