import type { CommentNode } from '../hooks/useGeoComments'

export type CommentSort = 'newest' | 'most-liked'

/** Reorder root conversations without changing reply order or the underlying tree. */
export function sortCommentThreads(
	comments: CommentNode[],
	sort: CommentSort,
	reactionCounts: Readonly<Record<string, number>>,
): CommentNode[] {
	return [...comments].sort((left, right) => {
		if (sort === 'most-liked') {
			const leftId = left.event.id ?? left.event.commentId ?? ''
			const rightId = right.event.id ?? right.event.commentId ?? ''
			const difference = (reactionCounts[rightId] ?? 0) - (reactionCounts[leftId] ?? 0)
			if (difference !== 0) return difference
		}
		return (right.event.created_at ?? 0) - (left.event.created_at ?? 0)
	})
}
