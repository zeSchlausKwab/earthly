import { useEffect, useRef, useSyncExternalStore } from 'react'
import { accounts } from '@/lib/nostr'
import { clearDraftReview, getDraftReviewRequest, subscribeDraftReview } from '../draftActions'

/** Focus the existing publisher; never submit on behalf of a list action. */
export function useDraftPublishReview(key: string, onReview?: () => void) {
	const ref = useRef<HTMLButtonElement>(null)
	const request = useSyncExternalStore(
		subscribeDraftReview,
		getDraftReviewRequest,
		getDraftReviewRequest,
	)
	useEffect(() => {
		if (
			!request ||
			request.key !== key ||
			request.action !== 'publish' ||
			request.owner !== accounts.active?.pubkey
		)
			return
		const button = ref.current
		if (!button || !button.getClientRects().length) return
		clearDraftReview(request)
		button.scrollIntoView({ block: 'nearest' })
		button.focus({ preventScroll: true })
		onReview?.()
	}, [request, key, onReview])
	return ref
}
