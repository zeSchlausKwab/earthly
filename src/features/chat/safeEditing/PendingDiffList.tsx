import { useSyncExternalStore } from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/features/geo-editor/store'
import { DatasetDiffDisclosure } from './DatasetDiffDisclosure'
import {
	getAllPendingDiffs,
	resolvePendingDiff,
	subscribePendingDiffs,
	type PendingDiffEntry,
} from './pendingDiffStore'

/**
 * Subscribe the React transcript to the host-side pending-diff bridge. The gate
 * (run_code path) registers entries via `emitDiffBlock`; this hook re-renders the
 * transcript whenever they change.
 */
function usePendingDiffs(): PendingDiffEntry[] {
	return useSyncExternalStore(subscribePendingDiffs, getAllPendingDiffs, getAllPendingDiffs)
}

/**
 * PendingDiffList — the transcript region that renders every safe-editing diff
 * block (SAFE-03). Each entry renders a `DatasetDiffDisclosure`; a `pending`
 * block exposes inline Apply/Cancel wired to `resolvePendingDiff` (resolving the
 * gate's awaited confirm), and a resolved/applied block shows the outcome (D-12)
 * with an "Undo last AI edit" affordance that reverts the last dataset snapshot
 * (SAFE-06 surface).
 */
export function PendingDiffList() {
	const entries = usePendingDiffs()
	if (entries.length === 0) return null

	const undoLastAiEdit = () => {
		useEditorStore.getState().editor?.undoLastDatasetSnapshot()
	}

	return (
		<div className="space-y-2">
			{entries.map((entry) => (
				<div key={entry.id} className="ml-8 min-w-0 max-w-[85%]">
					<DatasetDiffDisclosure
						diff={entry.diff}
						status={entry.status}
						headline={entry.headline}
						onApply={() => resolvePendingDiff(entry.id, 'applied')}
						onCancel={() => resolvePendingDiff(entry.id, 'cancelled')}
					/>
					{entry.status === 'applied' ? (
						<div className="mt-1 flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-auto gap-1 px-2 py-0.5 text-[11px] text-muted-foreground"
								onClick={undoLastAiEdit}
							>
								<Undo2 className="h-3 w-3" />
								Undo last AI edit
							</Button>
						</div>
					) : null}
				</div>
			))}
		</div>
	)
}
