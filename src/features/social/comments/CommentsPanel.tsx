import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import {
	useState,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from 'react'
import type { FeatureCollection } from 'geojson'
import { useGeoComments } from '../hooks/useGeoComments'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { GeoCommentItem } from './GeoCommentItem'
import { GeoCommentForm } from './GeoCommentForm'
import { useMobileObjectNavigation } from '@/components/info-panel/MobileObjectNavigation'
import { GeoSocialActions } from './GeoSocialActions'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { PanelTranslucencyContext } from '@/components/PanelTranslucencyContext'
import { cn } from '@/lib/utils'
import { sortCommentThreads, type CommentSort } from './commentPresentation'

const ROOT_COMPOSER_ID = 'root'

interface CommentsPanelProps {
	/** The dataset, context, Story, or Sighting to show comments for */
	target: GeoDataset | MapContext | Article | TemporalSighting | LiveBeacon | null
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
	/** The enclosing object already supplies its title and social actions. */
	embedded?: boolean
	/** Contextual actions, such as attaching the selected Map features. */
	toolbarAction?: ReactNode
	/** Dock the composer in bounded object tabs; keep it above threads in reading-page flow. */
	layout?: 'docked' | 'flow'
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
	embedded = false,
	toolbarAction,
	layout = 'docked',
	className = '',
}: CommentsPanelProps) {
	const { comments, allComments, count, isLoading, postComment, postReply } = useGeoComments({
		target,
	})

	const [activeComposerId, setActiveComposerId] = useState<string>(ROOT_COMPOSER_ID)
	const [sort, setSort] = useState<CommentSort>('newest')
	const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({})
	const translucent = useContext(PanelTranslucencyContext)
	const [entityAnnotationsVisible, setEntityAnnotationsVisible] = useState(true)
	const initializedCommentIdsRef = useRef<Set<string>>(new Set())
	const commentsListRef = useRef<HTMLElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const mobileNavigation = useMobileObjectNavigation()
	const [focusComposer, setFocusComposer] = useState(false)
	useEffect(() => {
		if (!focusComposer) return
		const panel = panelRef.current
		if (!panel) return
		const focus = () => {
			// Prefer writing over the first formatting button. Tiptap may still
			// be loading when Write a comment opens the sheet.
			const input = panel.querySelector<HTMLElement>('form [contenteditable="true"], form textarea')
			if (!input) return false
			input.focus({ preventScroll: true })
			input.scrollIntoView({ block: 'nearest' })
			setFocusComposer(false)
			return true
		}
		if (focus()) return
		const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
		observer.observe(panel, { childList: true, subtree: true })
		return () => observer.disconnect()
	}, [focusComposer, activeComposerId])

	// biome-ignore lint/correctness/useExhaustiveDependencies: changing the selected entity resets its composer and annotation state.
	useEffect(() => {
		setActiveComposerId(ROOT_COMPOSER_ID)
		setEntityAnnotationsVisible(true)
		initializedCommentIdsRef.current = new Set()
	}, [target?.id, target?.dTag])

	const commentsWithGeometry = useMemo(
		() => allComments.filter((comment) => (comment.geojson?.features.length ?? 0) > 0),
		[allComments],
	)
	const sortedComments = useMemo(
		() => sortCommentThreads(comments, sort, reactionCounts),
		[comments, sort, reactionCounts],
	)
	const handleReactionCountChange = useCallback((id: string, value: number) => {
		setReactionCounts((current) => (current[id] === value ? current : { ...current, [id]: value }))
	}, [])

	const handlePostComment = useCallback(
		async (text: string, geojson?: FeatureCollection) => {
			await postComment(text, geojson)
			toast.success('Comment posted!')
			window.requestAnimationFrame(() => {
				if (commentsListRef.current) {
					commentsListRef.current.scrollTop = 0
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
			<div className={`p-4 text-center text-sm text-muted-foreground ${className}`}>
				Select a Map or Atlas to view comments.
			</div>
		)
	}

	const composer = activeComposerId === ROOT_COMPOSER_ID && (
		<div
			className={cn(
				'border-border py-2',
				layout === 'docked'
					? 'min-h-0 max-h-[70%] overflow-y-auto overscroll-contain border-t'
					: 'border-b',
				translucent ? 'bg-transparent' : 'bg-card',
			)}
		>
			<GeoCommentForm
				onSubmit={handlePostComment}
				onCancel={() => handleComposerTargetChange(ROOT_COMPOSER_ID)}
				placeholder="Add a comment..."
				attachedGeojson={attachedGeojson}
				onClearAttachment={onClearAttachment}
				availableFeatures={availableFeatures}
			/>
		</div>
	)

	return (
		<div
			className={cn('flex flex-col', layout === 'docked' && 'h-full min-h-0', className)}
			ref={panelRef}
			onFocusCapture={event => { if ((event.target as HTMLElement).matches('textarea, input, [contenteditable="true"]')) mobileNavigation?.onExpandComposer?.() }}
			data-translucent={translucent}
			data-layout={layout}
		>
			{!embedded && (
				<div className="shrink-0 border-b border-border pb-2">
					<GeoSocialActions
						target={target}
						onReplyClick={() => handleComposerTargetChange(ROOT_COMPOSER_ID)}
						commentCount={count}
						compact
					/>
				</div>
			)}
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border py-2 text-xs text-muted-foreground">
				<span className="mr-auto font-mono text-[11px]">
					{count} comment{count === 1 ? '' : 's'}
				</span>
				{toolbarAction}
				{mobileNavigation && <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => { setActiveComposerId(ROOT_COMPOSER_ID); mobileNavigation.onExpandComposer?.(); setFocusComposer(true) }}>Write a comment</Button>}
				{commentsWithGeometry.length > 0 && onCommentGeojsonVisibilityChange && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleToggleEntityAnnotations}
						aria-pressed={entityAnnotationsVisible}
						className={cn(
							'gap-1.5 rounded-none border-border px-2 text-[11px] text-foreground hover:bg-muted/40',
							translucent ? 'bg-transparent' : 'bg-card',
						)}
					>
						{entityAnnotationsVisible ? (
							<EyeOff className="h-3.5 w-3.5" />
						) : (
							<Eye className="h-3.5 w-3.5" />
						)}
						{entityAnnotationsVisible ? 'Hide annotations' : 'Show annotations'}
					</Button>
				)}
				<select
					aria-label="Sort comments"
					value={sort}
					onChange={(event) =>
						setSort(event.target.value === 'most-liked' ? 'most-liked' : 'newest')
					}
					className={cn(
						'h-7 border border-border px-1.5 text-xs text-foreground',
						translucent ? 'bg-transparent' : 'bg-card',
					)}
				>
					<option value="newest">Newest</option>
					<option value="most-liked">Most liked</option>
				</select>
			</div>
			{layout === 'flow' && composer}

			{/* Comments list */}
			<section
				ref={commentsListRef}
				className={
					layout === 'docked' ? 'min-h-12 flex-1 overflow-y-auto overscroll-contain' : undefined
				}
				aria-label="Comment threads"
			>
				{isLoading && comments.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
						<RefreshCw className="mr-2 h-4 w-4 animate-spin" />
						Loading comments...
					</div>
				) : comments.length === 0 ? (
					<div className="py-4 text-center text-xs text-muted-foreground">
						<p>No comments yet</p>
					</div>
				) : (
					<div>
						{sortedComments.map((commentNode) => (
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
								onReactionCountChange={handleReactionCountChange}
							/>
						))}
					</div>
				)}
			</section>
			{layout === 'docked' && composer}
		</div>
	)
}
