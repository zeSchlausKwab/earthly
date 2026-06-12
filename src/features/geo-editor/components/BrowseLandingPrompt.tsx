import { Clock, Database, Globe, PencilLine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BrowseLandingPromptProps {
	/**
	 * Seed the stack with the newest datasets — the 5 most recently published
	 * (by event `created_at`) across the loaded relays.
	 */
	onShowNewest: () => void
	/** Open the sidebar's dataset catalog. */
	onBrowseDatasets: () => void
	/** Open the sidebar's context catalog. */
	onBrowseContexts: () => void
	/** Enter the Author stance with a fresh draft. */
	onStartDrawing: () => void
	onDismiss: () => void
}

/**
 * Round E.2/E.5: shown on the Browse stance when the map stack is empty.
 * Replaces the silent cold-start auto-seed (C.4) with an explicit choice —
 * the map stays honest ("empty stack = empty map") and the user picks how
 * to start.
 */
export function BrowseLandingPrompt({
	onShowNewest,
	onBrowseDatasets,
	onBrowseContexts,
	onStartDrawing,
	onDismiss,
}: BrowseLandingPromptProps) {
	return (
		<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
			<section
				aria-label="Start exploring"
				className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-background/95 p-5 shadow-xl backdrop-blur"
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold text-foreground">Your map is empty</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Add something to the map stack to get started.
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="-mt-1 -mr-1 h-7 w-7 shrink-0 text-muted-foreground"
						onClick={onDismiss}
						aria-label="Dismiss"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<Button
						type="button"
						variant="default"
						className="justify-start gap-2"
						onClick={onShowNewest}
						title="Adds the 5 most recently published datasets to the map"
					>
						<Clock className="h-4 w-4" />
						Show newest datasets
					</Button>
					<Button
						type="button"
						variant="outline"
						className="justify-start gap-2"
						onClick={onBrowseDatasets}
					>
						<Database className="h-4 w-4" />
						Browse datasets
					</Button>
					<Button
						type="button"
						variant="outline"
						className="justify-start gap-2"
						onClick={onBrowseContexts}
					>
						<Globe className="h-4 w-4" />
						Browse contexts
					</Button>
					<Button
						type="button"
						variant="outline"
						className="justify-start gap-2"
						onClick={onStartDrawing}
					>
						<PencilLine className="h-4 w-4" />
						Start a new dataset
					</Button>
				</div>
			</section>
		</div>
	)
}
