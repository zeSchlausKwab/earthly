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
					<AlertDialogTitle>Create a Story draft to continue?</AlertDialogTitle>
					<AlertDialogDescription>
						{request
							? `“${request.storyTitle}” needs a Story edit state. Nothing will be written until you confirm.`
							: ''}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => request && cancelStoryTarget(request.id)}>
						Cancel
					</AlertDialogCancel>
					<Button
						type="button"
						disabled={!request}
						onClick={() => request && confirmStoryTarget(request.id)}
					>
						New Story and continue
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
