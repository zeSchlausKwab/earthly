import { useSyncExternalStore } from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/features/chat/store'
import { DatasetDiffDisclosure } from './DatasetDiffDisclosure'
import {
	getAllPendingDiffs,
	resolvePendingDiff,
	subscribePendingDiffs,
	type PendingDiffEntry,
} from './pendingDiffStore'
import { undoPendingDiff } from './targetBoundUndo'

/**
 * Subscribe the React transcript to the host-side pending-diff bridge. The gate
 * (run_code path) registers entries via `emitDiffBlock`; this hook re-renders the
 * transcript whenever they change.
 */
function usePendingDiffs(): PendingDiffEntry[] {
	return useSyncExternalStore(subscribePendingDiffs, getAllPendingDiffs, getAllPendingDiffs)
}

/** Entries belonging to the ACTIVE chat (untagged legacy entries show everywhere). */
function useActiveChatDiffs(): PendingDiffEntry[] {
	const allEntries = usePendingDiffs()
	const activeChatId = useChatStore((state) => state.activeChatId)
	return allEntries.filter((entry) => !entry.chatId || entry.chatId === activeChatId)
}

/** One stack of diff disclosures (shared by the inline and trailing renderers). */
function DiffCardStack({ entries }: { entries: PendingDiffEntry[] }) {
	if (entries.length === 0) return null

	return (
		<div className="space-y-2">
			{entries.map((entry) => {
				return (
					<div key={entry.id} className="ml-8 min-w-0 max-w-[85%]">
						<DatasetDiffDisclosure
							diff={entry.diff}
							status={entry.status}
							headline={entry.headline}
							onApply={() => resolvePendingDiff(entry.id, 'applied')}
							onCancel={() => resolvePendingDiff(entry.id, 'cancelled')}
						/>
						{entry.status === 'applied' && entry.commit ? (
							<div className="mt-1 flex justify-end">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-auto gap-1 px-2 py-0.5 text-[11px] text-muted-foreground"
									onClick={() => undoPendingDiff(entry.id)}
									title="Undo this exact AI edit in its bound Dataset"
								>
									<Undo2 className="h-3 w-3" />
									Undo AI edit
								</Button>
							</div>
						) : null}
					</div>
				)
			})}
		</div>
	)
}

/**
 * InlineDiffCards — the diff block(s) emitted by ONE tool call, rendered
 * directly under that tool turn in the transcript. This is what preserves
 * temporal ordering: each APPLIED/CANCELLED card sits at the point in the
 * conversation where the edit actually happened.
 */
export function InlineDiffCards({ toolCallId }: { toolCallId: string }) {
	const entries = useActiveChatDiffs().filter((entry) => entry.toolCallId === toolCallId)
	return <DiffCardStack entries={entries} />
}

/**
 * PendingDiffList — the trailing transcript region for diff blocks that have
 * no anchor turn yet (SAFE-03). While a gate is awaiting Apply/Cancel its tool
 * message does not exist yet, so the live confirmation renders here at the
 * bottom where the user is looking; once resolved, the tool message lands and
 * the card moves inline via {@link InlineDiffCards}. Untagged (pre-fix) entries
 * also render here.
 */
export function PendingDiffList() {
	const chatEntries = useActiveChatDiffs()
	const messages = useChatStore((state) => state.messages)
	// Anchored = a tool message for the emitting call is present in the transcript.
	const anchoredCallIds = new Set(
		messages
			.filter((message) => message.role === 'tool' && typeof message.tool_call_id === 'string')
			.map((message) => message.tool_call_id as string),
	)
	const entries = chatEntries.filter(
		(entry) => !entry.toolCallId || !anchoredCallIds.has(entry.toolCallId),
	)
	return <DiffCardStack entries={entries} />
}
