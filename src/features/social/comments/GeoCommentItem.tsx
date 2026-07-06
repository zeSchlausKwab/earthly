import { ChevronDown, ChevronRight, Eye, EyeOff, MapPin } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { CommentNode } from '../hooks/useGeoComments'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { Button } from '@/components/ui/button'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GeoCommentForm } from './GeoCommentForm'
import { GeoSocialActions } from './GeoSocialActions'
import { RichContentRenderer } from '@/components/editor'
import { UserProfile } from '@/components/user-profile'

interface GeoCommentItemProps {
	commentNode: CommentNode
	onReply: (parentComment: GeoComment, text: string, geojson?: FeatureCollection) => Promise<void>
	onToggleGeojsonVisibility?: (comment: GeoComment, visible: boolean) => void
	onZoomToGeojson?: (comment: GeoComment) => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	visibleGeojsonCommentIds?: Set<string>
	availableFeatures?: GeoFeatureItem[]
	activeComposerId: string
	onComposerTargetChange: (composerId: string) => void
	focusCommentId?: string
	maxDepth?: number
	className?: string
}

/**
 * Single comment with author, content, actions, and nested replies.
 */
export function GeoCommentItem({
	commentNode,
	onReply,
	onToggleGeojsonVisibility,
	onZoomToGeojson,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	visibleGeojsonCommentIds = new Set(),
	availableFeatures = [],
	activeComposerId,
	onComposerTargetChange,
	focusCommentId,
	maxDepth = 5,
	className = '',
}: GeoCommentItemProps) {
	const { event: comment, children, depth } = commentNode
	const [isExpanded, setIsExpanded] = useState(true)
	const commentRef = useRef<HTMLDivElement | null>(null)

	const commentId = comment.commentId ?? comment.id ?? ''
	const hasGeojson = comment.geojson && comment.geojson.features.length > 0
	const featureCount = comment.geojson?.features.length ?? 0
	const isGeojsonVisible = visibleGeojsonCommentIds.has(commentId)
	const showReplyForm = activeComposerId === commentId
	const isFocusedComment = focusCommentId === commentId

	const timestamp = useMemo(() => {
		if (!comment.created_at) return 'Unknown time'
		const date = new Date(comment.created_at * 1000)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffMins = Math.floor(diffMs / 60000)
		const diffHours = Math.floor(diffMs / 3600000)
		const diffDays = Math.floor(diffMs / 86400000)

		if (diffMins < 1) return 'just now'
		if (diffMins < 60) return `${diffMins}m ago`
		if (diffHours < 24) return `${diffHours}h ago`
		if (diffDays < 7) return `${diffDays}d ago`
		return date.toLocaleDateString()
	}, [comment.created_at])

	const handleReply = async (text: string, geojson?: FeatureCollection) => {
		await onReply(comment, text, geojson)
		onComposerTargetChange('root')
	}

	const handleToggleGeojsonVisibility = () => {
		onToggleGeojsonVisibility?.(comment, !isGeojsonVisible)
	}

	const handleZoomToGeojson = () => {
		onZoomToGeojson?.(comment)
	}

	// Parse text for geo mentions - removed, now using GeoRichTextEditor

	// Calculate indentation (capped at maxDepth)
	const indentLevel = Math.min(depth, maxDepth)
	const indentStyle = depth > 0 ? { marginLeft: `${indentLevel * 1}rem` } : undefined

	const hasChildren = children.length > 0

	useEffect(() => {
		if (!isFocusedComment || !commentRef.current) return
		commentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
	}, [isFocusedComment])

	return (
		<div className={`space-y-1 ${className}`}>
			{/* Main comment */}
			<div
				ref={commentRef}
				className={`group rounded-lg border bg-card p-2 transition-colors ${
					isFocusedComment
						? 'border-primary/40 bg-primary/10 shadow-sm'
						: 'border-border hover:border-border'
				}`}
				style={indentStyle}
			>
				{/* Header: author, timestamp, collapse button */}
				<div className="flex items-center justify-between gap-2 mb-1">
					<div className="flex items-center gap-2 min-w-0">
						<UserProfile pubkey={comment.pubkey} mode="avatar-name" size="sm" showNip05Badge />
						<span className="text-[10px] text-muted-foreground">{timestamp}</span>
					</div>

					<div className="flex items-center gap-1">
						{/* Collapse/expand for comments with replies */}
						{hasChildren && (
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={() => setIsExpanded(!isExpanded)}
								className="h-5 w-5 p-0 text-muted-foreground hover:text-muted-foreground"
							>
								{isExpanded ? (
									<ChevronDown className="h-3.5 w-3.5" />
								) : (
									<ChevronRight className="h-3.5 w-3.5" />
								)}
							</Button>
						)}
					</div>
				</div>

				<div className="text-sm text-foreground">
					<RichContentRenderer
						content={comment.text}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
						className="space-y-2"
					/>
				</div>

				{/* GeoJSON attachment indicator */}
				{hasGeojson && (
					<div className="mt-2 flex items-center gap-2 rounded-md bg-ok/15 border border-ok/40 px-2 py-1 text-xs text-ok">
						<MapPin className="h-3.5 w-3.5 flex-shrink-0" />
						<span>
							{featureCount} geometry{featureCount === 1 ? '' : 'ies'}
						</span>

						{/* Visibility toggle */}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={handleToggleGeojsonVisibility}
									className={`ml-auto h-5 w-5 p-0 ${
										isGeojsonVisible ? 'text-ok' : 'text-muted-foreground'
									} hover:text-ok`}
								>
									{isGeojsonVisible ? (
										<Eye className="h-3.5 w-3.5" />
									) : (
										<EyeOff className="h-3.5 w-3.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{isGeojsonVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
						</Tooltip>

						{/* Zoom to */}
						{onZoomToGeojson && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="xs"
										onClick={handleZoomToGeojson}
										className="h-5 px-1.5 text-ok hover:text-ok"
									>
										Zoom
									</Button>
								</TooltipTrigger>
								<TooltipContent>Zoom to geometry</TooltipContent>
							</Tooltip>
						)}
					</div>
				)}

				{/* Actions: reactions, zaps, reply */}
				<div className="mt-2 flex items-center justify-between">
					<GeoSocialActions
						target={comment}
						onReplyClick={() => onComposerTargetChange(showReplyForm ? 'root' : commentId)}
						commentCount={children.length}
						compact
					/>
				</div>

				{/* Inline reply form */}
				{showReplyForm && (
					<div className="mt-2 pt-2 border-t border-border">
						<GeoCommentForm
							onSubmit={handleReply}
							onCancel={() => onComposerTargetChange('root')}
							placeholder="Write a reply..."
							isReply
							autoFocus
							availableFeatures={availableFeatures}
						/>
					</div>
				)}
			</div>

			{/* Nested replies */}
			{isExpanded && children.length > 0 && (
				<div className="space-y-1">
					{children.map((childNode) => (
						<GeoCommentItem
							key={childNode.event.id ?? childNode.event.commentId}
							commentNode={childNode}
							onReply={onReply}
							onToggleGeojsonVisibility={onToggleGeojsonVisibility}
							onZoomToGeojson={onZoomToGeojson}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							visibleGeojsonCommentIds={visibleGeojsonCommentIds}
							availableFeatures={availableFeatures}
							activeComposerId={activeComposerId}
							onComposerTargetChange={onComposerTargetChange}
							focusCommentId={focusCommentId}
							maxDepth={maxDepth}
						/>
					))}
				</div>
			)}
		</div>
	)
}
