import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { buildInboxFilters, deriveInboxItems } from './deriveInbox'
import {
	inboxReadStorageKey,
	isInboxItemRead,
	markInboxAllRead,
	markInboxItemRead,
	parseInboxReadState,
	type InboxReadStateV1,
} from './readState'
import type { InboxItemWithReadState } from './types'

export interface UseInboxFeedOptions {
	currentUserPubkey?: string
	geoEvents: readonly GeoDataset[]
	mapContextEvents: readonly MapContext[]
	getDatasetName: (event: GeoDataset) => string
}

export interface UseInboxFeedResult {
	items: InboxItemWithReadState[]
	unreadCount: number
	isLoading: boolean
	markRead: (id: string) => void
	markAllRead: () => void
}

function loadReadState(pubkey: string | undefined): InboxReadStateV1 {
	if (!pubkey || typeof window === 'undefined') return parseInboxReadState(null)
	try {
		return parseInboxReadState(window.localStorage.getItem(inboxReadStorageKey(pubkey)))
	} catch {
		return parseInboxReadState(null)
	}
}

function saveReadState(pubkey: string | undefined, state: InboxReadStateV1): void {
	if (!pubkey || typeof window === 'undefined') return
	try {
		window.localStorage.setItem(inboxReadStorageKey(pubkey), JSON.stringify(state))
	} catch {
		// Private browsing and storage quotas must not make the Inbox unusable.
	}
}

/** Reactive, event-derived Inbox plus account-scoped local read state. */
export function useInboxFeed({
	currentUserPubkey,
	geoEvents,
	mapContextEvents,
	getDatasetName,
}: UseInboxFeedOptions): UseInboxFeedResult {
	const ownedAtlasCoordinates = useMemo(
		() =>
			mapContextEvents
				.filter((context) => context.pubkey === currentUserPubkey)
				.map((context) => context.contextCoordinate)
				.filter((coordinate): coordinate is string => Boolean(coordinate)),
		[currentUserPubkey, mapContextEvents],
	)
	const filters = useMemo(
		() => buildInboxFilters(currentUserPubkey, ownedAtlasCoordinates),
		[currentUserPubkey, ownedAtlasCoordinates],
	)
	const { events, eose } = useTimelineWithEose(filters)
	const derivedItems = useMemo(
		() =>
			currentUserPubkey
				? deriveInboxItems({
						currentUserPubkey,
						events,
						geoEvents,
						mapContextEvents,
						getDatasetName,
					})
				: [],
		[currentUserPubkey, events, geoEvents, mapContextEvents, getDatasetName],
	)
	const [readState, setReadState] = useState<InboxReadStateV1>(() =>
		loadReadState(currentUserPubkey),
	)
	const readStateRef = useRef(readState)

	useEffect(() => {
		const next = loadReadState(currentUserPubkey)
		readStateRef.current = next
		setReadState(next)
	}, [currentUserPubkey])

	const updateReadState = useCallback(
		(update: (current: InboxReadStateV1) => InboxReadStateV1) => {
			const next = update(readStateRef.current)
			readStateRef.current = next
			saveReadState(currentUserPubkey, next)
			setReadState(next)
		},
		[currentUserPubkey],
	)

	const items = useMemo(
		() => derivedItems.map((item) => ({ ...item, read: isInboxItemRead(readState, item) })),
		[derivedItems, readState],
	)
	const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items])
	const markRead = useCallback(
		(id: string) => updateReadState((current) => markInboxItemRead(current, id)),
		[updateReadState],
	)
	const markAllRead = useCallback(
		() => updateReadState((current) => markInboxAllRead(current, derivedItems)),
		[derivedItems, updateReadState],
	)

	return {
		items,
		unreadCount,
		isLoading: Boolean(currentUserPubkey) && !eose,
		markRead,
		markAllRead,
	}
}
