import { RefreshCw, Search, X } from 'lucide-react'
import type React from 'react'
import { Button } from './button'
import { Input } from './input'

export interface SearchBarProps {
	/** Current search query value */
	query: string
	/** Whether search is currently loading */
	loading?: boolean
	/** Placeholder text for the input */
	placeholder?: string
	/** Called when the search form is submitted */
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
	/** Called when the query value changes */
	onQueryChange?: (value: string) => void
	/** Called when the clear button is clicked */
	onClear?: () => void
	/** Additional CSS classes */
	className?: string
	/** Whether to show the submit button */
	showSubmitButton?: boolean
}

/**
 * Reusable search bar component with input, clear button, and submit functionality.
 * Used in both desktop Toolbar and MobileSearch components.
 */
export function SearchBar({
	query,
	loading = false,
	placeholder = 'Search...',
	onSubmit,
	onQueryChange,
	onClear,
	className = '',
	showSubmitButton = true,
}: SearchBarProps) {
	return (
		<form onSubmit={onSubmit} className={`flex items-center gap-2 ${className}`}>
			<div className="relative flex-1">
				<Input
					value={query}
					onChange={(event) => onQueryChange?.(event.target.value)}
					placeholder={placeholder}
					className="pr-9"
				/>
				{query && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Clear search"
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
						onClick={() => onClear?.()}
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			{showSubmitButton && (
				<Button type="submit" size="icon" variant="ghost" aria-label="Search" disabled={loading}>
					{loading ? (
						<RefreshCw className="h-4 w-4 animate-spin" />
					) : (
						<Search className="h-4 w-4" />
					)}
				</Button>
			)}
		</form>
	)
}

export interface SearchResultsProps<T extends { id: string; displayName: string }> {
	/** Array of search results */
	results: T[]
	/** Whether to show results count */
	showCount?: boolean
	/** Called when a result is selected */
	onResultSelect?: (result: T) => void
	/** Called when results are cleared */
	onClear?: () => void
	/** Maximum height of the results container */
	maxHeight?: string
	/** Additional CSS classes */
	className?: string
	/** Custom render function for each result item */
	renderResult?: (result: T) => React.ReactNode
}

/**
 * Reusable search results dropdown component.
 * Can be used with SearchBar for displaying search results.
 */
export function SearchResults<T extends { id: string; displayName: string }>({
	results,
	showCount = true,
	onResultSelect,
	onClear,
	maxHeight = '15rem',
	className = '',
	renderResult,
}: SearchResultsProps<T>) {
	if (results.length === 0) return null

	return (
		<div className={`rounded-lg bg-card border border-border shadow-lg ${className}`}>
			{(showCount || onClear) && (
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					{showCount && (
						<span className="text-xs font-medium text-muted-foreground">
							{results.length} result{results.length !== 1 ? 's' : ''}
						</span>
					)}
					{onClear && (
						<Button variant="ghost" size="sm" className="h-auto p-0 text-xs" onClick={onClear}>
							Close
						</Button>
					)}
				</div>
			)}
			<div className="overflow-y-auto p-1" style={{ maxHeight }}>
				{results.map((result) =>
					renderResult ? (
						<div key={result.id}>{renderResult(result)}</div>
					) : (
						<button
							key={result.id}
							type="button"
							className="w-full text-left text-sm p-2 hover:bg-muted rounded truncate"
							onClick={() => onResultSelect?.(result)}
						>
							{result.displayName}
						</button>
					),
				)}
			</div>
		</div>
	)
}
