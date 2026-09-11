import { BookOpen, CircleHelp, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** First-use invitation leaves the actual map and navigation usable. */
export function WelcomeCard({ onBrowse, onCreate, onTour, onDismiss, canCreate = true }: {
	onBrowse(): void; onCreate(): void; onTour(): void; onDismiss(): void; canCreate?: boolean
}) {
	return <section aria-label="Welcome to Earthly" className="absolute left-3 right-3 top-24 z-30 border border-border bg-background/95 p-4 shadow-lg md:left-4 md:right-auto md:top-28 md:w-80">
		<div className="flex items-start justify-between gap-3">
			<h2 className="text-lg font-semibold">Maps worth exploring</h2>
			<Button aria-label="Dismiss welcome" size="icon-sm" variant="ghost" className="size-11 shrink-0 md:size-8" onClick={onDismiss}><X className="size-4" /></Button>
		</div>
		<p className="mb-3 text-sm text-muted-foreground">Browse maps and stories, or draw your own. Open any map to explore its details.</p>
		<div className="flex flex-wrap gap-2">
			<Button className="min-h-11" onClick={onBrowse}><BookOpen className="size-4" />Browse</Button>
			<Button variant="outline" className="min-h-11" disabled={!canCreate} title={canCreate ? undefined : 'Preparing the map editor'} onClick={onCreate}><Plus className="size-4" />Create a map</Button>
			<Button variant="ghost" className="min-h-11" onClick={onTour}><CircleHelp className="size-4" />Take a tour</Button>
		</div>
	</section>
}
