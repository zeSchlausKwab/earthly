import { X } from 'lucide-react'
import type React from 'react'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/ui/search-bar'
import type { GeoSearchResult } from '../types'
interface MobileSearchProps {
	searchQuery?: string
	searchResults?: GeoSearchResult[]
	searchLoading?: boolean
	searchError?: string | null
	onSearchQueryChange?: (value: string) => void
	onSearchSubmit?: () => void
	onSearchResultSelect?: (result: GeoSearchResult) => void
	onClearSearchResults?: () => void
	onSearchClear?: () => void
	onClose?: () => void
}

export function MobileSearch({
	searchQuery = '',
	searchResults = [],
	searchLoading = false,
	searchError = null,
	onSearchQueryChange,
	onSearchSubmit,
	onSearchResultSelect,
	onClearSearchResults,
	onSearchClear,
	onClose,
}: MobileSearchProps) {
	const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		onSearchSubmit?.()
	}

	return (
		<div className="glass-panel pointer-events-auto fixed left-1/2 top-3 z-50 w-[calc(100%-24px)] -translate-x-1/2 rounded-lg p-3">
			<div className="flex w-full flex-col gap-2">
				<div className="flex items-center gap-2">
					<SearchBar
						query={searchQuery}
						loading={searchLoading}
						placeholder="Search places..."
						onSubmit={handleSearchSubmit}
						onQueryChange={(value) => onSearchQueryChange?.(value)}
						onClear={() => onSearchClear?.()}
						className="w-full"
					/>
					<Button size="icon" variant="ghost" onClick={onClose}>
						<X className="h-5 w-5" />
					</Button>
				</div>
				<div className="mt-2 flex w-full flex-col gap-2">
					{searchError && <div className="text-xs text-destructive">{searchError}</div>}
					{searchResults.length > 0 && (
						<div className="w-full rounded-xl border border-border bg-card p-2 shadow-sm">
							<div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
								<span>Search results ({searchResults.length})</span>
								{onClearSearchResults && (
									<Button
										size="sm"
										variant="ghost"
										className="h-7 px-2 text-xs"
										onClick={onClearSearchResults}
									>
										<X className="mr-1 h-3 w-3" />
										Clear
									</Button>
								)}
							</div>
							<div className="max-h-56 space-y-2 overflow-y-auto">
								{searchResults.map((result) => (
									<div
										key={result.placeId}
										className="flex items-start gap-2 rounded-lg border border-border px-2 py-1.5"
									>
										<div className="flex-1">
											<div className="text-sm font-medium leading-tight line-clamp-1">
												{result.displayName}
											</div>
											<div className="text-[11px] text-muted-foreground">
												{result.coordinates.lat.toFixed(4)}, {result.coordinates.lon.toFixed(4)}
											</div>
										</div>
										<Button
											size="sm"
											variant="secondary"
											className="h-7 px-2 text-xs"
											onClick={() => onSearchResultSelect?.(result)}
										>
											Zoom
										</Button>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
