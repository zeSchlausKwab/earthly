import { Loader2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { DEFAULT_FILTER_STATE, type FilterState } from '@/components/data-filter/types'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { EntityResultGroup } from './EntityResultGroup'
import { EntityResultItem } from './EntityResultItem'
import { EntitySearchInput } from './EntitySearchInput'
import { useEntitySearch } from './useEntitySearch'
import { useRelayEntitySearch } from './useRelayEntitySearch'
import {
	ENTITY_TYPE_LABELS,
	type EntitySearchResult,
	type EntitySearchSources,
	type EntityType,
} from './types'

export type SearchMode = 'local' | 'relay' | 'both'

interface EntitySearchPopoverProps {
	sources?: EntitySearchSources
	entityTypes?: EntityType[]
	onSelect: (result: EntitySearchResult) => void
	placeholder?: string
	searchMode?: SearchMode
	compact?: boolean
	inputClassName?: string
	getDatasetName?: (event: NDKGeoEvent) => string
}

export function EntitySearchPopover({
	sources = {},
	entityTypes,
	onSelect,
	placeholder,
	searchMode = 'local',
	compact,
	inputClassName,
	getDatasetName,
}: EntitySearchPopoverProps) {
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const inputRef = useRef<HTMLInputElement>(null)

	const filterState: FilterState = useMemo(
		() => ({
			...DEFAULT_FILTER_STATE,
			searchQuery: query,
		}),
		[query],
	)

	const useLocal = searchMode === 'local' || searchMode === 'both'
	const useRelay = searchMode === 'relay' || searchMode === 'both'

	const localResults = useEntitySearch({
		sources: useLocal ? sources : {},
		entityTypes,
		filterState,
		getDatasetName,
	})

	const { results: relayResults, loading: relayLoading } = useRelayEntitySearch({
		query,
		entityTypes,
		enabled: useRelay && query.trim().length > 0,
		getDatasetName,
	})

	// Merge and deduplicate results
	const mergedResults = useMemo(() => {
		if (!useRelay) return localResults
		if (!useLocal) {
			// Relay-only: group relay results by type
			const groups = new Map<EntityType, EntitySearchResult[]>()
			for (const r of relayResults) {
				const list = groups.get(r.type) ?? []
				list.push(r)
				groups.set(r.type, list)
			}
			const resultGroups = Array.from(groups.entries()).map(([type, results]) => ({
				type,
				label: ENTITY_TYPE_LABELS[type],
				results,
				totalCount: results.length,
				filteredCount: results.length,
			}))
			return {
				results: relayResults,
				groups: resultGroups,
				totalCount: relayResults.length,
				filteredCount: relayResults.length,
				hasResults: relayResults.length > 0,
			}
		}
		// Both: merge, dedup by id
		const seen = new Set(localResults.results.map((r) => r.id))
		const extra = relayResults.filter((r) => !seen.has(r.id))
		if (extra.length === 0) return localResults
		return {
			...localResults,
			results: [...localResults.results, ...extra],
			hasResults: localResults.hasResults || extra.length > 0,
		}
	}, [useLocal, useRelay, localResults, relayResults])

	const flatResults = mergedResults.results

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault()
				setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1))
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				setSelectedIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < flatResults.length) {
				e.preventDefault()
				const selected = flatResults[selectedIndex]
				if (selected) {
					onSelect(selected)
					setOpen(false)
					setQuery('')
				}
			} else if (e.key === 'Escape') {
				setOpen(false)
			}
		},
		[flatResults, selectedIndex, onSelect],
	)

	const handleSelect = useCallback(
		(result: EntitySearchResult) => {
			onSelect(result)
			setOpen(false)
			setQuery('')
		},
		[onSelect],
	)

	const showPopover = open && (mergedResults.hasResults || relayLoading)

	return (
		<Popover open={showPopover} onOpenChange={setOpen}>
			<PopoverAnchor asChild>
				<EntitySearchInput
					ref={inputRef}
					value={query}
					onChange={(v) => {
						setQuery(v)
						setSelectedIndex(-1)
						if (v.trim()) setOpen(true)
						else setOpen(false)
					}}
					onFocus={() => {
						if (query.trim()) setOpen(true)
					}}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					compact={compact}
					inputClassName={inputClassName}
				/>
			</PopoverAnchor>
			<PopoverContent
				className="w-[var(--radix-popover-trigger-width)] p-1 max-h-[60vh] overflow-hidden"
				onOpenAutoFocus={(e) => e.preventDefault()}
				align="start"
				sideOffset={4}
			>
				<div className="max-h-[56vh] overflow-y-auto overscroll-contain">
					{mergedResults.groups.map((group) => (
						<EntityResultGroup key={group.type} group={group}>
							{group.results.map((result) => {
								const globalIndex = flatResults.indexOf(result)
								return (
									<EntityResultItem
										key={result.id}
										result={result}
										isSelected={globalIndex === selectedIndex}
										onSelect={handleSelect}
									/>
								)
							})}
						</EntityResultGroup>
					))}
					{relayLoading && (
						<div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
							<Loader2 className="h-3 w-3 animate-spin" />
							Searching relay…
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
