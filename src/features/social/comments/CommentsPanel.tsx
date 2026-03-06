import { MessageCircle, RefreshCw } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import type { FeatureCollection } from 'geojson'
import { useGeoComments } from '../hooks/useGeoComments'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { Button } from '@/components/ui/button'
import { GeoComment } from './GeoComment'
import { GeoCommentForm } from './GeoCommentForm'
import { GeoSocialActions } from './GeoSocialActions'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'

const ROOT_COMPOSER_ID = 'root'

interface CommentsPanelProps {
	/** The dataset, collection, or context to show comments for */
	target: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent | null
	/** Callback when a comment's GeoJSON visibility is toggled */
	onCommentGeojsonVisibilityChange?: (comment: NDKGeoCommentEvent, visible: boolean) => void
	/** Callback to zoom to a comment's GeoJSON */
	onZoomToCommentGeojson?: (comment: NDKGeoCommentEvent) => void
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
	className?: string
}

/**
 * Panel displaying comments for a geo dataset, collection, or context.
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
	className = '',
}: CommentsPanelProps) {
	const { comments, count, isLoading, postComment, postReply } = useGeoComments({ target })

	const [isRefreshing, setIsRefreshing] = useState(false)
	const [activeComposerId, setActiveComposerId] = useState<string>(ROOT_COMPOSER_ID)

	useEffect(() => {
		setActiveComposerId(ROOT_COMPOSER_ID)
	}, [target?.id, target?.dTag])

	const handlePostComment = useCallback(
		async (text: string, geojson?: FeatureCollection) => {
			await postComment(text, geojson)
		},
		[postComment],
	)

	const handlePostReply = useCallback(
		async (parentComment: NDKGeoCommentEvent, text: string, geojson?: FeatureCollection) => {
			await postReply(parentComment, text, geojson)
		},
		[postReply],
	)

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true)
		// The subscription auto-updates, but we can trigger a visual refresh
		await new Promise((resolve) => setTimeout(resolve, 500))
		setIsRefreshing(false)
	}, [])

	const handleComposerTargetChange = useCallback(
		(nextComposerId: string) => {
			if (activeComposerId === ROOT_COMPOSER_ID && nextComposerId !== ROOT_COMPOSER_ID) {
				onClearAttachment?.()
			}
			setActiveComposerId(nextComposerId)
		},
		[activeComposerId, onClearAttachment],
	)

	if (!target) {
		return (
			<div className={`p-4 text-center text-sm text-gray-500 ${className}`}>
				Select a dataset, collection, or context to view comments.
			</div>
		)
	}

	const targetName = (() => {
		if ('featureCollection' in target) {
			// NDKGeoEvent - try to get name from FeatureCollection or use datasetId
			const fc = target.featureCollection as { name?: string }
			return fc?.name ?? target.datasetId ?? 'Dataset'
		}
		if ('metadata' in target) {
			return target.metadata?.name ?? target.collectionId ?? 'Collection'
		}
		return target.context.name ?? target.contextId ?? 'Context'
	})()

	return (
		<div className={`flex flex-col h-full ${className}`}>
			{/* Header with target info and social actions */}
			<div className="flex-shrink-0 border-b border-gray-100 pb-3 mb-3">
				<div className="flex items-center justify-between gap-2 mb-2">
					<div className="flex items-center gap-2 min-w-0">
						<MessageCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
						<h3 className="text-sm font-semibold text-gray-800 truncate">{targetName}</h3>
					</div>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="text-gray-400 hover:text-gray-600"
					>
						<RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>

				{/* Social actions for the target */}
				<div className="flex items-center justify-between">
					<GeoSocialActions
						target={target}
						onReplyClick={() => handleComposerTargetChange(ROOT_COMPOSER_ID)}
						commentCount={count}
					/>
					<span className="text-xs text-gray-500">
						{count} comment{count === 1 ? '' : 's'}
					</span>
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
			<div className="flex-1 overflow-y-auto min-h-0">
				{isLoading && comments.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-sm text-gray-500">
						<RefreshCw className="h-4 w-4 animate-spin mr-2" />
						Loading comments...
					</div>
				) : comments.length === 0 ? (
					<div className="text-center py-8 text-sm text-gray-500">
						<MessageCircle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
						<p>No comments yet</p>
						<p className="text-xs mt-1">Be the first to share your thoughts!</p>
					</div>
				) : (
					<div className="space-y-2">
						{comments.map((commentNode) => (
							<GeoComment
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
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
