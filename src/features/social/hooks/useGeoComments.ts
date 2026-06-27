import { ReactionFactory } from 'applesauce-common/factories'
import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
	deleteComment as deleteCommentEvent,
	GeoComment,
	GeoCommentFactory,
	type GeoCommentEvent,
} from '@/lib/nostr/geo-comment'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GEO_COMMENT_KIND } from '@/lib/nostr/kinds'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { extractReferencedCoordinates, setAddressReferenceTags } from '@/lib/nostr/references'

export interface CommentNode {
	event: GeoComment
	children: CommentNode[]
	depth: number
}

export interface UseGeoCommentsOptions {
	target: GeoDataset | MapContext | Article | null
	maxDepth?: number
}

export interface UseGeoCommentsResult {
	comments: CommentNode[]
	allComments: GeoComment[]
	count: number
	isLoading: boolean
	postComment: (text: string, geojson?: FeatureCollection) => Promise<void>
	postReply: (parentComment: GeoComment, text: string, geojson?: FeatureCollection) => Promise<void>
	deleteComment: (comment: GeoComment) => Promise<void>
	react: (target: GeoDataset | MapContext | Article | GeoComment) => Promise<void>
}

/**
 * Subscribe to NIP-22 comments on a dataset/context, with helpers to post,
 * reply, delete and react.
 */
export function useGeoComments({
	target,
	maxDepth = 10,
}: UseGeoCommentsOptions): UseGeoCommentsResult {
	const [isPosting, setIsPosting] = useState(false)

	const filters = useMemo(() => {
		if (!target) return null
		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag
		if (!targetKind || !targetPubkey || !targetDTag) return null
		const address = `${targetKind}:${targetPubkey}:${targetDTag}`
		return [{ kinds: [GEO_COMMENT_KIND], '#A': [address] }]
	}, [target])

	const { events, eose } = useTimelineWithEose(filters)
	const subscriptionLoading = !eose

	const allComments = useMemo(() => {
		return events
			.filter((event) => event.kind === GEO_COMMENT_KIND)
			.map((event) => castEvent(event, GeoComment, eventStore))
			.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
	}, [events])

	const comments = useMemo(() => {
		const nodeMap = new Map<string, CommentNode>()
		const roots: CommentNode[] = []

		for (const comment of allComments) {
			const nodeId = comment.id ?? comment.commentId ?? ''
			nodeMap.set(nodeId, { event: comment, children: [], depth: 0 })
		}

		for (const comment of allComments) {
			const nodeId = comment.id ?? comment.commentId ?? ''
			const node = nodeMap.get(nodeId)
			if (!node) continue

			if (comment.isReply) {
				const parentId = comment.parentEventId
				const parentNode = parentId ? nodeMap.get(parentId) : null
				if (parentNode) {
					node.depth = Math.min(parentNode.depth + 1, maxDepth)
					parentNode.children.push(node)
				} else {
					// Orphan reply: render as root.
					roots.push(node)
				}
			} else {
				roots.push(node)
			}
		}

		const sortChildren = (nodes: CommentNode[]) => {
			nodes.sort((a, b) => (a.event.created_at ?? 0) - (b.event.created_at ?? 0))
			for (const node of nodes) sortChildren(node.children)
		}

		sortChildren(roots)
		return roots
	}, [allComments, maxDepth])

	const postComment = useCallback(
		async (text: string, geojson?: FeatureCollection) => {
			if (!target) throw new Error('No target')
			const targetKind = target.kind
			const targetPubkey = target.pubkey
			const targetDTag = target.dTag
			if (!targetKind || !targetPubkey || !targetDTag) {
				throw new Error('Target is missing required fields')
			}
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			setIsPosting(true)
			try {
				const address = `${targetKind}:${targetPubkey}:${targetDTag}`
				const referencedCoords = extractReferencedCoordinates(text)
				// Preserve the parent's `a` tag so the threading reference isn't
				// stripped by the rich-text sync.
				const signed = await GeoCommentFactory.root(
					{ text, geojson },
					{ kind: targetKind, address, authorPubkey: targetPubkey },
				)
					.modifyPublicTags(setAddressReferenceTags(referencedCoords, [address]))
					.withDerivedMetadata()
					.sign(signer)
				await publish(signed, { routing: 'outbox' })
			} finally {
				setIsPosting(false)
			}
		},
		[target],
	)

	const postReply = useCallback(
		async (parentComment: GeoComment, text: string, geojson?: FeatureCollection) => {
			if (!target) throw new Error('No target')
			const targetKind = target.kind
			const targetPubkey = target.pubkey
			const targetDTag = target.dTag
			if (!targetKind || !targetPubkey || !targetDTag) {
				throw new Error('Target is missing required fields')
			}
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			setIsPosting(true)
			try {
				const rootAddress = `${targetKind}:${targetPubkey}:${targetDTag}`
				const parentAddress = `${GEO_COMMENT_KIND}:${parentComment.pubkey}:${parentComment.commentId}`
				const referencedCoords = extractReferencedCoordinates(text)
				const signed = await GeoCommentFactory.reply(
					{ text, geojson },
					{
						rootKind: targetKind,
						rootAddress,
						rootPubkey: targetPubkey,
						parent: parentComment.event as GeoCommentEvent,
					},
				)
					// Preserve the parent address so the rich-text sync can't drop it.
					.modifyPublicTags(setAddressReferenceTags(referencedCoords, [parentAddress]))
					.withDerivedMetadata()
					.sign(signer)
				await publish(signed, { routing: 'outbox' })
			} finally {
				setIsPosting(false)
			}
		},
		[target],
	)

	const deleteComment = useCallback(async (comment: GeoComment) => {
		const signer = accounts.signer
		if (!signer) throw new Error('No active account')
		await deleteCommentEvent(comment.event, signer)
	}, [])

	const react = useCallback(async (reactTarget: GeoDataset | MapContext | Article | GeoComment) => {
		const signer = accounts.signer
		if (!signer) throw new Error('No active account')
		// Pull the raw NostrEvent from an applesauce Cast (`.event`) or a
		// legacy NDK subclass (`.rawEvent()`).
		const raw =
			'event' in reactTarget
				? reactTarget.event
				: (reactTarget as { rawEvent: () => NostrEvent }).rawEvent()
		const signed = await ReactionFactory.create(raw, '❤️').sign(signer)
		await publish(signed, { routing: 'outbox' })
	}, [])

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
