import { RefreshCw, Search, X } from 'lucide-react';
import type React from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { GeoSearchResult } from '../types';

type SearchBarProps = {
	searchQuery: string;
	searchLoading: boolean;
	placeholder: string;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	onQueryChange?: (value: string) => void;
	onClearQuery?: () => void;
	className?: string;
};

function SearchBar({
	searchQuery,
	searchLoading,
	placeholder,
	onSubmit,
	onQueryChange,
	onClearQuery,
	className = ''
}: SearchBarProps) {
	return (
		<form onSubmit={onSubmit} className={`flex items-center gap-2 ${className}`}>
			<div className="relative flex-1">
				<Input
					value={searchQuery}
					onChange={(event) => onQueryChange?.(event.target.value)}
					placeholder={placeholder}
					className="pr-9"
				/>
				{searchQuery && (
					<button
						type="button"
						aria-label="Clear search"
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-500 hover:text-gray-800"
						onClick={() => onClearQuery?.()}
					>
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
			<Button type="submit" size="icon" variant="default" aria-label="Search location" disabled={searchLoading}>
				{searchLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
			</Button>
		</form>
	);
}
interface MobileSearchProps {
	searchQuery?: string;
	searchResults?: GeoSearchResult[];
	searchLoading?: boolean;
	searchError?: string | null;
	onSearchQueryChange?: (value: string) => void;
	onSearchSubmit?: () => void;
	onSearchResultSelect?: (result: GeoSearchResult) => void;
	onClearSearchResults?: () => void;
	onSearchClear?: () => void;
	onClose?: () => void;
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
	onClose
}: MobileSearchProps) {
	const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSearchSubmit?.();
	};

	return (
		<div className="pointer-events-auto fixed left-1/2 top-3 z-50 w-[calc(100%-24px)] -translate-x-1/2 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
			<div className="flex w-full flex-col gap-2">
				<div className="flex items-center gap-2">
					<SearchBar
						searchQuery={searchQuery}
						searchLoading={searchLoading}
						placeholder="Search places..."
						onSubmit={handleSearchSubmit}
						onQueryChange={(value) => onSearchQueryChange?.(value)}
						onClearQuery={() => onSearchClear?.()}
						className="w-full"
					/>
					<Button size="icon" variant="ghost" onClick={onClose}>
						<X className="h-5 w-5" />
					</Button>
				</div>
				<div className="mt-2 flex w-full flex-col gap-2">
					{searchError && <div className="text-xs text-red-600">{searchError}</div>}
					{searchResults.length > 0 && (
						<div className="w-full rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
							<div className="mb-1 flex items-center justify-between text-xs text-gray-600">
								<span>Search results ({searchResults.length})</span>
								{onClearSearchResults && (
									<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClearSearchResults}>
										<X className="mr-1 h-3 w-3" />
										Clear
									</Button>
								)}
							</div>
							<div className="max-h-56 space-y-2 overflow-y-auto">
								{searchResults.map((result) => (
									<div
										key={result.placeId}
										className="flex items-start gap-2 rounded-lg border border-gray-100 px-2 py-1.5"
									>
										<div className="flex-1">
											<div className="text-sm font-medium leading-tight line-clamp-1">{result.displayName}</div>
											<div className="text-[11px] text-gray-500">
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
	);
}
