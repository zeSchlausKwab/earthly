import { GitPullRequest } from 'lucide-react'
import { useState } from 'react'
import { GeoRichTextEditor } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

export interface ProposalDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	isPublishing?: boolean
	/** Submit the proposal with a non-empty summary. */
	onSubmit: (description: string) => void
	/** Owner's dataset name, shown in the copy when known. */
	datasetName?: string
}

/**
 * Proposal composer for "Propose edit to owner". Lives behind the File menu's
 * Publish section so the propose verb sits next to Fork/Update where users look
 * for it. A proposal needs a written summary, so it opens here as a dialog
 * rather than firing from the menu directly.
 */
export function ProposalDialog({
	open,
	onOpenChange,
	isPublishing,
	onSubmit,
	datasetName,
}: ProposalDialogProps) {
	const [description, setDescription] = useState('')
	const trimmed = description.trim()

	const close = (next: boolean) => {
		if (!next) setDescription('')
		onOpenChange(next)
	}

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GitPullRequest className="h-4 w-4" />
						Propose edit to owner
					</DialogTitle>
					<DialogDescription>
						Send your changes{datasetName ? ` to the owner of “${datasetName}”` : ' to the owner'}{' '}
						as a proposal they can review and merge. Summarize what you changed.
					</DialogDescription>
				</DialogHeader>
				<GeoRichTextEditor
					initialValue={description}
					onChange={setDescription}
					rows={4}
					placeholder="Describe your proposed changes..."
					className="min-h-[140px]"
				/>
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => close(false)}>
						Cancel
					</Button>
					<Button
						type="button"
						className="bg-ok hover:bg-ok/15"
						disabled={!trimmed || isPublishing}
						onClick={() => {
							if (!trimmed) return
							onSubmit(trimmed)
							close(false)
						}}
					>
						Send proposal
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
