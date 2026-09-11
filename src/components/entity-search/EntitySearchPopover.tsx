import { Loader2, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { DEFAULT_FILTER_STATE, type FilterState } from '@/components/data-filter/types'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { EntityResultGroup } from './EntityResultGroup'
import { EntityResultItem } from './EntityResultItem'
import { EntitySearchInput } from './EntitySearchInput'
import { isQuestionQuery, resolveSearchEnterTarget } from './searchInteraction'
import { useEntitySearch } from './useEntitySearch'
import { usePlaceEntitySearch } from './usePlaceEntitySearch'
import { useRelayEntitySearch } from './useRelayEntitySearch'
import {
	ENTITY_TYPE_LABELS,
	type EntitySearchResult,
	type EntitySearchSources,
	type EntityType,
} from './types'

export type SearchMode = 'local' | 'relay' | 'both'

interface EntitySearchPopoverProps {
	dragHandles?: boolean
	sources?: EntitySearchSources
	entityTypes?: EntityType[]
	onSelect: (result: EntitySearchResult) => void
	placeholder?: string
	searchMode?: SearchMode
	compact?: boolean
	inputClassName?: string
	getDatasetName?: (event: GeoDataset) => string
	/** Open the read-only Ask Earthly route with the user's question. */
	onAsk?: (query: string) => void
}

const SEARCH_GROUP_ORDER: readonly EntityType[] = [
	'dataset',
	'story',
	'context',
	'sighting',
	'person',
	'place',
	'beacon',
	'feature',
]

function searchResultKey(result: EntitySearchResult): string {
	return `${result.type}:${result.id}`
}

function groupSearchResults(results: EntitySearchResult[]) {
	const grouped = new Map<EntityType, EntitySearchResult[]>()
	for (const result of results) {
		const group = grouped.get(result.type) ?? []
		group.push(result)
		grouped.set(result.type, group)
	}
	return SEARCH_GROUP_ORDER.flatMap((type) => {
		const groupResults = grouped.get(type)
		return groupResults?.length
			? [
					{
						type,
						label: ENTITY_TYPE_LABELS[type],
						results: groupResults,
						totalCount: groupResults.length,
						filteredCount: groupResults.length,
					},
				]
			: []
	})
}

export function EntitySearchPopover({
	dragHandles = true,
	sources = {},
	entityTypes,
	onSelect,
	placeholder,
	searchMode = 'local',
	compact,
	inputClassName,
	getDatasetName,
	onAsk,
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
	const { results: placeResults, loading: placeLoading } = usePlaceEntitySearch({
		query,
		limit: 5,
		enabled: useRelay && Boolean(entityTypes?.includes('place')) && query.trim().length > 0,
	})
	const remoteResults = useMemo(
		() => [...relayResults, ...placeResults],
		[relayResults, placeResults],
	)
	const remoteLoading = relayLoading || placeLoading

	// Merge and deduplicate results
	const mergedResults = useMemo(() => {
		if (!useRelay) return localResults
		if (!useLocal) {
			const resultGroups = groupSearchResults(remoteResults)
			const orderedResults = resultGroups.flatMap((group) => group.results)
			return {
				results: orderedResults,
				groups: resultGroups,
				totalCount: orderedResults.length,
				filteredCount: orderedResults.length,
				hasResults: orderedResults.length > 0,
			}
		}
		// Both: merge, dedup by id
		const seen = new Set(localResults.results.map(searchResultKey))
		const extra = remoteResults.filter((result) => {
			const key = searchResultKey(result)
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
		if (extra.length === 0) return localResults
		// The dropdown renders GROUPS, not the flat results array — relay-only
		// extras must be folded into the group list or they are invisible
		// (previously they were only reachable via keyboard navigation).
		const groups = localResults.groups.map((group) => ({ ...group, results: [...group.results] }))
		for (const result of extra) {
			let group = groups.find((g) => g.type === result.type)
			if (!group) {
				group = {
					type: result.type,
					label: ENTITY_TYPE_LABELS[result.type] ?? result.type,
					results: [],
					totalCount: 0,
					filteredCount: 0,
				}
				groups.push(group)
			}
			group.results.push(result)
			group.totalCount += 1
			group.filteredCount += 1
		}
		groups.sort(
			(left, right) =>
				SEARCH_GROUP_ORDER.indexOf(left.type) - SEARCH_GROUP_ORDER.indexOf(right.type),
		)
		const totalCount = groups.reduce((sum, group) => sum + group.totalCount, 0)
		const filteredCount = groups.reduce((sum, group) => sum + group.filteredCount, 0)
		return {
			...localResults,
			results: groups.flatMap((group) => group.results),
			groups,
			totalCount,
			filteredCount,
			hasResults: localResults.hasResults || extra.length > 0,
		}
	}, [useLocal, useRelay, localResults, remoteResults])

	const flatResults = mergedResults.results
	const hasAskRow = Boolean(onAsk) && isQuestionQuery(query)
	const selectableRowCount = flatResults.length + (hasAskRow ? 1 : 0)

	const handleAsk = useCallback(
		(question: string) => {
			const trimmed = question.trim()
			if (!trimmed || !onAsk) return
			onAsk(trimmed)
			setOpen(false)
			setQuery('')
			setSelectedIndex(-1)
		},
		[onAsk],
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault()
				setSelectedIndex((i) => Math.min(i + 1, selectableRowCount - 1))
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				setSelectedIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === 'Enter') {
				const target = resolveSearchEnterTarget(query, Boolean(onAsk), selectedIndex, flatResults)
				if (!target) return
				e.preventDefault()
				if (target.kind === 'ask') handleAsk(target.query)
				else {
					onSelect(target.result)
					setOpen(false)
					setQuery('')
					setSelectedIndex(-1)
				}
			} else if (e.key === 'Escape') {
				setOpen(false)
			}
		},
		[flatResults, handleAsk, onAsk, onSelect, query, selectableRowCount, selectedIndex],
	)

	const handleSelect = useCallback(
		(result: EntitySearchResult) => {
			onSelect(result)
			setOpen(false)
			setQuery('')
			setSelectedIndex(-1)
		},
		[onSelect],
	)

	const showPopover = open && (mergedResults.hasResults || remoteLoading || hasAskRow)

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
					{hasAskRow ? (
						<Button
							type="button"
							variant="ghost"
							className="flex h-auto w-full items-center justify-start gap-2 rounded-sm bg-primary/10 px-2 py-2 text-left hover:bg-primary/15"
							aria-selected={selectedIndex === 0}
							data-selected={selectedIndex === 0 || undefined}
							onClick={() => handleAsk(query)}
						>
							<Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-xs font-medium">
									Ask Earthly: “{query.trim()}”
								</span>
								<span className="block truncate text-[11px] text-muted-foreground">
									Get a read-only answer in the Margin
								</span>
							</span>
							<kbd className="font-mono text-[10px] text-muted-foreground">↵</kbd>
						</Button>
					) : null}
					{mergedResults.groups.map((group) => (
						<EntityResultGroup key={group.type} group={group}>
							{group.results.map((result) => {
								const globalIndex = flatResults.indexOf(result) + (hasAskRow ? 1 : 0)
								return (
									<EntityResultItem
										dragHandle={dragHandles}
										key={result.id}
										result={result}
										isSelected={globalIndex === selectedIndex}
										onSelect={handleSelect}
									/>
								)
							})}
						</EntityResultGroup>
					))}
					{remoteLoading && (
						<div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
							<Loader2 className="h-3 w-3 animate-spin" />
							Searching…
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
