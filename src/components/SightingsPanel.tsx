/**
 * SightingsPanelContent — the Sightings browse rail (Phase 11, D-07), rebuilt on
 * the shared entity-list grammar (redesign §11a "Four panels, one row grammar").
 *
 * It subscribes to kind-37522 Temporal Sightings via `useSightings()` (which
 * `isTemporalSighting`-filters BEFORE cast AND `dropExpired`s at the subscription —
 * T-11-03-02 / Pitfall P-1), feeds the casts through the shared `useFilterState` +
 * `useSortedFilteredItems` browse hooks, and renders them through the common
 * `ListPanel` shell + `EntityListTable` + `createSightingColumns` `ListRow`s — the
 * same substrate as Datasets/Contexts/Stories/Beacons. A row clicked from its map
 * marker is highlighted + scrolled into view (`selectedKey`).
 *
 * SECURITY (T-11-03-01): title/description render as auto-escaped React text nodes.
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { useCallback, useMemo } from 'react'
import { Eye } from 'lucide-react'
import { useEditorStore } from '@/features/geo-editor/store'
import { getSightingMapStackKey } from '@/features/geo-editor/mapStackEntityKeys'
import { useSightings } from '@/lib/hooks/useSightings'
import { type TemporalSighting, readSightingDraft } from '@/lib/nostr/temporal-sighting'
import {
	AggregateMapLayerControl,
	BulkMapStackButton,
	EntityListTable,
	ListPanel,
} from '@/components/entity-list'
import {
	createSightingColumns,
	type SightingColumnsContext,
	type SightingRowData,
} from './sightings-columns'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

export interface SightingsPanelProps {
	currentUserPubkey?: string
	onOpenSighting: (sighting: TemporalSighting) => void
	onCreateSighting: () => void
	onEditSighting: (sighting: TemporalSighting) => void
	onDeleteSighting: (sighting: TemporalSighting) => void
	/** Fly the map to the Sighting's location and focus it. */
	onZoomToSighting?: (sighting: TemporalSighting) => void
	/** Phase 13 (SPEC §3.4): add this Sighting to the Map Stack. Absent ⇒ hidden. */
	onAddToMapStack?: (
		sighting: TemporalSighting,
		source?: 'manual' | 'route' | 'browse-default',
	) => void
	/** The d-tag key of a Sighting whose delete is in flight. */
	deletingKey?: string | null
	/** The d-tag/id key of the currently-viewed Sighting — highlighted + scrolled. */
	selectedKey?: string | null
}

const sightingFilterConfig: FilterConfig<TemporalSighting> = {
	getSearchableText: (sighting) => {
		const content = sighting.sighting
		return [content.title, content.description, sighting.dTag]
	},
	getName: (sighting) => sighting.sighting.title ?? sighting.dTag ?? 'Untitled',
}

export function SightingsPanelContent({
	currentUserPubkey,
	onOpenSighting,
	onCreateSighting,
	onEditSighting,
	onDeleteSighting,
	onZoomToSighting,
	onAddToMapStack,
	deletingKey,
	selectedKey,
}: SightingsPanelProps) {
	const filterState = useFilterState()
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
	// useSightings already drops expired at the subscription (SIGHT-03).
	const { events: sightings, eose } = useSightings()
	const now = unixNow()

	const result = useSortedFilteredItems(sightings, sightingFilterConfig, filterState)
	const displayed = result.items
	const allSightingsLayer = mapStackEntries['sighting-layer:all']
	const allSightingsVisible = Boolean(allSightingsLayer?.visible)
	const toggleAllSightingsLayer = useCallback(() => {
		if (allSightingsLayer) {
			setMapStackEntryVisible(allSightingsLayer.id, !allSightingsLayer.visible)
			return
		}
		addMapStackEntry({
			entityType: 'sighting-layer',
			entityKey: 'all',
			title: 'All sightings',
			source: 'manual',
			visible: true,
			pinned: false,
		})
	}, [allSightingsLayer, addMapStackEntry, setMapStackEntryVisible])

	// Detect a local (unpublished) draft per Sighting so the row shows a Draft chip.
	const draftKeys = useMemo(() => {
		const keys = new Set<string>()
		for (const sighting of displayed) {
			const dTag = sighting.dTag
			if (dTag && readSightingDraft(dTag, currentUserPubkey)) keys.add(dTag)
		}
		return keys
	}, [displayed, currentUserPubkey])

	const columnsContext: SightingColumnsContext = useMemo(
		() => ({
			onOpen: onOpenSighting,
			onZoomTo: onZoomToSighting,
			onAddToMapStack,
			onEdit: onEditSighting,
			onDelete: onDeleteSighting,
		}),
		[onOpenSighting, onZoomToSighting, onAddToMapStack, onEditSighting, onDeleteSighting],
	)
	const columns = useMemo(() => createSightingColumns(columnsContext), [columnsContext])

	const rows: SightingRowData[] = useMemo(
		() =>
			displayed.map((sighting) => {
				const dTag = sighting.dTag ?? sighting.id
				return {
					sighting,
					hasLocalDraft: Boolean(sighting.dTag && draftKeys.has(sighting.dTag)),
					isOwner: Boolean(currentUserPubkey) && sighting.pubkey === currentUserPubkey,
					isSelected: selectedKey != null && dTag === selectedKey,
					isDeleting: deletingKey === dTag,
					now,
				}
			}),
		[displayed, draftKeys, currentUserPubkey, selectedKey, deletingKey, now],
	)

	const liveOrDrafts = draftKeys.size

	const hasSearch = filterState.searchQuery.trim().length > 0
	const stackableFilteredSightings = useMemo(
		() =>
			result.filteredItems.filter((sighting) => {
				const key = getSightingMapStackKey(sighting)
				return Boolean(key && !mapStackEntries[`sighting:${key}`])
			}),
		[result.filteredItems, mapStackEntries],
	)
	const addFilteredToMapStack = useCallback(() => {
		if (!onAddToMapStack) return
		for (const sighting of stackableFilteredSightings) {
			onAddToMapStack(sighting, 'browse-default')
		}
	}, [onAddToMapStack, stackableFilteredSightings])

	return (
		<ListPanel
			icon={Eye}
			title="Sightings"
			count={result.totalCount}
			onNew={onCreateSighting}
			newLabel="New Sighting"
			headerExtra={
				<AggregateMapLayerControl
					title="All sightings layer"
					description="Show every current sighting on the map, independent of these filters."
					count={sightings.length}
					visible={allSightingsVisible}
					onToggle={toggleAllSightingsLayer}
				/>
			}
			titleAccessory={
				<BulkMapStackButton
					count={stackableFilteredSightings.length}
					onClick={onAddToMapStack ? addFilteredToMapStack : undefined}
					label="Add filtered sightings to map stack"
				/>
			}
			toolbar={
				<EntitySearchToolbar
					{...filterState}
					totalCount={result.totalCount}
					filteredCount={result.filteredCount}
					displayedCount={result.displayedCount}
					hasMore={result.hasMore}
					placeholder="Search sightings…"
				/>
			}
			footerLeft={`${rows.length} shown`}
			footerRight={liveOrDrafts > 0 ? `${liveOrDrafts} draft` : undefined}
		>
			{!eose && sightings.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-16 w-full rounded-[3px]" />
					))}
				</div>
			) : rows.length === 0 ? (
				<Empty className="rounded-[3px]">
					<EmptyHeader>
						<EmptyTitle>{hasSearch ? 'No sightings match' : 'No sightings yet'}</EmptyTitle>
						<EmptyDescription>
							{hasSearch
								? 'Try a different search, or clear the filter.'
								: 'Spotted something? Drop your first sighting on the map.'}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<EntityListTable
					columns={columns}
					data={rows}
					getRowId={(row) => row.sighting.dTag ?? row.sighting.id}
				/>
			)}
		</ListPanel>
	)
}
