import { useSyncExternalStore } from 'react'
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
	answerStoryPublicationApproval,
	getStoryPublicationApproval,
	subscribeStoryPublicationApproval,
} from './storyPublicationApproval'

export function StoryPublicationDialog() {
	const request = useSyncExternalStore(
		subscribeStoryPublicationApproval,
		getStoryPublicationApproval,
		getStoryPublicationApproval,
	)
	return (
		<AlertDialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				if (!open && request) answerStoryPublicationApproval(request.id, false)
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Publish Story and referenced maps?</AlertDialogTitle>
					<AlertDialogDescription>
						“{request?.title}” uses local Map drafts. These maps will be published publicly before
						the Story. Other references are left unchanged.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul className="max-h-48 overflow-y-auto list-disc pl-5 text-sm">
					{request?.maps.map((title, index) => (
						<li key={index}>{title}</li>
					))}
				</ul>
				<p className="text-xs text-muted-foreground">
					If something fails, completed publications are kept and the remaining work stays in
					drafts. You can retry.
				</p>
				<AlertDialogFooter>
					<AlertDialogCancel
						onClick={() => request && answerStoryPublicationApproval(request.id, false)}
					>
						Keep drafts
					</AlertDialogCancel>
					<Button onClick={() => request && answerStoryPublicationApproval(request.id, true)}>
						Publish Story and {request?.maps.length} maps
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
