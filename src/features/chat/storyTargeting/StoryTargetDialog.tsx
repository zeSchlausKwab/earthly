import { useSyncExternalStore } from 'react'
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
	cancelStoryTarget,
	confirmStoryTarget,
	getStoryTargetRequest,
	subscribeStoryTargetRequest,
} from './requestStore'

export function StoryTargetDialog() {
	const request = useSyncExternalStore(
		subscribeStoryTargetRequest,
		getStoryTargetRequest,
		getStoryTargetRequest,
	)

	return (
		<AlertDialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				if (!open && request) cancelStoryTarget(request.id)
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{request?.review ? `Review changes · ${request.storyTitle}` : 'Create a Story draft to continue?'}</AlertDialogTitle>
					<AlertDialogDescription>
						{request?.review ? 'Apply to the local Story draft only. This does not publish or send a proposal to its author.' : request
							? `“${request.storyTitle}” needs a Story edit state. Nothing will be written until you confirm.`
							: ''}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{request?.review && <div className="max-h-[50dvh] overflow-auto text-sm">
					<details><summary>Before</summary><pre className="whitespace-pre-wrap">{request.review.before}</pre></details>
					<details open><summary>After</summary><pre className="whitespace-pre-wrap">{request.review.after}</pre></details>
				</div>}
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => request && cancelStoryTarget(request.id)}>
						Cancel
					</AlertDialogCancel>
					<Button
						type="button"
						disabled={!request}
						onClick={() => request && confirmStoryTarget(request.id)}
					>
						{request?.review ? 'Apply changes' : 'New Story and continue'}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
