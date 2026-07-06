import { CommentFactory, ReactionFactory } from 'applesauce-common/factories'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import { accounts, publish } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import type { CommentNode } from './types'

interface UseShoutboxCommentsOptions {
	/** The root event (kind 1) to fetch NIP-22 comments for */
	rootEvent: NostrEvent | null
	/** Maximum depth for nested replies */
	maxDepth?: number
}

interface UseShoutboxCommentsResult {
	comments: CommentNode[]
	allComments: NostrEvent[]
	count: number
	isLoading: boolean
	postComment: (content: string) => Promise<void>
	postReply: (parentComment: NostrEvent, content: string) => Promise<void>
	react: (target: NostrEvent) => Promise<void>
}

/**
 * NIP-22 comments (kind 1111) on a kind 1 root post — fetch + post + react.
 */
export function useShoutboxComments({
	rootEvent,
	maxDepth = 10,
}: UseShoutboxCommentsOptions): UseShoutboxCommentsResult {
	const [isPosting, setIsPosting] = useState(false)

	const filters = useMemo(() => {
		if (!rootEvent?.id) return null
		return [{ kinds: [1111], '#E': [rootEvent.id], limit: 100 }]
	}, [rootEvent?.id])

	const { events, eose } = useTimelineWithEose(filters)
	const subscriptionLoading = !eose

	const allComments = useMemo(
		() => [...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)),
		[events],
	)

	const comments = useMemo(() => {
		const nodeMap = new Map<string, CommentNode>()
		const roots: CommentNode[] = []

		for (const comment of allComments) {
			nodeMap.set(comment.id, { event: comment, children: [], depth: 0 })
		}

		for (const comment of allComments) {
			const node = nodeMap.get(comment.id)
			if (!node) continue
			// Reply if there's a lowercase `e` parent and `k` says 1111.
			const parentTag = comment.tags.find((t) => t[0] === 'e' && t[3] !== 'root')
			const parentKind = comment.tags.find((t) => t[0] === 'k')?.[1]
			if (parentTag && parentKind === '1111') {
				const parentNode = parentTag[1] ? nodeMap.get(parentTag[1]) : null
				if (parentNode) {
					node.depth = Math.min(parentNode.depth + 1, maxDepth)
					parentNode.children.push(node)
				} else {
					roots.push(node)
				}
			} else {
				roots.push(node)
			}
		}

		const sortChildren = (nodes: CommentNode[]) => {
			nodes.sort((a, b) => (a.event.created_at ?? 0) - (b.event.created_at ?? 0))
			for (const n of nodes) sortChildren(n.children)
		}
		sortChildren(roots)
		return roots
	}, [allComments, maxDepth])

	const postComment = useCallback(
		async (content: string) => {
			if (!rootEvent) throw new Error('No root event')
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')
			setIsPosting(true)
			try {
				const signed = await CommentFactory.create(rootEvent, content).sign(signer)
				await publish(signed, { routing: 'inbox', target: rootEvent.pubkey })
			} finally {
				setIsPosting(false)
			}
		},
		[rootEvent],
	)

	const postReply = useCallback(
		async (parentComment: NostrEvent, content: string) => {
			if (!rootEvent) throw new Error('No root event')
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')
			setIsPosting(true)
			try {
				const signed = await CommentFactory.reply(parentComment, content).sign(signer)
				await publish(signed, { routing: 'inbox', target: parentComment.pubkey })
			} finally {
				setIsPosting(false)
			}
		},
		[rootEvent],
	)

	const react = useCallback(async (target: NostrEvent) => {
		const signer = accounts.signer
		if (!signer) throw new Error('No active account')
		const signed = await ReactionFactory.create(target, '❤️').sign(signer)
		await publish(signed, { routing: 'outbox' })
	}, [])

	return {
		comments,
		allComments,
		count: allComments.length,
		isLoading: subscriptionLoading || isPosting,
		postComment,
		postReply,
		react,
	}
}
