import { Eye, EyeOff, Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AggregateMapLayerControlProps {
	title: string
	description: string
	count: number
	visible: boolean
	onToggle: () => void
	accent?: 'primary' | 'ok'
}

/**
 * Explicit whole-layer control. This is intentionally a labelled row rather
 * than another header icon: it must remain distinguishable from "add filtered
 * results", which adds individual Map Stack entries.
 */
export function AggregateMapLayerControl({
	title,
	description,
	count,
	visible,
	onToggle,
	accent = 'primary',
}: AggregateMapLayerControlProps) {
	return (
		<div
			className={cn(
				'flex items-center gap-2 border border-border bg-muted/35 px-2 py-2',
				visible && (accent === 'ok' ? 'border-ok/50 bg-ok/10' : 'border-primary/50 bg-primary/10'),
			)}
		>
			<div
				className={cn(
					'flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-background text-muted-foreground',
					visible && (accent === 'ok' ? 'text-ok' : 'text-primary'),
				)}
			>
				<Layers3 className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-xs font-semibold text-foreground">{title}</span>
					<span className="shrink-0 font-mono text-[9px] text-muted-foreground">{count}</span>
				</div>
				<p className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">{description}</p>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={onToggle}
				aria-pressed={visible}
				className="h-7 shrink-0 gap-1 rounded-[2px] px-2 text-[10px]"
			>
				{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
				{visible ? 'Hide' : 'Show'}
			</Button>
		</div>
	)
}
