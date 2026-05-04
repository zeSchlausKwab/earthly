import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useState, useRef, useCallback } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GeoRichTextEditor, type GeoRichTextEditorRef } from '@/components/editor/GeoRichTextEditor'
import type { ShoutboxCategory } from './types'
import { SHOUTBOX_CATEGORIES } from './types'
import { publish } from '@/lib/nostr'

interface PostFormProps {
	/** The category to post to */
	category: ShoutboxCategory
	/** Placeholder text */
	placeholder?: string
	/** Called after successful post */
	onPostSuccess?: () => void
	/** Whether this is a reply form (smaller) */
	isReply?: boolean
	/** Called on cancel (for reply forms) */
	onCancel?: () => void
}

/**
 * Form for posting to the shoutbox.
 * Uses TipTap editor and auto-adds category tags.
 */
export function PostForm({
	category,
	placeholder,
	onPostSuccess,
	isReply = false,
	onCancel,
}: PostFormProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const [isPosting, setIsPosting] = useState(false)
	const [content, setContent] = useState('')
	const editorRef = useRef<GeoRichTextEditorRef>(null)

	const categoryConfig = SHOUTBOX_CATEGORIES.find((c) => c.id === category)
	const tags = categoryConfig?.tags ?? ['earthlycity']

	const defaultPlaceholder = isReply
		? 'Write your reply...'
		: `Share your ${category === 'features' ? 'feature request' : category === 'bugs' ? 'bug report' : 'thoughts'}...`

	const handleSubmit = useCallback(async () => {
		if (!ndk || !currentUser || !content.trim()) return

		setIsPosting(true)
		try {
			const event = new NDKEvent(ndk)
			event.kind = 1
			event.content = content.trim()

			// Add category tags
			for (const tag of tags) {
				event.tags.push(['t', tag])
			}

			await event.sign()
			await publish(event.rawEvent(), { routing: 'outbox' })

			// Clear form
			setContent('')
			editorRef.current?.clear()
			onPostSuccess?.()
		} catch (error) {
			console.error('Failed to post:', error)
		} finally {
			setIsPosting(false)
		}
	}, [ndk, currentUser, content, tags, onPostSuccess])

	const handleContentChange = useCallback((text: string) => {
		setContent(text)
	}, [])

	if (!currentUser) {
		return (
			<div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center text-sm text-muted-foreground">
				Please log in to post
			</div>
		)
	}

	return (
		<div className={`space-y-3 ${isReply ? 'bg-muted/30 rounded-lg p-3' : ''}`}>
			<GeoRichTextEditor
				ref={editorRef}
				placeholder={placeholder ?? defaultPlaceholder}
				onChange={handleContentChange}
				rows={isReply ? 2 : 3}
				disabled={isPosting}
			/>

			<div className="flex items-center justify-between">
				<div className="flex flex-wrap gap-1">
					{tags.map((tag) => (
						<span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
							#{tag}
						</span>
					))}
				</div>

				<div className="flex items-center gap-2">
					{onCancel && (
						<Button variant="ghost" size="sm" onClick={onCancel} disabled={isPosting}>
							Cancel
						</Button>
					)}
					<Button size="sm" onClick={handleSubmit} disabled={!content.trim() || isPosting}>
						{isPosting ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Send className="h-4 w-4" />
						)}
						<span className="ml-2">{isReply ? 'Reply' : 'Post'}</span>
					</Button>
				</div>
			</div>
		</div>
	)
}
