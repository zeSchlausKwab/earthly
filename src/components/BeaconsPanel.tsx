/**
 * BeaconsPanelContent — the Beacons browse rail (Phase 12, D-12), rebuilt on the
 * shared entity-list grammar (redesign §11a "Four panels, one row grammar").
 *
 * It subscribes to kind-37521 Live Beacons via `useBeacons()` (which `isLiveBeacon`-
 * filters BEFORE cast, `dropExpired`s at the subscription against a 15s tick —
 * T-12-04-EXPIRED / P-1, and reads ONLY the `#t:['live']` discovery surface so a
 * link-only beacon is never listed — T-12-04-LINKLEAK / P-6), feeds the casts
 * through the shared browse hooks, and renders them through the common `ListPanel`
 * shell + `EntityListTable` + `createBeaconColumns` `ListRow`s.
 *
 * The user's own active beacon(s) pin to the TOP so "am I live?" is answerable from
 * the index, and a live beacon carries a green row accent.
 *
 * SECURITY (T-12-04-XSS): label/title render as auto-escaped React text nodes.
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { useCallback, useMemo } from 'react'
import { Radio } from 'lucide-react'
import { useEditorStore } from '@/features/geo-editor/store'
import { getBeaconMapStackKey } from '@/features/geo-editor/mapStackEntityKeys'
import { useBeacons, beaconState } from '@/lib/hooks/useBeacons'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import {
	AggregateMapLayerControl,
	BulkMapStackButton,
	EntityListTable,
	ListPanel,
} from '@/components/entity-list'
import {
	createBeaconColumns,
	type BeaconColumnsContext,
	type BeaconRowData,
} from './beacons-columns'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Button } from './ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

export interface BeaconsPanelProps {
	currentUserPubkey?: string
	/** Open the Start-beacon control flow (the "+ new" / Share live location CTA). */
	onShareLocation: () => void
	/** Open a beacon's detail/view. */
	onOpenBeacon: (beacon: LiveBeacon) => void
	/** Fly the map to the beacon's location and focus it ("Watch on map"). */
	onWatchOnMap?: (beacon: LiveBeacon) => void
	/** Phase 13 (SPEC §3.4): add this beacon to the Map Stack. Absent ⇒ hidden. */
	onAddToMapStack?: (
		beacon: LiveBeacon,
		source?: 'manual' | 'route' | 'browse-default' | 'own',
	) => void
	/** Stop the user's own active beacon (owner-only). */
	onStopBeacon?: (beacon: LiveBeacon) => void
	/** Adjust the user's own active beacon (owner-only). */
	onAdjustBeacon?: (beacon: LiveBeacon) => void
	/** The d-tag/id key of the currently-viewed beacon — highlighted + scrolled. */
	selectedKey?: string | null
}

const beaconFilterConfig: FilterConfig<LiveBeacon> = {
	getSearchableText: (beacon) => [beacon.beacon.label, beacon.dTag],
	getName: (beacon) => beacon.beacon.label ?? beacon.dTag ?? 'Untitled',
}

export function BeaconsPanelContent({
	currentUserPubkey,
	onShareLocation,
	onOpenBeacon,
	onWatchOnMap,
	onAddToMapStack,
	onStopBeacon,
	onAdjustBeacon,
	selectedKey,
}: BeaconsPanelProps) {
	const filterState = useFilterState()
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
	const { events: beacons, eose } = useBeacons()
	const now = unixNow()

	const result = useSortedFilteredItems(beacons, beaconFilterConfig, filterState)
	const displayed = result.items
	const allBeaconsLayer = mapStackEntries['beacon-layer:all']
	const allBeaconsVisible = Boolean(allBeaconsLayer?.visible)
	const toggleAllBeaconsLayer = useCallback(() => {
		if (allBeaconsLayer) {
			setMapStackEntryVisible(allBeaconsLayer.id, !allBeaconsLayer.visible)
			return
		}
		addMapStackEntry({
			entityType: 'beacon-layer',
			entityKey: 'all',
			title: 'Live beacons',
			source: 'manual',
			visible: true,
			pinned: false,
		})
	}, [allBeaconsLayer, addMapStackEntry, setMapStackEntryVisible])

	const columnsContext: BeaconColumnsContext = useMemo(
		() => ({
			onOpen: onOpenBeacon,
			onWatch: onWatchOnMap,
			onAddToMapStack,
			onStop: onStopBeacon,
			onAdjust: onAdjustBeacon,
		}),
		[onOpenBeacon, onWatchOnMap, onAddToMapStack, onStopBeacon, onAdjustBeacon],
	)
	const columns = useMemo(() => createBeaconColumns(columnsContext), [columnsContext])

	// Pin the user's own active beacon(s) to the TOP so "am I live?" is answerable
	// from the index; the rest follow in sort order.
	const rows: BeaconRowData[] = useMemo(() => {
		const own: BeaconRowData[] = []
		const others: BeaconRowData[] = []
		for (const beacon of displayed) {
			const isOwner = Boolean(currentUserPubkey) && beacon.pubkey === currentUserPubkey
			const key = beacon.dTag ?? beacon.id
			const rowData: BeaconRowData = {
				beacon,
				isOwner,
				isSelected: selectedKey != null && key === selectedKey,
				now,
			}
			if (isOwner) own.push(rowData)
			else others.push(rowData)
		}
		return [...own, ...others]
	}, [displayed, currentUserPubkey, selectedKey, now])

	const liveCount = useMemo(
		() => rows.reduce((count, row) => count + (beaconState(row.beacon, now) === 'live' ? 1 : 0), 0),
		[rows, now],
	)

	const hasSearch = filterState.searchQuery.trim().length > 0
	const stackableFilteredBeacons = useMemo(
		() =>
			result.filteredItems.filter((beacon) => {
				const key = getBeaconMapStackKey(beacon)
				return Boolean(key && !mapStackEntries[`beacon:${key}`])
			}),
		[result.filteredItems, mapStackEntries],
	)
	const addFilteredToMapStack = useCallback(() => {
		if (!onAddToMapStack) return
		for (const beacon of stackableFilteredBeacons) {
			onAddToMapStack(beacon, 'browse-default')
		}
	}, [onAddToMapStack, stackableFilteredBeacons])

	return (
		<ListPanel
			icon={Radio}
			accent="text-ok"
			title="Beacons"
			count={liveCount > 0 ? `${liveCount} live` : rows.length}
			onNew={onShareLocation}
			newLabel="Share live location"
			headerExtra={
				<AggregateMapLayerControl
					title="Live beacons layer"
					description="Show all discoverable live beacons on the map, independent of these filters."
					count={beacons.length}
					visible={allBeaconsVisible}
					onToggle={toggleAllBeaconsLayer}
					accent="ok"
				/>
			}
			titleAccessory={
				<BulkMapStackButton
					count={stackableFilteredBeacons.length}
					onClick={onAddToMapStack ? addFilteredToMapStack : undefined}
					label="Add filtered beacons to map stack"
				/>
			}
			toolbar={
				<EntitySearchToolbar
					{...filterState}
					totalCount={result.totalCount}
					filteredCount={result.filteredCount}
					displayedCount={result.displayedCount}
					hasMore={result.hasMore}
					placeholder="Search beacons…"
				/>
			}
			footerLeft={`${rows.length} shown`}
			footerRight={liveCount > 0 ? `${liveCount} live` : undefined}
		>
			{!eose && beacons.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-16 w-full rounded-[3px]" />
					))}
				</div>
			) : rows.length === 0 ? (
				<Empty className="rounded-[3px]">
					<EmptyHeader>
						<EmptyTitle>{hasSearch ? 'No beacons match' : 'No live beacons'}</EmptyTitle>
						<EmptyDescription>
							{hasSearch
								? 'Try a different search, or clear the filter.'
								: "Nobody's sharing a live location right now. Share yours to put a live dot on the map."}
						</EmptyDescription>
					</EmptyHeader>
					{!hasSearch ? (
						<Button
							onClick={onShareLocation}
							className="rounded-[2px] bg-primary text-primary-foreground"
						>
							Share live location
						</Button>
					) : null}
				</Empty>
			) : (
				<EntityListTable
					columns={columns}
					data={rows}
					getRowId={(row) => row.beacon.dTag ?? row.beacon.id}
				/>
			)}
		</ListPanel>
	)
}
