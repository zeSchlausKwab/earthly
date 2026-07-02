/**
 * BeaconsPanelContent — the Beacons browse rail panel body (Phase 12, D-12).
 *
 * The structural twin of `SightingsPanelContent`: it subscribes to kind-37521
 * Live Beacons via `useBeacons()` (which `isLiveBeacon`-filters BEFORE cast AND
 * `dropExpired`s at the subscription against a 15s tick — T-12-04-EXPIRED /
 * Pitfall P-1, and reads ONLY the `#t:['live']` discovery surface so a link-only
 * beacon is never listed — T-12-04-LINKLEAK / P-6), feeds the casts through the
 * same `useFilterState` + `useSortedFilteredItems` browse hooks, and renders the
 * `EntitySearchToolbar` search/sort header.
 *
 * An accent **Share live location** button (`--primary`, reserved) sits at the
 * TOP of the panel — the create entry that opens the Start-beacon control flow
 * (wired in Plan 05 via `onShareLocation`). The user's own active beacon pins to
 * the TOP of the list as a distinct accent-ringed-when-live card with inline
 * **Stop sharing** (destructive-toned) + **Adjust** actions, so "am I live?" is
 * answerable from the index even when the map banner is scrolled away (UI-SPEC §1).
 *
 * Each row is a `rounded-none` `Card`: a label, a live/stale/ended status chip
 * (from `beaconState`), the last-seen age, the time-box countdown, and a
 * **Watch on map** action (the row is the click target).
 *
 * SECURITY (T-12-04-XSS): label/title render as auto-escaped React text nodes —
 * NO `dangerouslySetInnerHTML`.
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { MapPlus } from 'lucide-react'
import { useMemo } from 'react'
import { useBeacons, beaconState, type BeaconState } from '@/lib/hooks/useBeacons'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { formatExpiryCountdown, formatRelativeDate } from '@/lib/nostr/temporal-sighting'
import { cn } from '@/lib/utils'
import { InspectActionIcon, ZoomActionIcon } from '@/components/entity-action-icons'
import { UserProfile } from '@/components/user-profile'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

/** Shared ghost-button styling for the inline per-row action cluster (matches the
 * dataset/sighting catalog rows so every entity surface exposes the same affordances). */
const actionButtonClass =
	'rounded-none px-2 text-xs text-gray-600 shadow-none hover:bg-muted hover:text-sky-600'

export interface BeaconsPanelProps {
	currentUserPubkey?: string
	/** Open the Start-beacon control flow (the accent "Share live location" CTA + the
	 * rail New action). Wired in Plan 05. */
	onShareLocation: () => void
	/** Open a beacon's detail/view (the row is the click target). */
	onOpenBeacon: (beacon: LiveBeacon) => void
	/** Fly the map to the beacon's location and focus it ("Watch on map"). */
	onWatchOnMap?: (beacon: LiveBeacon) => void
	/**
	 * Phase 13 (SPEC §3.4): add this beacon to the Map Stack as a normal,
	 * non-isolated visible entry (mirrors the datasets rail onAddDatasetToMap).
	 * Absent ⇒ the affordance is hidden.
	 */
	onAddToMapStack?: (beacon: LiveBeacon) => void
	/** Stop the user's own active beacon (owner-only; wired in Plan 05). */
	onStopBeacon?: (beacon: LiveBeacon) => void
	/** Adjust the user's own active beacon — opens the control panel pre-filled,
	 * preserving the session d (owner-only; wired in Plan 05). */
	onAdjustBeacon?: (beacon: LiveBeacon) => void
	/**
	 * The d-tag/id key of the currently-viewed beacon. The matching row is
	 * highlighted + scrolled into view — how a map-marker click answers "where is
	 * this in the list?".
	 */
	selectedKey?: string | null
}

const beaconFilterConfig: FilterConfig<LiveBeacon> = {
	getSearchableText: (beacon) => [beacon.beacon.label, beacon.dTag],
	getName: (beacon) => beacon.beacon.label ?? beacon.dTag ?? 'Untitled',
}

/** The live/stale/ended status chip styling + label per UI-SPEC § Color. */
function statusChip(state: BeaconState): { label: string; className: string } {
	if (state === 'live') {
		return {
			label: 'LIVE',
			className: 'rounded-none bg-primary text-primary-foreground text-[11px]',
		}
	}
	if (state === 'ended') {
		return {
			label: 'ENDED',
			className: 'rounded-none bg-muted text-muted-foreground text-[11px]',
		}
	}
	// stale + removed (removed is dropped upstream, but keep the chip total)
	return {
		label: 'STALE',
		className: 'rounded-none bg-muted text-muted-foreground text-[11px]',
	}
}

interface BeaconRowProps {
	beacon: LiveBeacon
	/** True when the signed-in user owns this beacon — surfaces Stop/Adjust. */
	isOwner: boolean
	/** True when this beacon is the active map/detail selection — highlights. */
	isSelected: boolean
	now: number
	onOpen: () => void
	onWatch?: () => void
	onAddToMapStack?: () => void
	onStop?: () => void
	onAdjust?: () => void
}

function BeaconRow({
	beacon,
	isOwner,
	isSelected,
	now,
	onOpen,
	onWatch,
	onAddToMapStack,
	onStop,
	onAdjust,
}: BeaconRowProps) {
	const label = beacon.beacon.label?.trim() || 'Untitled'
	const state = beaconState(beacon, now)
	const chip = statusChip(state)
	// Honest last-seen age (created_at), surfaced as a friendly relative label.
	const lastSeen = formatRelativeDate(beacon.created_at)
	// Time-box countdown from the NIP-40 expiration.
	const countdown = formatExpiryCountdown(beacon.expiresAt, now)
	const isLive = state === 'live'

	return (
		<Card
			size="sm"
			className={cn(
				'rounded-none ring-1 ring-border',
				isSelected && 'bg-primary/5 ring-2 ring-primary',
				isOwner && isLive && 'ring-2 ring-primary',
			)}
		>
			<div className="space-y-1 p-2.5">
				<button
					type="button"
					onClick={onOpen}
					className="flex w-full min-w-0 items-center gap-2 text-left"
				>
					<p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</p>
					{isLive ? (
						<Badge className={cn(chip.className, 'shrink-0')}>{chip.label}</Badge>
					) : (
						<span className={cn(chip.className, 'shrink-0 px-1.5 py-0.5')}>{chip.label}</span>
					)}
				</button>

				<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
					<UserProfile pubkey={beacon.pubkey} mode="name-only" size="sm" showNip05Badge={false} />
					<span>·</span>
					<span>{state === 'ended' ? `ended ${lastSeen}` : `last seen ${lastSeen}`}</span>
					{countdown ? (
						<>
							<span>·</span>
							<span>{countdown}</span>
						</>
					) : null}
				</div>

				<div className="flex min-w-0 items-center justify-end gap-0.5">
					{onWatch ? (
						<Button
							size="icon-sm"
							variant="ghost"
							className={cn(actionButtonClass, 'hover:text-sky-600')}
							onClick={onWatch}
							aria-label="Watch on map"
							title="Watch on map"
						>
							<ZoomActionIcon className="h-4 w-4" />
						</Button>
					) : null}
					{onAddToMapStack ? (
						<Button
							size="icon-sm"
							variant="ghost"
							className={cn(actionButtonClass, 'hover:text-emerald-600')}
							onClick={onAddToMapStack}
							aria-label="Add to map stack"
							title="Add to map stack"
						>
							<MapPlus className="h-4 w-4" />
						</Button>
					) : null}
					<Button
						size="icon-sm"
						variant="ghost"
						className={cn(actionButtonClass, 'hover:text-emerald-600')}
						onClick={onOpen}
						aria-label="Open beacon"
						title="Open beacon"
					>
						<InspectActionIcon className="h-4 w-4" />
					</Button>
					{isOwner ? (
						<>
							{onAdjust ? (
								<Button
									size="sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-sky-600')}
									onClick={onAdjust}
									aria-label="Adjust beacon"
									title="Adjust"
								>
									Adjust
								</Button>
							) : null}
							{onStop ? (
								<Button
									size="sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-destructive')}
									onClick={onStop}
									aria-label="Stop sharing"
									title="Stop sharing"
								>
									Stop sharing
								</Button>
							) : null}
						</>
					) : null}
				</div>
			</div>
		</Card>
	)
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
	// useBeacons reads ONLY the #t:['live'] discovery surface (link-only beacons
	// are never matched — P-6) and already drops expired at the subscription on a
	// 15s tick (T-12-04-EXPIRED); the browse list mounts onto that correct path.
	const { events: beacons, eose } = useBeacons()
	const now = unixNow()

	const result = useSortedFilteredItems(beacons, beaconFilterConfig, filterState)
	const displayed = result.items

	// Pin the user's own active beacon(s) to the TOP so "am I live?" is answerable
	// from the index. Owns = same pubkey. The rest follow in sort order.
	const { ownBeacons, otherBeacons } = useMemo(() => {
		const own: LiveBeacon[] = []
		const others: LiveBeacon[] = []
		for (const beacon of displayed) {
			if (currentUserPubkey && beacon.pubkey === currentUserPubkey) own.push(beacon)
			else others.push(beacon)
		}
		return { ownBeacons: own, otherBeacons: others }
	}, [displayed, currentUserPubkey])

	const hasSearch = filterState.searchQuery.trim().length > 0

	const renderRow = (beacon: LiveBeacon, isOwner: boolean) => {
		const key = beacon.dTag ?? beacon.id
		return (
			<BeaconRow
				key={key}
				beacon={beacon}
				isOwner={isOwner}
				isSelected={selectedKey != null && key === selectedKey}
				now={now}
				onOpen={() => onOpenBeacon(beacon)}
				onWatch={onWatchOnMap ? () => onWatchOnMap(beacon) : undefined}
				onAddToMapStack={onAddToMapStack ? () => onAddToMapStack(beacon) : undefined}
				onStop={isOwner && onStopBeacon ? () => onStopBeacon(beacon) : undefined}
				onAdjust={isOwner && onAdjustBeacon ? () => onAdjustBeacon(beacon) : undefined}
			/>
		)
	}

	return (
		<div className="space-y-3">
			<Button
				onClick={onShareLocation}
				className="w-full rounded-none bg-primary text-primary-foreground"
			>
				Share live location
			</Button>

			<EntitySearchToolbar
				{...filterState}
				totalCount={result.totalCount}
				filteredCount={result.filteredCount}
				displayedCount={result.displayedCount}
				hasMore={result.hasMore}
				placeholder="Search beacons…"
			/>

			{!eose && beacons.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-20 w-full rounded-none" />
					))}
				</div>
			) : displayed.length === 0 ? (
				<Empty className="rounded-none">
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
							className="rounded-none bg-primary text-primary-foreground"
						>
							Share live location
						</Button>
					) : null}
				</Empty>
			) : (
				<div className="space-y-2">
					{ownBeacons.map((beacon) => renderRow(beacon, true))}
					{otherBeacons.map((beacon) => renderRow(beacon, false))}
				</div>
			)}
		</div>
	)
}
