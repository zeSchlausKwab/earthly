import { useNDK, useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent } from '@nostr-dev-kit/react'
import { ReactionFactory } from 'applesauce-common/factories'
import type { NostrEvent } from 'nostr-tools'
import { useMemo, useState, useCallback } from 'react'
import { accounts, publish } from '@/lib/nostr'
import { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import { GEO_COMMENT_KIND } from '@/lib/ndk/kinds'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { extractReferencedCoordinates, syncAddressReferenceTags } from '@/lib/ndk/nostrReferences'
import type { FeatureCollection } from 'geojson'

export interface CommentNode {
	event: NDKGeoCommentEvent
	children: CommentNode[]
	depth: number
}

export interface UseGeoCommentsOptions {
	/** The dataset or context to fetch comments for */
	target: GeoDataset | NDKMapContextEvent | null
	/** Maximum depth for nested replies */
	maxDepth?: number
}

export interface UseGeoCommentsResult {
	/** Threaded comment tree */
	comments: CommentNode[]
	/** Flat list of all comments */
	allComments: NDKGeoCommentEvent[]
	/** Total comment count */
	count: number
	/** Loading state */
	isLoading: boolean
	/** Post a new top-level comment */
	postComment: (text: string, geojson?: FeatureCollection) => Promise<void>
	/** Post a reply to an existing comment */
	postReply: (
		parentComment: NDKGeoCommentEvent,
		text: string,
		geojson?: FeatureCollection,
	) => Promise<void>
	/** Delete a comment */
	deleteComment: (comment: NDKGeoCommentEvent) => Promise<void>
	/** React to a comment or the target */
	react: (target: GeoDataset | NDKMapContextEvent | NDKGeoCommentEvent) => Promise<void>
}

/**
 * Hook for fetching and managing comments on geo datasets and contexts.
 */
export function useGeoComments({
	target,
	maxDepth = 10,
}: UseGeoCommentsOptions): UseGeoCommentsResult {
	const { ndk } = useNDK()
	const [isPosting, setIsPosting] = useState(false)

	// Build the filter for comments on this target
	const filters = useMemo(() => {
		if (!target) return []

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag

		if (!targetKind || !targetPubkey || !targetDTag) return []

		const address = `${targetKind}:${targetPubkey}:${targetDTag}`

		return [
			{
				kinds: [GEO_COMMENT_KIND],
				'#A': [address],
			},
		]
	}, [target])

	const { events, eose } = useSubscribe(filters)
	const subscriptionLoading = !eose

	// Convert events to NDKGeoCommentEvent instances
	const allComments = useMemo(() => {
		return events
			.filter((e: NDKEvent) => e.kind === GEO_COMMENT_KIND)
			.map((e: NDKEvent) => NDKGeoCommentEvent.from(e))
			.sort(
				(a: NDKGeoCommentEvent, b: NDKGeoCommentEvent) => (a.created_at ?? 0) - (b.created_at ?? 0),
			)
	}, [events])

	// Build threaded tree
	const comments = useMemo(() => {
		const nodeMap = new Map<string, CommentNode>()
		const roots: CommentNode[] = []

		// Create nodes for all comments
		for (const comment of allComments) {
			const nodeId = comment.id ?? comment.commentId ?? ''
			nodeMap.set(nodeId, {
				event: comment,
				children: [],
				depth: 0,
			})
		}

		// Build tree structure
		for (const comment of allComments) {
			const nodeId = comment.id ?? comment.commentId ?? ''
			const node = nodeMap.get(nodeId)
			if (!node) continue

			if (comment.isReply) {
				// Find parent by event ID
				const parentId = comment.parentEventId
				const parentNode = parentId ? nodeMap.get(parentId) : null

				if (parentNode) {
					node.depth = Math.min(parentNode.depth + 1, maxDepth)
					parentNode.children.push(node)
				} else {
					// Orphaned reply - treat as root
					roots.push(node)
				}
			} else {
				// Top-level comment
				roots.push(node)
			}
		}

		// Sort children by timestamp
		const sortChildren = (nodes: CommentNode[]) => {
			nodes.sort((a, b) => (a.event.created_at ?? 0) - (b.event.created_at ?? 0))
			for (const node of nodes) {
				sortChildren(node.children)
			}
		}

		sortChildren(roots)

		return roots
	}, [allComments, maxDepth])

	const postComment = useCallback(
		async (text: string, geojson?: FeatureCollection) => {
			if (!ndk || !target) {
				throw new Error('NDK or target not available')
			}

			const targetKind = target.kind
			const targetPubkey = target.pubkey
			const targetDTag = target.dTag

			if (!targetKind || !targetPubkey || !targetDTag) {
				throw new Error('Target is missing required fields')
			}

			setIsPosting(true)
			try {
				const comment = new NDKGeoCommentEvent(ndk)
				comment.commentContent = { text, geojson }

				const address = `${targetKind}:${targetPubkey}:${targetDTag}`
				comment.setRootScope(targetKind, address, targetPubkey)
				syncAddressReferenceTags(
					comment,
					extractReferencedCoordinates(text),
					comment.parentAddress ? [comment.parentAddress] : [],
				)

				await comment.publishComment()
			} finally {
				setIsPosting(false)
			}
		},
		[ndk, target],
	)

	const postReply = useCallback(
		async (parentComment: NDKGeoCommentEvent, text: string, geojson?: FeatureCollection) => {
			if (!ndk || !target) {
				throw new Error('NDK or target not available')
			}

			const targetKind = target.kind
			const targetPubkey = target.pubkey
			const targetDTag = target.dTag

			if (!targetKind || !targetPubkey || !targetDTag) {
				throw new Error('Target is missing required fields')
			}

			setIsPosting(true)
			try {
				const reply = new NDKGeoCommentEvent(ndk)
				reply.commentContent = { text, geojson }

				const rootAddress = `${targetKind}:${targetPubkey}:${targetDTag}`
				reply.setReplyScope(targetKind, rootAddress, targetPubkey, parentComment)
				syncAddressReferenceTags(
					reply,
					extractReferencedCoordinates(text),
					reply.parentAddress ? [reply.parentAddress] : [],
				)

				await reply.publishComment()
			} finally {
				setIsPosting(false)
			}
		},
		[ndk, target],
	)

	const deleteComment = useCallback(
		async (comment: NDKGeoCommentEvent) => {
			if (!ndk) {
				throw new Error('NDK not available')
			}
			await NDKGeoCommentEvent.deleteComment(ndk, comment)
		},
		[ndk],
	)

	const react = useCallback(
		async (reactTarget: GeoDataset | NDKMapContextEvent | NDKGeoCommentEvent) => {
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			// Pull the raw NostrEvent shape from either an applesauce Cast (`.event`)
			// or a legacy NDK subclass (`.rawEvent()`).
			const raw =
				'event' in reactTarget
					? reactTarget.event
					: (reactTarget as { rawEvent: () => NostrEvent }).rawEvent()
			const signed = await ReactionFactory.create(raw, '❤️').sign(signer)
			await publish(signed, { routing: 'outbox' })
		},
		[],
	)

	return {
		comments,
		allComments,
		count: allComments.length,
		isLoading: subscriptionLoading || isPosting,
		postComment,
		postReply,
		deleteComment,
		react,
	}
}
