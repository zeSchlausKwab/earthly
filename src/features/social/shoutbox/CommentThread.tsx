import {  } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { NostrEvent } from 'nostr-tools'
import { useState, useCallback, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContentViewer } from '@/components/editor/ContentViewer'
import { GeoRichTextEditor, type GeoRichTextEditorRef } from '@/components/editor/GeoRichTextEditor'
import { GeoSocialActions } from '../comments/GeoSocialActions'
import { UserProfile } from '@/components/user-profile'
import type { CommentNode } from './types'

interface CommentThreadProps {
	/** The comment node to render */
	node: CommentNode
	/** Callback to post a reply */
	onReply: (parentComment: NostrEvent, content: string) => Promise<void>
	/** Maximum depth to show inline (deeper comments are collapsed) */
	collapseDepth?: number
}

/**
 * Recursive component for rendering threaded comments.
 */
export function CommentThread({ node, onReply, collapseDepth = 3 }: CommentThreadProps) {
	const currentUser = useActiveAccount()
	const [showReplyForm, setShowReplyForm] = useState(false)
	const [isReplying, setIsReplying] = useState(false)
	const [replyContent, setReplyContent] = useState('')
	const [collapsed, setCollapsed] = useState(node.depth >= collapseDepth)
	const editorRef = useRef<GeoRichTextEditorRef>(null)

	const { event, children, depth } = node

	const timestamp = event.created_at
		? formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })
		: 'Unknown time'

	const handleReply = useCallback(async () => {
		if (!replyContent.trim()) return

		setIsReplying(true)
		try {
			await onReply(event, replyContent.trim())
			setReplyContent('')
			editorRef.current?.clear()
			setShowReplyForm(false)
		} catch (error) {
			console.error('Failed to reply:', error)
		} finally {
			setIsReplying(false)
		}
	}, [event, replyContent, onReply])

	// Calculate indentation (max 4 levels visually)
	const indentLevel = Math.min(depth, 4)
	const marginLeft = indentLevel * 16

	return (
		<div style={{ marginLeft }} className="border-l border-muted pl-3">
			{/* Comment Content */}
			<div className="py-2">
				{/* Header */}
				<div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
					<UserProfile pubkey={event.pubkey} mode="avatar-name" size="xs" showNip05Badge />
					<span>·</span>
					<span>{timestamp}</span>
				</div>

				{/* Content */}
				<div className="text-sm">
					<ContentViewer content={event.content} />
				</div>

				{/* Actions */}
				<div className="flex items-center gap-1 mt-2">
					<GeoSocialActions
						target={event}
						onReplyClick={currentUser ? () => setShowReplyForm(!showReplyForm) : undefined}
						commentCount={children.length}
						showCommentButton={!!currentUser}
						compact
					/>

					{children.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCollapsed(!collapsed)}
							className="h-6 px-2 text-muted-foreground"
						>
							{collapsed ? (
								<>
									<ChevronDown className="h-3 w-3 mr-1" />
									<span className="text-xs">{children.length} replies</span>
								</>
							) : (
								<>
									<ChevronUp className="h-3 w-3 mr-1" />
									<span className="text-xs">Collapse</span>
								</>
							)}
						</Button>
					)}
				</div>

				{/* Reply Form */}
				{showReplyForm && (
					<div className="mt-2 space-y-2">
						<GeoRichTextEditor
							ref={editorRef}
							placeholder="Write your reply..."
							onChange={setReplyContent}
							rows={2}
							disabled={isReplying}
						/>
						<div className="flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setShowReplyForm(false)}
								disabled={isReplying}
							>
								Cancel
							</Button>
							<Button size="sm" onClick={handleReply} disabled={!replyContent.trim() || isReplying}>
								Reply
							</Button>
						</div>
					</div>
				)}
			</div>

			{/* Children (Recursive) */}
			{!collapsed && children.length > 0 && (
				<div className="space-y-1">
					{children.map((child) => (
						<CommentThread
							key={child.event.id}
							node={child}
							onReply={onReply}
							collapseDepth={collapseDepth}
						/>
					))}
				</div>
			)}
		</div>
	)
}

interface CommentsListProps {
	/** Array of root comment nodes */
	comments: CommentNode[]
	/** Callback to post a reply */
	onReply: (parentComment: NostrEvent, content: string) => Promise<void>
	/** Whether comments are loading */
	isLoading?: boolean
}

/**
 * List of threaded comments.
 */
export function CommentsList({ comments, onReply, isLoading = false }: CommentsListProps) {
	if (isLoading && comments.length === 0) {
		return <div className="text-center py-4 text-muted-foreground text-sm">Loading comments...</div>
	}

	if (comments.length === 0) {
		return (
			<div className="text-center py-4 text-muted-foreground text-sm">
				No comments yet. Be the first to comment!
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{comments.map((node) => (
				<CommentThread key={node.event.id} node={node} onReply={onReply} />
			))}
		</div>
	)
}
