import { useSyncExternalStore } from 'react'
import { LoaderCircle } from 'lucide-react'
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
	cancelReferencePublish,
	confirmReferencePublish,
	getReferencePublishRequest,
	subscribeReferencePublishRequest,
} from './requestStore'

export function ReferencePublishDialog() {
	const request = useSyncExternalStore(
		subscribeReferencePublishRequest,
		getReferencePublishRequest,
		getReferencePublishRequest,
	)
	const publishing = request?.status === 'publishing'

	return (
		<AlertDialog
			open={Boolean(request)}
			onOpenChange={(open) => {
				if (!open && request && !publishing) cancelReferencePublish(request.id)
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Publish changes to reference this Dataset?</AlertDialogTitle>
					<AlertDialogDescription>
						{request
							? `“${request.datasetTitle}” has unpublished changes. Publish the captured draft so this action can use a stable Dataset reference.`
							: ''}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{request?.error ? (
					<p role="alert" className="text-sm text-destructive">
						{request.error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel
						disabled={publishing}
						onClick={() => request && cancelReferencePublish(request.id)}
					>
						Cancel
					</AlertDialogCancel>
					<Button
						type="button"
						disabled={!request || publishing}
						onClick={() => request && void confirmReferencePublish(request.id)}
					>
						{publishing ? <LoaderCircle className="animate-spin" /> : null}
						{publishing
							? 'Publishing…'
							: request?.status === 'error'
								? 'Retry'
								: 'Publish and continue'}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
