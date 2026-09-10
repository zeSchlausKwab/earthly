import { useState } from 'react'
import { Eye, LoaderCircle, Trash2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
} from './ui/alert-dialog'
import {
	discardSavedDraft,
	reviewSavedDraft,
	viewSavedDraft,
	type DraftActionTarget,
} from '@/features/geo-editor/draftActions'
import { useEditorStore } from '@/features/geo-editor/store'
import { useChatActivity } from '@/features/chat/activity'
import { accounts } from '@/lib/nostr'

/** Shared shortcuts, not a second draft store or a second publishing flow. */
export function DraftRowActions({
	target,
	onNavigate,
	includeDiscard = true,
}: {
	target: DraftActionTarget
	onNavigate?: () => void
	includeDiscard?: boolean
}) {
	const [discardOpen, setDiscardOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const [discardTarget, setDiscardTarget] = useState(target)
	const [discardOwner, setDiscardOwner] = useState(accounts.active?.pubkey)
	const { runningChatId } = useChatActivity()
	const run = async (action: () => Promise<void>, navigate = false) => {
		if (pending) return
		setPending(true)
		try {
			await action()
			if (navigate) onNavigate?.()
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'The draft action failed. Please try again.',
			)
		} finally {
			setPending(false)
		}
	}
	return (
		<>
			<div
				className="flex shrink-0 items-center"
				role="group"
				aria-label={`Actions for ${target.title}`}
			>
				<Button
					variant="ghost"
					size="icon"
					className="size-11 md:size-8"
					disabled={pending}
					title={target.kind === 'dataset' ? 'View on map' : 'Preview Story'}
					aria-label={`${target.kind === 'dataset' ? 'View on map' : 'Preview Story'}: ${target.title}`}
					onClick={() => void run(() => viewSavedDraft(target), true)}
				>
					<Eye className="size-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="size-11 md:size-8"
					disabled={pending}
					title="Review & publish"
					aria-label={`Review & publish: ${target.title}`}
					onClick={() => void run(() => reviewSavedDraft(target), true)}
				>
					<UploadCloud className="size-3.5" />
				</Button>
				{includeDiscard && (
					<Button
						variant="ghost"
						size="icon"
						className="size-11 md:size-8 text-muted-foreground hover:text-destructive"
						disabled={pending || Boolean(runningChatId)}
						title={runningChatId ? 'Stop AI before discarding a draft' : 'Discard draft'}
						aria-label={`Discard draft: ${target.title}`}
						onClick={() => {
							setDiscardTarget(
								target.kind === 'dataset'
									? {
											...target,
											draftId:
												useEditorStore.getState().workspaces[target.workspaceId]?.activeDraftId ??
												undefined,
										}
									: target,
							)
							setDiscardOwner(accounts.active?.pubkey)
							setDiscardOpen(true)
						}}
					>
						<Trash2 className="size-3.5" />
					</Button>
				)}
			</div>
			<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Discard “{discardTarget.title}”?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes this local draft and its AI editing access from all conversations.
							Published content is kept. Stories or references using this draft may need updating.
							This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>Keep draft</AlertDialogCancel>
						<Button
							variant="destructive"
							disabled={pending || Boolean(runningChatId)}
							onClick={() =>
								void run(async () => {
									await discardSavedDraft(discardTarget, discardOwner)
									setDiscardOpen(false)
									toast.success('Local draft discarded. Published content was kept.')
								})
							}
						>
							{pending && <LoaderCircle className="size-4 animate-spin" />}Discard draft
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
