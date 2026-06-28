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
 * Published `Badge`, and a ⋮ `DropdownMenu` (Open / Edit / Copy link / Delete).
 *
 * SECURITY (T-11-03-01): title/description render as auto-escaped React text
 * nodes — NO `dangerouslySetInnerHTML`.
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { MoreVertical } from 'lucide-react'
import { useMemo } from 'react'
import { useSightings } from '@/lib/hooks/useSightings'
import {
	type TemporalSighting,
	classifyObservationState,
	formatExpiryCountdown,
	formatRelativeDate,
	readSightingDraft,
} from '@/lib/nostr/temporal-sighting'
import { UserProfile } from '@/components/user-profile'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './ui/empty'
import { Skeleton } from './ui/skeleton'

export interface SightingsPanelProps {
	currentUserPubkey?: string
	onOpenSighting: (sighting: TemporalSighting) => void
	onCreateSighting: () => void
	onEditSighting: (sighting: TemporalSighting) => void
	onDeleteSighting: (sighting: TemporalSighting) => void
	/** The d-tag key of a Sighting whose delete is in flight (disables its row menu). */
	deletingKey?: string | null
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
	now: number
	onOpen: () => void
	onEdit: () => void
	onDelete: () => void
	onCopyLink: () => void
}

function SightingRow({
	sighting,
	hasLocalDraft,
	isDeleting,
	now,
	onOpen,
	onEdit,
	onDelete,
	onCopyLink,
}: SightingRowProps) {
	const content = sighting.sighting
	const title = content.title?.trim() || 'Untitled'
	const description = content.description?.trim()
	const obsState = classifyObservationState(content.start, content.end, now)
	const expiryCountdown = formatExpiryCountdown(sighting.expiresAt, now)

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
		<Card size="sm" className="rounded-none ring-1 ring-border">
			<div className="flex gap-3 p-3">
				<button
					type="button"
					onClick={onOpen}
					className="flex min-w-0 flex-1 items-start gap-3 text-left"
				>
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex items-center gap-2">
							<p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
								{title}
							</p>
							{hasLocalDraft ? (
								<Badge variant="outline" className="rounded-none text-[11px]">
									Draft
								</Badge>
							) : null}
						</div>
						{description ? (
							<p className="truncate text-[13px] text-muted-foreground">{description}</p>
						) : null}
						<div className="flex flex-wrap items-center gap-2 text-[11px]">
							{obsState === 'past' ? (
								<span className={cue.className}>{cue.label}</span>
							) : (
								<Badge className={cue.className}>{cue.label}</Badge>
							)}
							{expiryCountdown ? (
								<span className="text-muted-foreground">{expiryCountdown}</span>
							) : null}
						</div>
						<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
							<UserProfile
								pubkey={sighting.pubkey}
								mode="name-only"
								size="sm"
								showNip05Badge={false}
							/>
							<span>·</span>
							<span>{formatRelativeDate(sighting.created_at)}</span>
						</div>
					</div>
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0 rounded-none"
							aria-label="Sighting actions"
							disabled={isDeleting}
						>
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="rounded-none">
						<DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
						<DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
						<DropdownMenuItem onClick={onCopyLink}>Copy link</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={onDelete} className="text-destructive">
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
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
	deletingKey,
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

	const handleCopyLink = (sighting: TemporalSighting) => {
		// Plan 04 wires the canonical /sighting/:naddr deep link + OG card. Here we
		// copy the addressable coordinate so the action is functional pre-routing.
		const coordinate = `${sighting.kind}:${sighting.pubkey}:${sighting.dTag ?? ''}`
		void navigator.clipboard?.writeText(coordinate)
	}

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
								now={now}
								onOpen={() => onOpenSighting(sighting)}
								onEdit={() => onEditSighting(sighting)}
								onDelete={() => onDeleteSighting(sighting)}
								onCopyLink={() => handleCopyLink(sighting)}
							/>
						)
					})}
				</div>
			)}
		</div>
	)
}
