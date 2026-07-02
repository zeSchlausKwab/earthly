/**
 * SightingsPanelContent — the Sightings browse rail panel body (Phase 11, D-07).
 *
 * The structural twin of `StoriesPanelContent`: it subscribes to kind-37522
 * Temporal Sightings via `useSightings()` (which `isTemporalSighting`-filters
 * BEFORE cast AND `dropExpired`s at the subscription — T-11-03-02 / Pitfall P-1),
 * feeds the casts through the same `useFilterState` + `useSortedFilteredItems`
 * browse hooks, and renders the `EntitySearchToolbar` search/sort header.
 *
 * An accent **New Sighting** button (`--primary`, reserved) sits at the TOP of
 * the panel — the discoverability entry that arms the map-first pin-drop create
 * (D-01), closing the Phase-9 built-but-unwired gap. Each row is a `rounded-none`
 * `Card`: a title, a one-line description, an observation-state cue chip
 * (LIVE / Upcoming / relative date via `classifyObservationState`) and an expiry
 * countdown ("Fades in 6 days" / "Fades soon"), author/date meta, a Draft/
 * Published `Badge`, and an inline action footer matching the dataset/context
 * catalog rows: a compact `GeoSocialActions` bar (like / zap / comment / share)
 * plus inspect/edit/delete buttons (edit + delete owner-gated). A row clicked
 * from its map marker is highlighted + scrolled into view (`selectedKey`).
 *
 * SECURITY (T-11-03-01): title/description render as auto-escaped React text
 * nodes — NO `dangerouslySetInnerHTML`.
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { MapPlus } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useSightings } from '@/lib/hooks/useSightings'
import {
	type TemporalSighting,
	classifyObservationState,
	formatExpiryCountdown,
	formatRelativeDate,
	readSightingDraft,
} from '@/lib/nostr/temporal-sighting'
import { cn } from '@/lib/utils'
import {
	DeleteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
	ZoomActionIcon,
} from '@/components/entity-action-icons'
import { GeoSocialActions } from '@/features/social/comments/GeoSocialActions'
import { UserProfile } from '@/components/user-profile'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

/** Shared ghost-button styling for the inline per-row action cluster (matches the
 * dataset/context catalog rows so every entity surface exposes the same affordances). */
const actionButtonClass =
	'rounded-none px-2 text-xs text-gray-600 shadow-none hover:bg-muted hover:text-sky-600'

export interface SightingsPanelProps {
	currentUserPubkey?: string
	onOpenSighting: (sighting: TemporalSighting) => void
	onCreateSighting: () => void
	onEditSighting: (sighting: TemporalSighting) => void
	onDeleteSighting: (sighting: TemporalSighting) => void
	/** Fly the map to the Sighting's location and focus it (the dataset/context
	 * "zoom + show on map" affordance — sightings always render, so this centers
	 * + highlights rather than toggling stack membership). */
	onZoomToSighting?: (sighting: TemporalSighting) => void
	/**
	 * Phase 13 (SPEC §3.4): add this Sighting to the Map Stack as a normal,
	 * non-isolated visible entry (mirrors the datasets rail onAddDatasetToMap).
	 * Absent ⇒ the affordance is hidden.
	 */
	onAddToMapStack?: (sighting: TemporalSighting) => void
	/** The d-tag key of a Sighting whose delete is in flight (disables its row menu). */
	deletingKey?: string | null
	/**
	 * The d-tag/id key of the currently-viewed Sighting. The matching row is
	 * highlighted and scrolled into view — this is how a map-marker click answers
	 * "where is this in the list?" (the marker click opens the detail AND surfaces
	 * the row in the rail).
	 */
	selectedKey?: string | null
}

const sightingFilterConfig: FilterConfig<TemporalSighting> = {
	getSearchableText: (sighting) => {
		const content = sighting.sighting
		return [content.title, content.description, sighting.dTag]
	},
	getName: (sighting) => sighting.sighting.title ?? sighting.dTag ?? 'Untitled',
}

interface SightingRowProps {
	sighting: TemporalSighting
	hasLocalDraft: boolean
	isDeleting: boolean
	/** True when the signed-in user authored this Sighting — gates Edit/Delete. */
	isOwner: boolean
	/** True when this Sighting is the active map/detail selection — highlights + scrolls. */
	isSelected: boolean
	now: number
	onOpen: () => void
	onZoomTo?: () => void
	onAddToMapStack?: () => void
	onEdit: () => void
	onDelete: () => void
}

function SightingRow({
	sighting,
	hasLocalDraft,
	isDeleting,
	isOwner,
	isSelected,
	now,
	onOpen,
	onZoomTo,
	onAddToMapStack,
	onEdit,
	onDelete,
}: SightingRowProps) {
	const content = sighting.sighting
	const title = content.title?.trim() || 'Untitled'
	const obsState = classifyObservationState(content.start, content.end, now)
	const expiryCountdown = formatExpiryCountdown(sighting.expiresAt, now)
	const rowRef = useRef<HTMLDivElement | null>(null)

	// When a map-marker click selects this Sighting, bring its row into view so the
	// user can locate it in the rail ("where is the item in the list?").
	useEffect(() => {
		if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' })
	}, [isSelected])

	const cue =
		obsState === 'live'
			? { label: 'LIVE', className: 'rounded-none bg-primary text-primary-foreground text-[11px]' }
			: obsState === 'upcoming'
				? {
						label: 'Upcoming',
						className: 'rounded-none bg-secondary text-secondary-foreground text-[11px]',
					}
				: {
						label: formatRelativeDate(content.end ?? content.start),
						className: 'rounded-none text-[11px] text-muted-foreground',
					}

	return (
		<Card
			size="sm"
			className={cn(
				'rounded-none ring-1 ring-border',
				isSelected && 'bg-primary/5 ring-2 ring-primary',
			)}
		>
			{/* Compact, dataset/context-density layout: title + state on one line,
			    author/time/expiry on the next, the social + action cluster below.
			    The full description lives in the detail view and the map hover popup. */}
			<div ref={rowRef} className="space-y-1 p-2.5">
				<button
					type="button"
					onClick={onOpen}
					className="flex w-full min-w-0 items-center gap-2 text-left"
				>
					<p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
					{obsState === 'past' ? (
						<span className={cn(cue.className, 'shrink-0')}>{cue.label}</span>
					) : (
						<Badge className={cn(cue.className, 'shrink-0')}>{cue.label}</Badge>
					)}
					{hasLocalDraft ? (
						<Badge variant="outline" className="shrink-0 rounded-none text-[11px]">
							Draft
						</Badge>
					) : null}
				</button>

				<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
					<UserProfile pubkey={sighting.pubkey} mode="name-only" size="sm" showNip05Badge={false} />
					<span>·</span>
					<span>{formatRelativeDate(sighting.created_at)}</span>
					{expiryCountdown ? (
						<>
							<span>·</span>
							<span>{expiryCountdown}</span>
						</>
					) : null}
				</div>

				{/* Inline social + action cluster — parity with the dataset/context rows:
				    like / zap / comment / share on the left (the Share button copies the
				    deep link, replacing the old "Copy link" menu item), and zoom/inspect/
				    edit/delete on the right (edit + delete owner-gated). */}
				<div className="flex min-w-0 items-center justify-between gap-3">
					<GeoSocialActions
						target={sighting}
						onReplyClick={onOpen}
						showCommentButton
						showAnnotateButton={false}
						loadCounts={false}
						compact
						className="-ml-2 shrink-0 gap-0"
					/>
					<div className="flex shrink-0 items-center gap-0.5">
						{onZoomTo ? (
							<Button
								size="icon-sm"
								variant="ghost"
								className={cn(actionButtonClass, 'hover:text-sky-600')}
								onClick={onZoomTo}
								aria-label="Zoom to sighting on map"
								title="Zoom to on map"
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
							aria-label="Open sighting"
							title="Open sighting"
						>
							<InspectActionIcon className="h-4 w-4" />
						</Button>
						{isOwner ? (
							<>
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-sky-600')}
									onClick={onEdit}
									disabled={isDeleting}
									aria-label="Edit sighting"
									title="Edit sighting"
								>
									<LoadEditorActionIcon className="h-4 w-4" />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									className={cn(actionButtonClass, 'hover:text-destructive')}
									onClick={onDelete}
									disabled={isDeleting}
									aria-label="Delete sighting"
									title="Delete sighting"
								>
									<DeleteActionIcon className="h-4 w-4" />
								</Button>
							</>
						) : null}
					</div>
				</div>
			</div>
		</Card>
	)
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
	// useSightings already drops expired at the subscription (SIGHT-03); the browse
	// list mounts onto that already-correct path (Pitfall P-1).
	const { events: sightings, eose } = useSightings()
	const now = unixNow()

	const result = useSortedFilteredItems(sightings, sightingFilterConfig, filterState)
	const displayed = result.items

	// Detect a local (unpublished) draft per Sighting so the row shows a Draft chip.
	const draftKeys = useMemo(() => {
		const keys = new Set<string>()
		for (const sighting of displayed) {
			const dTag = sighting.dTag
			if (dTag && readSightingDraft(dTag, currentUserPubkey)) keys.add(dTag)
		}
		return keys
	}, [displayed, currentUserPubkey])

	const hasSearch = filterState.searchQuery.trim().length > 0

	return (
		<div className="space-y-3">
			<Button
				onClick={onCreateSighting}
				className="w-full rounded-none bg-primary text-primary-foreground"
			>
				New Sighting
			</Button>

			<EntitySearchToolbar
				{...filterState}
				totalCount={result.totalCount}
				filteredCount={result.filteredCount}
				displayedCount={result.displayedCount}
				hasMore={result.hasMore}
				placeholder="Search sightings…"
			/>

			{!eose && sightings.length === 0 ? (
				<div className="space-y-2">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-20 w-full rounded-none" />
					))}
				</div>
			) : displayed.length === 0 ? (
				<Empty className="rounded-none">
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
				<div className="space-y-2">
					{displayed.map((sighting) => {
						const dTag = sighting.dTag ?? sighting.id
						return (
							<SightingRow
								key={dTag}
								sighting={sighting}
								hasLocalDraft={Boolean(sighting.dTag && draftKeys.has(sighting.dTag))}
								isDeleting={deletingKey === dTag}
								isOwner={Boolean(currentUserPubkey) && sighting.pubkey === currentUserPubkey}
								isSelected={selectedKey != null && dTag === selectedKey}
								now={now}
								onOpen={() => onOpenSighting(sighting)}
								onZoomTo={onZoomToSighting ? () => onZoomToSighting(sighting) : undefined}
								onAddToMapStack={onAddToMapStack ? () => onAddToMapStack(sighting) : undefined}
								onEdit={() => onEditSighting(sighting)}
								onDelete={() => onDeleteSighting(sighting)}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}
