import type { NostrEvent } from 'nostr-tools'
import { useState, useCallback, useRef, useEffect } from 'react'
import {  } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import { formatDistanceToNow } from 'date-fns'
import { nip19 } from 'nostr-tools'
import { ExternalLink, ChevronDown, ChevronUp, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ContentViewer } from '@/components/editor/ContentViewer'
import { GeoRichTextEditor, type GeoRichTextEditorRef } from '@/components/editor/GeoRichTextEditor'
import { GeoSocialActions } from '../comments/GeoSocialActions'
import { CommentsList } from './CommentThread'
import { useShoutboxComments } from './useShoutboxComments'
import { UserProfile } from '@/components/user-profile'

interface PostCardProps {
	/** The post event */
	event: NostrEvent
	/** Whether this is from the developer */
	isDeveloperPost?: boolean
}

/**
 * Post card with content, social actions, and expandable comments.
 */
export function PostCard({ event, isDeveloperPost = false }: PostCardProps) {
	const currentUser = useActiveAccount()
	const [showComments, setShowComments] = useState(false)
	const [commentContent, setCommentContent] = useState('')
	const [isPostingComment, setIsPostingComment] = useState(false)
	const editorRef = useRef<GeoRichTextEditorRef>(null)

	// Always fetch comments when section is open
	const { comments, count, isLoading, postComment, postReply } = useShoutboxComments({
		rootEvent: showComments ? event : null,
	})

	// Auto-focus editor when comments section opens
	useEffect(() => {
		if (showComments && editorRef.current) {
			// Small delay to let the editor render
			const timer = setTimeout(() => editorRef.current?.focus(), 100)
			return () => clearTimeout(timer)
		}
	}, [showComments])

	const timestamp = event.created_at
		? formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })
		: 'Unknown time'

	// Get nostr link for the post
	const getNostrLink = (): string => {
		try {
			return `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey })}`
		} catch {
			return `nostr:${nip19.noteEncode(event.id)}`
		}
	}

	// Extract hashtags
	const hashtags = event.tags
		.filter((tag) => tag[0] === 't')
		.map((tag) => tag[1])
		.filter(Boolean)

	const handleToggleComments = useCallback(() => {
		setShowComments((prev) => !prev)
	}, [])

	const handleCommentClick = useCallback(() => {
		setShowComments(true)
	}, [])

	const handlePostComment = useCallback(async () => {
		if (!commentContent.trim()) return

		setIsPostingComment(true)
		try {
			await postComment(commentContent.trim())
			setCommentContent('')
			editorRef.current?.clear()
		} catch (error) {
			console.error('Failed to post comment:', error)
		} finally {
			setIsPostingComment(false)
		}
	}, [commentContent, postComment])

	return (
		<div
			className={`rounded-lg border bg-card p-4 space-y-3 hover:border-primary/50 transition-colors overflow-hidden ${
				isDeveloperPost ? 'border-primary/30 bg-primary/5' : ''
			}`}
		>
			{/* Header */}
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<UserProfile pubkey={event.pubkey} mode="avatar-name" size="sm" showNip05Badge />
					{isDeveloperPost && (
						<span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-medium">
							OFFICIAL
						</span>
					)}
					<span className="text-[10px]">·</span>
					<span>{timestamp}</span>
				</div>
				<a
					href={getNostrLink()}
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-primary flex items-center gap-1"
				>
					<ExternalLink className="h-3 w-3" />
					<span>View</span>
				</a>
			</div>

			{/* Content */}
			<ContentViewer content={event.content} />

			{/* Hashtags */}
			{hashtags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{hashtags.map((tag) => (
						<span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
							#{tag}
						</span>
					))}
				</div>
			)}

			{/* Social Actions */}
			<div className="flex items-center justify-between pt-2 border-t border-muted">
				<GeoSocialActions
					target={event}
					onReplyClick={handleCommentClick}
					commentCount={count}
					compact
				/>

				<Button
					variant="ghost"
					size="sm"
					onClick={handleToggleComments}
					className="h-8 text-xs text-muted-foreground"
				>
					{showComments ? (
						<>
							<ChevronUp className="h-3 w-3 mr-1" />
							Hide
						</>
					) : count > 0 ? (
						<>
							<ChevronDown className="h-3 w-3 mr-1" />
							{count} comment{count !== 1 ? 's' : ''}
						</>
					) : (
						<>
							<ChevronDown className="h-3 w-3 mr-1" />
							Comment
						</>
					)}
				</Button>
			</div>

			{/* Comments Section */}
			{showComments && (
				<div className="pt-3 border-t border-muted space-y-3">
					{/* Comment Form */}
					{currentUser ? (
						<div className="space-y-2 bg-muted/30 rounded-lg p-3">
							<GeoRichTextEditor
								ref={editorRef}
								placeholder="Write a comment..."
								onChange={setCommentContent}
								rows={2}
								disabled={isPostingComment}
							/>
							<div className="flex justify-end gap-2">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowComments(false)}
									disabled={isPostingComment}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={handlePostComment}
									disabled={!commentContent.trim() || isPostingComment}
								>
									Comment
								</Button>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg text-sm text-muted-foreground">
							<LogIn className="h-4 w-4" />
							<span>Log in to comment</span>
						</div>
					)}

					{/* Comments List */}
					<CommentsList comments={comments} onReply={postReply} isLoading={isLoading} />
				</div>
			)}
		</div>
	)
}
