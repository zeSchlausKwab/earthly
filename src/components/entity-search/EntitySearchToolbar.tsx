import { ArrowDownAZ, ArrowUpZA, Clock, Database, FolderOpen, Globe, MapPin, X } from 'lucide-react'
import {
	LIMIT_OPTIONS,
	type FilterActions,
	type FilterState,
	type SortDirection,
	type SortField,
} from '@/components/data-filter/types'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { Button } from '@/components/ui/button'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { EntitySearchPopover, type SearchMode } from './EntitySearchPopover'
import { EntitySearchInput } from './EntitySearchInput'
import type { EntitySearchResult, EntitySearchSources, EntityType } from './types'

interface EntitySearchToolbarProps extends FilterState, FilterActions {
	totalCount: number
	filteredCount: number
	displayedCount: number
	hasMore: boolean
	placeholder?: string
}

const SORT_OPTIONS: {
	value: `${SortField}-${SortDirection}`
	label: string
	icon: typeof Clock
}[] = [
	{ value: 'recency-desc', label: 'Newest', icon: Clock },
	{ value: 'recency-asc', label: 'Oldest', icon: Clock },
	{ value: 'name-asc', label: 'A-Z', icon: ArrowDownAZ },
	{ value: 'name-desc', label: 'Z-A', icon: ArrowUpZA },
]

export function EntitySearchToolbar({
	searchQuery,
	sortConfig,
	displayLimit,
	setSearchQuery,
	setSortConfig,
	setDisplayLimit,
	totalCount,
	filteredCount,
	displayedCount,
	placeholder,
}: EntitySearchToolbarProps) {
	const sortValue = `${sortConfig.field}-${sortConfig.direction}` as const

	const handleSortChange = (value: string) => {
		const [field, direction] = value.split('-') as [SortField, SortDirection]
		setSortConfig({ field, direction })
	}

	return (
		<div className="flex items-center gap-1.5">
			<EntitySearchInput
				value={searchQuery}
				onChange={setSearchQuery}
				placeholder={placeholder}
				compact
				className="flex-1 min-w-0"
			/>
			<Select value={sortValue} onValueChange={handleSortChange}>
				<SelectTrigger size="sm" className="w-[75px] h-7 text-xs">
					<SelectValue placeholder="Sort" />
				</SelectTrigger>
				<SelectContent>
					{SORT_OPTIONS.map((opt) => (
						<SelectItem key={opt.value} value={opt.value}>
							<span className="flex items-center gap-1.5">
								<opt.icon className="h-3 w-3" />
								{opt.label}
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select value={String(displayLimit)} onValueChange={(v) => setDisplayLimit(Number(v))}>
				<SelectTrigger size="sm" className="w-[70px] h-7 text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{LIMIT_OPTIONS.map((limit) => (
						<SelectItem key={limit} value={String(limit)}>
							Show {limit}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="text-[11px] text-muted-foreground whitespace-nowrap">
				{displayedCount}/{filteredCount}
				{filteredCount !== totalCount && ` (${totalCount})`}
			</span>
		</div>
	)
}

interface EntityReferenceToolbarProps {
	sources: EntitySearchSources
	references: EntitySearchResult[]
	onAddReference: (result: EntitySearchResult) => void
	onRemoveReference: (referenceKey: string) => void
	onClearReferences?: () => void
	entityTypes?: EntityType[]
	placeholder?: string
	searchMode?: SearchMode
	getDatasetName?: (event: GeoDataset) => string
	className?: string
}

const ENTITY_TYPE_ICONS: Record<EntityType, typeof Database> = {
	dataset: Database,
	collection: FolderOpen,
	context: Globe,
	feature: MapPin,
}

export function getEntityReferenceKey(result: EntitySearchResult): string {
	const stableId = result.id || result.name || 'unknown'
	return `${result.type}:${stableId}:${result.pubkey ?? ''}`
}

export function EntityReferenceToolbar({
	sources,
	references,
	onAddReference,
	onRemoveReference,
	onClearReferences,
	entityTypes,
	placeholder = 'Add geometry/context/collection references…',
	searchMode = 'both',
	getDatasetName,
	className,
}: EntityReferenceToolbarProps) {
	return (
		<div className={className}>
			<EntitySearchPopover
				sources={sources}
				entityTypes={entityTypes}
				onSelect={onAddReference}
				placeholder={placeholder}
				searchMode={searchMode}
				compact
				getDatasetName={getDatasetName}
			/>

			{references.length > 0 && (
				<div className="mt-1.5 flex flex-wrap items-center gap-1">
					{references.map((reference) => {
						const Icon = ENTITY_TYPE_ICONS[reference.type]
						const referenceKey = getEntityReferenceKey(reference)
						return (
							<div
								key={referenceKey}
								className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5 text-[11px]"
							>
								<Icon className="h-3 w-3 text-muted-foreground" />
								<span className="max-w-[180px] truncate">{reference.name}</span>
								<Button
									variant="ghost"
									size="icon-xs"
									className="rounded-sm"
									onClick={() => onRemoveReference(referenceKey)}
									title={`Remove ${reference.name}`}
									aria-label={`Remove ${reference.name}`}
								>
									<X className="h-3 w-3" />
								</Button>
							</div>
						)
					})}
					{onClearReferences && references.length > 1 && (
						<Button
							variant="outline"
							size="sm"
							className="h-6 px-1.5 text-[11px]"
							onClick={onClearReferences}
						>
							Clear all
						</Button>
					)}
				</div>
			)}
		</div>
	)
}
