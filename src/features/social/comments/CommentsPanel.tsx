import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import { useGeoComments } from '../hooks/useGeoComments'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { GeoCommentItem } from './GeoCommentItem'
import { GeoCommentForm } from './GeoCommentForm'
import { GeoSocialActions } from './GeoSocialActions'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'

const ROOT_COMPOSER_ID = 'root'

interface CommentsPanelProps {
	/** The dataset, context, or Story to show comments for */
	target: GeoDataset | MapContext | Article | null
	/** Callback when a comment's GeoJSON visibility is toggled */
	onCommentGeojsonVisibilityChange?: (comment: GeoComment, visible: boolean) => void
	/** Callback to zoom to a comment's GeoJSON */
	onZoomToCommentGeojson?: (comment: GeoComment) => void
	/** Callback when a mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	/** Set of comment IDs whose GeoJSON is currently visible */
	visibleGeojsonCommentIds?: Set<string>
	/** Optional GeoJSON to attach to new comments (e.g., from editor selection) */
	attachedGeojson?: FeatureCollection | null
	/** Callback to clear attached GeoJSON */
	onClearAttachment?: () => void
	/** Available features for $ mentions in the comment form */
	availableFeatures?: GeoFeatureItem[]
	/** Optional comment d-tag to scroll to when the thread loads */
	focusCommentId?: string
	className?: string
}

/**
 * Panel displaying comments for a geo dataset or context.
 * Includes:
 * - Social actions for the target (reactions, zaps)
 * - Comment form for new comments
 * - Threaded comment list
 */
export function CommentsPanel({
	target,
	onCommentGeojsonVisibilityChange,
	onZoomToCommentGeojson,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	visibleGeojsonCommentIds = new Set(),
	attachedGeojson,
	onClearAttachment,
	availableFeatures = [],
	focusCommentId,
	className = '',
}: CommentsPanelProps) {
	const { comments, allComments, count, isLoading, postComment, postReply } = useGeoComments({
		target,
	})

	const [activeComposerId, setActiveComposerId] = useState<string>(ROOT_COMPOSER_ID)
	const [entityAnnotationsVisible, setEntityAnnotationsVisible] = useState(true)
	const initializedCommentIdsRef = useRef<Set<string>>(new Set())
	const commentsListRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setActiveComposerId(ROOT_COMPOSER_ID)
		setEntityAnnotationsVisible(true)
		initializedCommentIdsRef.current = new Set()
	}, [target?.id, target?.dTag])

	const commentsWithGeometry = useMemo(
		() => allComments.filter((comment) => (comment.geojson?.features.length ?? 0) > 0),
		[allComments],
	)

	const handlePostComment = useCallback(
		async (text: string, geojson?: FeatureCollection) => {
			await postComment(text, geojson)
			toast.success('Comment posted!')
			window.requestAnimationFrame(() => {
				if (commentsListRef.current) {
					commentsListRef.current.scrollTop = commentsListRef.current.scrollHeight
				}
			})
		},
		[postComment],
	)

	const handlePostReply = useCallback(
		async (parentComment: GeoComment, text: string, geojson?: FeatureCollection) => {
			await postReply(parentComment, text, geojson)
		},
		[postReply],
	)

	const handleComposerTargetChange = useCallback(
		(nextComposerId: string) => {
			if (activeComposerId === ROOT_COMPOSER_ID && nextComposerId !== ROOT_COMPOSER_ID) {
				onClearAttachment?.()
			}
			setActiveComposerId(nextComposerId)
		},
		[activeComposerId, onClearAttachment],
	)

	useEffect(() => {
		if (!onCommentGeojsonVisibilityChange || !entityAnnotationsVisible) return

		for (const comment of commentsWithGeometry) {
			const commentId = comment.commentId ?? comment.id ?? ''
			if (!commentId || initializedCommentIdsRef.current.has(commentId)) continue

			initializedCommentIdsRef.current.add(commentId)
			onCommentGeojsonVisibilityChange(comment, true)
		}
	}, [commentsWithGeometry, entityAnnotationsVisible, onCommentGeojsonVisibilityChange])

	const handleToggleEntityAnnotations = useCallback(() => {
		if (!onCommentGeojsonVisibilityChange) return

		const nextVisible = !entityAnnotationsVisible
		setEntityAnnotationsVisible(nextVisible)

		for (const comment of commentsWithGeometry) {
			const commentId = comment.commentId ?? comment.id ?? ''
			if (!commentId) continue
			initializedCommentIdsRef.current.add(commentId)
			onCommentGeojsonVisibilityChange(comment, nextVisible)
		}
	}, [commentsWithGeometry, entityAnnotationsVisible, onCommentGeojsonVisibilityChange])

	if (!target) {
		return (
			<div className={`p-4 text-center text-sm text-gray-500 ${className}`}>
				Select a dataset or context to view comments.
			</div>
		)
	}

	return (
		<div className={`flex h-full flex-col ${className}`}>
			<div className="mb-2 flex-shrink-0 border-b border-stone-200 pb-2">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<GeoSocialActions
						target={target}
						onReplyClick={() => handleComposerTargetChange(ROOT_COMPOSER_ID)}
						commentCount={count}
						compact
					/>
					<div className="flex items-center gap-2 text-xs text-stone-500">
						{commentsWithGeometry.length > 0 && onCommentGeojsonVisibilityChange && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleToggleEntityAnnotations}
								className="gap-1.5 rounded-none border-stone-200 bg-white px-2 text-[11px] text-stone-700 hover:bg-stone-100"
							>
								{entityAnnotationsVisible ? (
									<EyeOff className="h-3.5 w-3.5" />
								) : (
									<Eye className="h-3.5 w-3.5" />
								)}
								{entityAnnotationsVisible ? 'Hide annotations' : 'Show annotations'}
							</Button>
						)}
						<span>
							{count} comment{count === 1 ? '' : 's'}
						</span>
					</div>
				</div>
			</div>

			{activeComposerId === ROOT_COMPOSER_ID && (
				<div className="flex-shrink-0 mb-3">
					<GeoCommentForm
						onSubmit={handlePostComment}
						onCancel={() => handleComposerTargetChange(ROOT_COMPOSER_ID)}
						placeholder="Share your thoughts..."
						attachedGeojson={attachedGeojson}
						onClearAttachment={onClearAttachment}
						availableFeatures={availableFeatures}
					/>
				</div>
			)}

			{/* Comments list */}
			<div ref={commentsListRef} className="min-h-0 flex-1 overflow-y-auto">
				{isLoading && comments.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-sm text-stone-500">
						<RefreshCw className="mr-2 h-4 w-4 animate-spin" />
						Loading comments...
					</div>
				) : comments.length === 0 ? (
					<div className="border border-dashed border-stone-200 py-8 text-center text-xs text-stone-500">
						<p>No comments yet</p>
						<p className="text-xs mt-1">Be the first to share your thoughts!</p>
					</div>
				) : (
					<div className="space-y-2">
						{comments.map((commentNode) => (
							<GeoCommentItem
								key={commentNode.event.id ?? commentNode.event.commentId}
								commentNode={commentNode}
								onReply={handlePostReply}
								onToggleGeojsonVisibility={onCommentGeojsonVisibilityChange}
								onZoomToGeojson={onZoomToCommentGeojson}
								onMentionVisibilityToggle={onMentionVisibilityToggle}
								onMentionZoomTo={onMentionZoomTo}
								visibleGeojsonCommentIds={visibleGeojsonCommentIds}
								availableFeatures={availableFeatures}
								activeComposerId={activeComposerId}
								onComposerTargetChange={handleComposerTargetChange}
								focusCommentId={focusCommentId}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
