import type { CountState } from 'applesauce-loaders/loaders/count-service'
import { useEffect, useRef, useState } from 'react'
import { socialCounts } from '@/lib/nostr'
import {
	earthlyCommentMetric,
	earthlyReactionMetric,
	socialCountTarget,
} from '@/lib/nostr/socialCounts'
import { unwrapReactableEvent, type ReactableEvent } from './useGeoReactions'

/** Visibility releases COUNT demand; it never starts a full-history fallback. */
export function useVisibleSocialCounts(
	target: ReactableEvent,
	enabled: boolean,
	comments: boolean,
) {
	const ref = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	const raw = unwrapReactableEvent(target)
	const countTarget = socialCountTarget(raw)
	const key = countTarget.address ?? countTarget.id
	const [snapshot, setSnapshot] = useState<{
		key: string
		reactions?: CountState
		comments?: CountState
	}>({ key })
	useEffect(() => {
		if (!enabled || !ref.current) return
		if (typeof IntersectionObserver === 'undefined') {
			setVisible(true)
			return
		}
		const observer = new IntersectionObserver((entries) =>
			setVisible(entries.some((entry) => entry.isIntersecting)),
		)
		observer.observe(ref.current)
		return () => observer.disconnect()
	}, [enabled])
	// biome-ignore lint/correctness/useExhaustiveDependencies: Stable address is the metric identity; revisions keep the same demand.
	useEffect(() => {
		if (!enabled || !visible) return
		const update = (metric: 'reactions' | 'comments', state: CountState) =>
			setSnapshot((previous) => ({
				...(previous.key === key ? previous : { key }),
				[metric]: state,
			}))
		const reactions = socialCounts
			.observe(countTarget, earthlyReactionMetric)
			.subscribe((state) => update('reactions', state))
		const discussion = comments
			? socialCounts
					.observe(countTarget, earthlyCommentMetric)
					.subscribe((state) => update('comments', state))
			: undefined
		return () => {
			reactions.unsubscribe()
			discussion?.unsubscribe()
		}
	}, [key, enabled, visible, comments])
	return {
		ref,
		reactions: snapshot.key === key ? snapshot.reactions : undefined,
		comments: snapshot.key === key ? snapshot.comments : undefined,
	}
}

export function describeCount(state: CountState | undefined): string {
	if (state?.value === undefined) return 'Count unavailable'
	return `${state.approximate ? 'Approximate count' : 'Count'} from ${state.origin?.relay ?? 'relay'}${state.fresh ? '' : ' (refreshing)'}.`
}
