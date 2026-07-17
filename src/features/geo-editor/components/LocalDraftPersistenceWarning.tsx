import { TriangleAlert } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { getCurrentPubkey } from '@/lib/wallet/currentUser'
import { cn } from '@/lib/utils'
import {
	getScopedStorageWriteFailures,
	subscribeScopedStorageWriteFailures,
} from '../store/persistence'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const LOCAL_DRAFT_STORAGE_KEYS = new Set([
	'earthly:geo-editor:collection-drafts:v1',
	'earthly:geo-editor:workspaces:v1',
])

export interface LocalDraftPersistenceWarningProps {
	className?: string
	currentUserPubkey?: string | null
}

export function LocalDraftPersistenceWarning({
	className,
	currentUserPubkey,
}: LocalDraftPersistenceWarningProps) {
	const failures = useSyncExternalStore(
		subscribeScopedStorageWriteFailures,
		getScopedStorageWriteFailures,
		getScopedStorageWriteFailures,
	)
	const activeScope = currentUserPubkey ?? getCurrentPubkey()
	const hasLocalDraftFailure = Object.values(failures).some(
		(failure) => failure.scope === activeScope && LOCAL_DRAFT_STORAGE_KEYS.has(failure.baseKey),
	)

	if (!hasLocalDraftFailure) return null

	return (
		<Alert
			variant="destructive"
			className={cn('border-destructive/40 bg-destructive/10', className)}
		>
			<TriangleAlert aria-hidden="true" />
			<AlertTitle>Local draft not saved</AlertTitle>
			<AlertDescription>
				Your latest changes are only in this open session. Keep Earthly open, free some device
				storage, then make another edit to retry.
			</AlertDescription>
		</Alert>
	)
}
