import { Check, CirclePause, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ChatRunStatus } from '../store'

/** Stays beside the composer, including while reasoning or action history is collapsed. */
export function ChatRunStatusBar({ status, phase }: { status: ChatRunStatus; phase: string }) {
	if (status === 'idle') return null
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
		status === 'working'
			? phase
			: status === 'awaiting_approval'
				? 'Waiting for your approval'
				: status === 'completed'
					? 'Finished'
					: status === 'error'
						? 'Response failed — see details above'
						: 'Stopped · send a message to continue'
	return (
		<div
			role="status"
			aria-live="polite"
			aria-label="Chat progress"
			className="flex shrink-0 items-center gap-2 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
		>
			<Icon
				aria-hidden="true"
				className={`h-3.5 w-3.5 shrink-0 ${status === 'working' ? 'animate-spin' : ''}`}
			/>
			<span>{label}</span>
		</div>
	)
}
