import { Check, CirclePause, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ChatRunStatus } from '../store'
import { Button } from '@/components/ui/button'

/** Stays beside the composer, including while reasoning or action history is collapsed. */
export function ChatRunStatusBar({
	status,
	phase,
	onUsage,
	onStop,
	onReview,
}: {
	status: ChatRunStatus
	phase: string
	onUsage?: () => void
	onStop?: () => void
	onReview?: () => void
}) {
	if (status === 'idle' && !onUsage) return null
	const Icon =
		status === 'working'
			? Loader2
			: status === 'awaiting_approval'
				? ShieldCheck
				: status === 'completed'
					? Check
					: status === 'error'
						? TriangleAlert
						: CirclePause
	const label =
		status === 'idle'
			? 'No response yet'
			: status === 'working'
				? phase
				: status === 'awaiting_approval'
					? 'Waiting for your approval'
					: status === 'completed'
						? 'Finished'
						: status === 'error'
							? 'Response failed — see details above'
							: 'Stopped · send a message to continue'
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-2 border-t bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
			<div
				role="status"
				aria-live="polite"
				aria-label="Chat progress"
				className="flex min-w-0 flex-1 items-center gap-2 py-2"
			>
				<Icon
					aria-hidden="true"
					className={`h-3.5 w-3.5 shrink-0 ${status === 'working' ? 'animate-spin' : ''}`}
				/>
				<span>{label}</span>
			</div>
			{status === 'awaiting_approval' && onReview && (
				<Button
					type="button"
					variant="outline"
					className="min-h-11 rounded-none px-2 text-xs"
					onClick={onReview}
				>
					Review changes
				</Button>
			)}
			{onStop && (
				<Button
					type="button"
					variant="outline"
					className="min-h-11 rounded-none px-2 text-xs"
					onClick={onStop}
				>
					Stop
				</Button>
			)}
			{onUsage && (
				<Button
					type="button"
					variant="ghost"
					aria-label="Chat usage details"
					className="min-h-11 rounded-none px-2 text-xs"
					onClick={onUsage}
				>
					Usage
				</Button>
			)}
		</div>
	)
}
