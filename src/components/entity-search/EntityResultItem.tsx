import { BookOpen, Database, Eye, Globe, MapPin, RadioTower } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EntitySearchResult, EntityType } from './types'
import { Button } from '@/components/ui/button'

const TYPE_ICONS: Record<EntityType, typeof Database> = {
	dataset: Database,
	context: Globe,
	feature: MapPin,
	story: BookOpen,
	beacon: RadioTower,
	sighting: Eye,
}

const TYPE_COLORS: Record<EntityType, string> = {
	dataset: 'text-info',
	context: 'text-primary',
	feature: 'text-muted-foreground',
	story: 'text-info',
	beacon: 'text-ok',
	sighting: 'text-edit',
}

interface EntityResultItemProps {
	result: EntitySearchResult
	isSelected?: boolean
	showTypeIcon?: boolean
	onSelect?: (result: EntitySearchResult) => void
}

export function EntityResultItem({
	result,
	isSelected,
	showTypeIcon = true,
	onSelect,
}: EntityResultItemProps) {
	// Fallbacks keep an unknown/future entity type from rendering an undefined
	// component (a hard React crash) — worst case is a neutral pin.
	const Icon = TYPE_ICONS[result.type] ?? MapPin
	const colorClass = TYPE_COLORS[result.type] ?? 'text-muted-foreground'

	return (
		<Button
			type="button"
			variant="ghost"
			className={cn(
				'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm h-auto justify-start',
				isSelected && 'bg-accent text-accent-foreground',
			)}
			onClick={() => onSelect?.(result)}
		>
			{showTypeIcon && <Icon className={cn('h-3.5 w-3.5 shrink-0', colorClass)} />}
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium text-xs">{result.name}</div>
				{result.subtitle && (
					<div className="truncate text-[11px] text-muted-foreground">{result.subtitle}</div>
				)}
			</div>
		</Button>
	)
}
