import { describe, expect, test } from 'bun:test'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { CommentNode } from '../hooks/useGeoComments'
import { sortCommentThreads } from './commentPresentation'

function node(id: string, created_at: number, children: CommentNode[] = []): CommentNode {
	return { event: { id, commentId: id, created_at } as GeoComment, children, depth: 0 }
}

describe('comment thread presentation', () => {
	test('defaults to newest root conversations while retaining all nested replies', () => {
		const deepReply = node('deep', 4)
		const reply = node('reply', 3, [deepReply])
		const older = node('older', 1, [reply])
		const newer = node('newer', 2)
		const original = [older, newer]
		const sorted = sortCommentThreads(original, 'newest', {})
		expect(sorted.map((entry) => entry.event.commentId)).toEqual(['newer', 'older'])
		expect(original).toEqual([older, newer])
		expect(sorted[1]?.children).toBe(older.children)
		expect(sorted[1]?.children[0]?.children).toEqual([deepReply])
	})

	test('uses the same loaded reaction counts as rows and newest as the tie breaker', () => {
		const original = [node('oldest-liked', 1), node('newer-liked', 2), node('newest', 3)]
		expect(
			sortCommentThreads(original, 'most-liked', {
				'oldest-liked': 4,
				'newer-liked': 4,
			}).map((entry) => entry.event.commentId),
		).toEqual(['newer-liked', 'oldest-liked', 'newest'])
	})

	test('falls back to event IDs for legacy comments without a separate comment ID', () => {
		const liked = node('liked', 1)
		liked.event = { id: 'legacy-event', created_at: 1 } as GeoComment
		const newer = node('newer', 2)
		expect(sortCommentThreads([newer, liked], 'most-liked', { 'legacy-event': 1 })).toEqual([
			liked,
			newer,
		])
	})
})
