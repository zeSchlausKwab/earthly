import { Loader2, Search, X } from 'lucide-react'
import type React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
		<search
			aria-label="Search places"
			className="pointer-events-auto fixed left-2 right-12 top-[calc(max(0.5rem,env(safe-area-inset-top))+2.5rem)] z-40 max-w-[30rem]"
		>
			<form
				onSubmit={handleSearchSubmit}
				className="flex h-10 items-center gap-1 rounded-full border border-border bg-card/95 px-2 shadow-lg backdrop-blur"
			>
				<Search className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<Input
					autoFocus
					value={searchQuery}
					onChange={(event) => onSearchQueryChange?.(event.target.value)}
					placeholder="Search places…"
					className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
				/>
				{searchQuery ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => onSearchClear?.()}
						aria-label="Clear search"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				) : null}
				<Button type="submit" size="icon-sm" variant="ghost" disabled={searchLoading}>
					{searchLoading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Search className="h-4 w-4" />
					)}
					<span className="sr-only">Search</span>
				</Button>
				<Button type="button" size="icon-sm" variant="ghost" onClick={onClose}>
					<X className="h-4 w-4" />
					<span className="sr-only">Close search</span>
				</Button>
			</form>
			<div className="mt-1.5 flex w-full flex-col gap-2">
				{searchError && <div className="text-xs text-destructive">{searchError}</div>}
				{searchResults.length > 0 && (
					<div className="w-full rounded-lg border border-border bg-card/98 p-2 shadow-lg backdrop-blur">
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
		</search>
	)
}
