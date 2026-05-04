import {  } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import { ReactionFactory } from 'applesauce-common/factories'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import { accounts, publish } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'

/** Any Nostr event that can receive reactions */
export type ReactableEvent = GeoDataset | MapContext | GeoComment | NostrEvent

export interface UseGeoReactionsOptions {
	/** The event to fetch reactions for */
	target: ReactableEvent | null
}

export interface UseGeoReactionsResult {
	/** Total reaction count */
	reactionCount: number
	/** Total zap count */
	zapCount: number
	/** Total zap amount in sats */
	zapAmount: number
	/** Whether the current user has reacted */
	userHasReacted: boolean
	/** Whether the current user has zapped */
	userHasZapped: boolean
	/** Loading state */
	isLoading: boolean
	/** Toggle reaction (add if not reacted, would need delete support for removal) */
	toggleReaction: () => Promise<void>
	/** Open zap dialog (mock for now) */
	openZapDialog: () => void
	/** Zap dialog open state */
	zapDialogOpen: boolean
	/** Close zap dialog */
	closeZapDialog: () => void
}

/**
 * Hook for fetching and managing reactions and zaps on geo events.
 */
export function useGeoReactions({ target }: UseGeoReactionsOptions): UseGeoReactionsResult {
	const currentUser = useActiveAccount()
	const [zapDialogOpen, setZapDialogOpen] = useState(false)
	const [isReacting, setIsReacting] = useState(false)

	// Check if target is an addressable event (has dTag)
	const isAddressable = useMemo(() => {
		if (!target) return false
		return 'dTag' in target && !!target.dTag
	}, [target])

	// Build the address for addressable events
	const targetAddress = useMemo(() => {
		if (!target || !isAddressable) return null

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = (target as { dTag?: string }).dTag

		if (!targetKind || !targetPubkey || !targetDTag) return null

		return `${targetKind}:${targetPubkey}:${targetDTag}`
	}, [target, isAddressable])

	// Build filter for reactions (kind 7)
	// Use #a tag for addressable events, #e tag for regular events
	const reactionFilters = useMemo(() => {
		if (!target?.id && !targetAddress) return []

		if (isAddressable && targetAddress) {
			return [
				{
					kinds: [7 as number],
					'#a': [targetAddress],
				},
			]
		}

		// Regular event - use #e tag
		if (target?.id) {
			return [
				{
					kinds: [7 as number],
					'#e': [target.id],
				},
			]
		}

		return []
	}, [target?.id, targetAddress, isAddressable])

	// Build filter for zaps (kind 9735)
	const zapFilters = useMemo(() => {
		if (!target?.id && !targetAddress) return []

		if (isAddressable && targetAddress) {
			return [
				{
					kinds: [9735 as number],
					'#a': [targetAddress],
				},
			]
		}

		// Regular event - use #e tag
		if (target?.id) {
			return [
				{
					kinds: [9735 as number],
					'#e': [target.id],
				},
			]
		}

		return []
	}, [target?.id, targetAddress, isAddressable])

	const { events: reactionEvents, eose: reactionsEose } = useTimelineWithEose(
		reactionFilters.length ? reactionFilters : null,
	)
	const { events: zapEvents, eose: zapsEose } = useTimelineWithEose(
		zapFilters.length ? zapFilters : null,
	)
	const reactionsLoading = !reactionsEose
	const zapsLoading = !zapsEose

	const reactionCount = reactionEvents.length

	const userHasReacted = useMemo(() => {
		if (!currentUser?.pubkey) return false
		return reactionEvents.some((e) => e.pubkey === currentUser.pubkey)
	}, [reactionEvents, currentUser?.pubkey])

	const { zapCount, zapAmount, userHasZapped } = useMemo(() => {
		let total = 0
		let hasZapped = false

		for (const zap of zapEvents) {
			const bolt11 = zap.tags.find((t) => t[0] === 'bolt11')?.[1]
			if (bolt11) {
				// Placeholder amount; production code would decode the bolt11 invoice.
				total += 1000
			}
			const descTag = zap.tags.find((t) => t[0] === 'description')?.[1]
			if (descTag && currentUser?.pubkey) {
				try {
					const desc = JSON.parse(descTag)
					if (desc.pubkey === currentUser.pubkey) hasZapped = true
				} catch {
					// ignore parse errors
				}
			}
		}

		return {
			zapCount: zapEvents.length,
			zapAmount: total,
			userHasZapped: hasZapped,
		}
	}, [zapEvents, currentUser?.pubkey])

	const toggleReaction = useCallback(async () => {
		if (!target || !currentUser) {
			throw new Error('Target or user not available')
		}
		if (userHasReacted) {
			// Reactions aren't toggleable without a follow-up deletion event.
			return
		}
		const signer = accounts.signer
		if (!signer) throw new Error('No active account')

		setIsReacting(true)
		try {
			// Pull the raw NostrEvent regardless of source (Cast, NDK subclass, raw).
			const raw =
				'event' in target && (target as { event: NostrEvent }).event
					? (target as { event: NostrEvent }).event
					: typeof (target as { rawEvent?: () => NostrEvent }).rawEvent === 'function'
						? (target as { rawEvent: () => NostrEvent }).rawEvent()
						: (target as NostrEvent)
			const signed = await ReactionFactory.create(raw, '❤️').sign(signer)
			await publish(signed, { routing: 'outbox' })
		} finally {
			setIsReacting(false)
		}
	}, [target, currentUser, userHasReacted])

	const openZapDialog = useCallback(() => {
		setZapDialogOpen(true)
	}, [])

	const closeZapDialog = useCallback(() => {
		setZapDialogOpen(false)
	}, [])

	return {
		reactionCount,
		zapCount,
		zapAmount,
		userHasReacted,
		userHasZapped,
		isLoading: reactionsLoading || zapsLoading || isReacting,
		toggleReaction,
		openZapDialog,
		zapDialogOpen,
		closeZapDialog,
	}
}
