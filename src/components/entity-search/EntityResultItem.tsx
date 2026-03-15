import { Database, FolderOpen, Globe, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EntitySearchResult, EntityType } from './types'
import { Button } from '@/components/ui/button'

const TYPE_ICONS: Record<EntityType, typeof Database> = {
	dataset: Database,
	collection: FolderOpen,
	context: Globe,
	feature: MapPin,
}

const TYPE_COLORS: Record<EntityType, string> = {
	dataset: 'text-blue-500',
	collection: 'text-green-500',
	context: 'text-amber-500',
	feature: 'text-gray-500',
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
	const Icon = TYPE_ICONS[result.type]
	const colorClass = TYPE_COLORS[result.type]

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
