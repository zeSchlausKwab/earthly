import type { Geometry } from 'geojson'
import { Layers3, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GeometryBadge } from '@/components/info-panel/geometry/GeometryDisplay'

export interface GeometryChoiceItem {
	id: string
	name: string
	geometry: Geometry
	isAnnotation?: boolean
	context?: string
}

interface GeometryChoiceMenuProps {
	items: GeometryChoiceItem[]
	point: { x: number; y: number }
	container: HTMLElement | null | undefined
	title?: string
	onChoose: (id: string) => void
	onClose: () => void
}

export function GeometryChoiceMenu({
	items,
	point,
	container,
	title = 'Choose geometry',
	onChoose,
	onClose,
}: GeometryChoiceMenuProps) {
	const menuWidth = 264
	const menuHeight = Math.min(items.length, 6) * 46 + 54
	const left = Math.min(
		Math.max(point.x + 10, 12),
		Math.max(12, (container?.clientWidth ?? menuWidth + 24) - menuWidth - 12),
	)
	const top = Math.min(
		Math.max(point.y + 10, 12),
		Math.max(12, (container?.clientHeight ?? menuHeight + 24) - menuHeight - 12),
	)

	return (
		<div
			role="menu"
			aria-label={title}
			className="pointer-events-auto absolute z-50 w-[264px] border border-border bg-card text-xs shadow-xl"
			style={{ left, top }}
		>
			<div className="flex items-center gap-2 border-b border-border bg-muted/70 px-2 py-1.5">
				<Layers3 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
				<span className="min-w-0 flex-1 font-medium">{title}</span>
				<span className="text-[10px] tabular-nums text-muted-foreground">{items.length} here</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onClose}
					aria-label="Close geometry chooser"
				>
					<X className="h-3 w-3" />
				</Button>
			</div>
			<div className="max-h-[276px] overflow-y-auto py-1">
				{items.map((item) => (
					<button
						type="button"
						role="menuitem"
						key={item.id}
						className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
						onClick={() => onChoose(item.id)}
					>
						<GeometryBadge geometry={item.geometry} isAnnotation={item.isAnnotation} />
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium text-foreground">{item.name}</span>
							<span className="block truncate text-[10px] text-muted-foreground">
								{item.context
									? `${item.isAnnotation ? 'Annotation' : item.geometry.type} · ${item.context}`
									: item.isAnnotation
										? 'Annotation'
										: item.geometry.type}
							</span>
						</span>
					</button>
				))}
			</div>
		</div>
	)
}
