import { useActiveAccount } from 'applesauce-react/hooks'
import { ReactionFactory } from 'applesauce-common/factories'
import { DeleteFactory } from 'applesauce-core/factories'
import { getNutzapAmount, NUTZAP_KIND } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { accounts, publish } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'

interface ReactableEventCast {
	readonly event: NostrEvent
	readonly kind: number
	readonly pubkey: string
	readonly id?: string
	readonly dTag?: string
	readonly tags?: string[][]
	rawEvent?: () => NostrEvent
}

/** Any Nostr event that can receive reactions */
export type ReactableEvent =
	| GeoDataset
	| MapContext
	| Article
	| TemporalSighting
	| LiveBeacon
	| GeoComment
	| ReactableEventCast
	| NostrEvent

function unwrapReactableEvent(target: ReactableEvent): NostrEvent {
	const wrapped = (target as { event?: NostrEvent }).event
	if (wrapped) return wrapped
	const rawEvent = (target as { rawEvent?: () => NostrEvent }).rawEvent
	return typeof rawEvent === 'function' ? rawEvent() : (target as NostrEvent)
}

function getReactableDTag(target: ReactableEvent): string | undefined {
	return (
		(target as { dTag?: string }).dTag ??
		unwrapReactableEvent(target).tags.find((tag) => tag[0] === 'd')?.[1]
	)
}

export interface UseGeoReactionsOptions {
	/** The event to fetch reactions for */
	target: ReactableEvent | null
	/** Whether to subscribe to reaction/zap counts. Disable in dense lists. */
	loadCounts?: boolean
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
	/** Toggle the current user's reaction. */
	toggleReaction: () => Promise<void>
	/** Open the zap dialog. */
	openZapDialog: () => void
	/** Zap dialog open state */
	zapDialogOpen: boolean
	/** Close zap dialog */
	closeZapDialog: () => void
}

/**
 * Hook for fetching and managing reactions and zaps on geo events.
 */
export function useGeoReactions({
	target,
	loadCounts = true,
}: UseGeoReactionsOptions): UseGeoReactionsResult {
	const currentUser = useActiveAccount()
	const [zapDialogOpen, setZapDialogOpen] = useState(false)
	const [isReacting, setIsReacting] = useState(false)
	const [optimisticReaction, setOptimisticReaction] = useState<NostrEvent | null>(null)
	const [suppressedReactionId, setSuppressedReactionId] = useState<string | null>(null)

	// Check if target is an addressable event (has dTag)
	const isAddressable = useMemo(() => {
		if (!target) return false
		return Boolean(getReactableDTag(target))
	}, [target])

	// Build the address for addressable events
	const targetAddress = useMemo(() => {
		if (!target || !isAddressable) return null

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = getReactableDTag(target)

		if (!targetKind || !targetPubkey || !targetDTag) return null

		return `${targetKind}:${targetPubkey}:${targetDTag}`
	}, [target, isAddressable])

	// Build filter for reactions (kind 7)
	// Use #a tag for addressable events, #e tag for regular events
	const reactionFilters = useMemo(() => {
		if (!loadCounts) return []
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
	}, [target?.id, targetAddress, isAddressable, loadCounts])

	// Build filter for zaps (kind 9735)
	const zapFilters = useMemo(() => {
		if (!loadCounts) return []
		if (!target?.id && !targetAddress) return []

		if (isAddressable && targetAddress) {
			return [
				{
					kinds: [9735 as number, NUTZAP_KIND],
					'#a': [targetAddress],
				},
			]
		}

		// Regular event - use #e tag
		if (target?.id) {
			return [
				{
					kinds: [9735 as number, NUTZAP_KIND],
					'#e': [target.id],
				},
			]
		}

		return []
	}, [target?.id, targetAddress, isAddressable, loadCounts])

	const { events: reactionEvents, eose: reactionsEose } = useTimelineWithEose(
		reactionFilters.length ? reactionFilters : null,
	)
	const { events: zapEvents, eose: zapsEose } = useTimelineWithEose(
		zapFilters.length ? zapFilters : null,
	)
	const reactionsLoading = loadCounts && !reactionsEose
	const zapsLoading = loadCounts && !zapsEose

	const currentUserReaction = useMemo(() => {
		if (!currentUser?.pubkey) return undefined
		return reactionEvents.find(
			(event) => event.pubkey === currentUser.pubkey && event.id !== suppressedReactionId,
		)
	}, [currentUser?.pubkey, reactionEvents, suppressedReactionId])
	const hasOptimisticReaction = Boolean(
		optimisticReaction &&
			optimisticReaction.id !== suppressedReactionId &&
			!reactionEvents.some((event) => event.id === optimisticReaction.id),
	)
	const userHasReacted = Boolean(currentUserReaction || hasOptimisticReaction)
	const reactionCount =
		reactionEvents.filter((event) => event.id !== suppressedReactionId).length +
		(hasOptimisticReaction ? 1 : 0)

	const targetKey = targetAddress ?? target?.id ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: changing account or target must clear row-local optimistic state.
	useEffect(() => {
		setOptimisticReaction(null)
		setSuppressedReactionId(null)
	}, [currentUser?.pubkey, targetKey])

	const { zapCount, zapAmount, userHasZapped } = useMemo(() => {
		let total = 0
		let hasZapped = false

		for (const zap of zapEvents) {
			if (zap.kind === NUTZAP_KIND) {
				total += getNutzapAmount(zap) ?? 0
				if (zap.pubkey === currentUser?.pubkey) hasZapped = true
				continue
			}
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
			const existingReaction = currentUserReaction ?? optimisticReaction
			if (existingReaction && existingReaction.id !== suppressedReactionId) {
				setOptimisticReaction(null)
				setSuppressedReactionId(existingReaction.id)
				try {
					const deletion = await DeleteFactory.fromEvents([existingReaction]).sign(signer)
					await publish(deletion, { routing: 'outbox' })
				} catch (error) {
					setSuppressedReactionId(null)
					if (existingReaction === optimisticReaction) setOptimisticReaction(existingReaction)
					throw error
				}
			} else {
				const signed = await ReactionFactory.create(raw, '❤️').sign(signer)
				setSuppressedReactionId(null)
				setOptimisticReaction(signed)
				try {
					await publish(signed, { routing: 'outbox' })
				} catch (error) {
					setOptimisticReaction(null)
					throw error
				}
			}
		} finally {
			setIsReacting(false)
		}
	}, [currentUser, currentUserReaction, optimisticReaction, suppressedReactionId, target])

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
