/**
 * StoryProposeEditDialog (STORY-06) — the reader-facing "Propose an edit"
 * affordance for a published Story the reader does NOT own.
 *
 * Opens a Dialog pre-filled with the current Story narrative in a
 * `GeoRichTextEditor`, captures the edited Markdown, and on submit publishes a
 * kind-37519 proposal whose `content` is the proposed Markdown body and whose `a`
 * tag is the Story's `37520:<owner>:<d>` coordinate
 * (`GeoProposalFactory.createForStory`). No spec discriminator — the target kind
 * is read off the `a` coordinate alone (SPEC.md §17). The dialog never renders raw
 * HTML.
 */

import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { GeoRichTextEditor, type GeoFeatureItem } from '@/components/editor'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { accounts, publish } from '@/lib/nostr'
import type { Article } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { GeoProposalFactory } from '@/lib/nostr/geo-proposal'

interface StoryProposeEditDialogProps {
	/** The published Story to propose an edit to. */
	story: Article
	open: boolean
	onOpenChange: (open: boolean) => void
	availableFeatures?: GeoFeatureItem[]
}

export function StoryProposeEditDialog({
	story,
	open,
	onOpenChange,
	availableFeatures = [],
}: StoryProposeEditDialogProps) {
	const currentUser = useActiveAccount()
	const currentBody = story.article.content ?? ''
	const [body, setBody] = useState(currentBody)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Reset the editor body whenever the dialog (re)opens on a Story.
	useEffect(() => {
		if (open) {
			setBody(currentBody)
			setError(null)
		}
	}, [open, currentBody])

	const handleSubmit = async () => {
		if (!currentUser) {
			setError('Sign in to propose an edit.')
			return
		}
		if (!body.trim()) {
			setError('Add some narrative before proposing your edit.')
			return
		}
		const owner = story.pubkey
		const dTag = story.dTag
		if (!owner || !dTag) {
			setError("Couldn't load this proposed edit. Ask the author to re-send, or try again.")
			return
		}

		setIsSubmitting(true)
		setError(null)
		try {
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			const storyCoordinate = `${ARTICLE_KIND}:${owner}:${dTag}`
			const signed = await GeoProposalFactory.createForStory(
				{ address: storyCoordinate, ownerPubkey: owner },
				body,
			).sign(signer)
			await publish(signed, { routing: 'outbox' })

			toast.success('Edit proposed — the author will see it for review.')
			onOpenChange(false)
		} catch (submitError) {
			setError(
				submitError instanceof Error && submitError.message === 'No active account'
					? 'Sign in to propose an edit.'
					: "Couldn't send your proposed edit — check your connection and try again.",
			)
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Propose an edit</DialogTitle>
					<DialogDescription>
						Suggest a change to this story's narrative. The author can review your edit and accept
						or decline it.
					</DialogDescription>
				</DialogHeader>

				<GeoRichTextEditor
					initialValue={currentBody}
					onChange={setBody}
					availableFeatures={availableFeatures}
					placeholder={`Edit the narrative…
Type @ to reference a dataset, feature, image, or video.`}
					rows={12}
					className="min-h-[280px] w-full"
				/>

				{error && <p className="text-xs text-destructive">{error}</p>}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-none">
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={isSubmitting || !currentUser}
						className="rounded-none bg-primary text-primary-foreground"
					>
						{isSubmitting ? 'Sending…' : 'Propose an edit'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
