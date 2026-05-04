import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import { EventFactory } from 'applesauce-core/factories'
import type { NostrEvent } from 'nostr-tools'
import { useState, useRef, useCallback } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GeoRichTextEditor, type GeoRichTextEditorRef } from '@/components/editor/GeoRichTextEditor'
import type { ShoutboxCategory } from './types'
import { SHOUTBOX_CATEGORIES } from './types'
import { accounts, publish } from '@/lib/nostr'

interface PostFormProps {
	category: ShoutboxCategory
	placeholder?: string
	onPostSuccess?: () => void
	isReply?: boolean
	onCancel?: () => void
}

/**
 * Form for posting to the shoutbox (kind 1 with category hashtags).
 */
export function PostForm({
	category,
	placeholder,
	onPostSuccess,
	isReply = false,
	onCancel,
}: PostFormProps) {
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
		if (!currentUser || !content.trim()) return
		const signer = accounts.signer
		if (!signer) return

		setIsPosting(true)
		try {
			const signed = await EventFactory.fromKind(1)
				.content(content.trim())
				.modifyPublicTags((existing: string[][]) => [
					...existing,
					...tags.map((tag) => ['t', tag]),
				])
				.sign(signer)
			await publish(signed as NostrEvent, { routing: 'outbox' })

			setContent('')
			editorRef.current?.clear()
			onPostSuccess?.()
		} catch (error) {
			console.error('Failed to post:', error)
		} finally {
			setIsPosting(false)
		}
	}, [currentUser, content, tags, onPostSuccess])

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
						{isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
						<span className="ml-2">{isReply ? 'Reply' : 'Post'}</span>
					</Button>
				</div>
			</div>
		</div>
	)
}
