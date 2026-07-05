import type { ColumnDef } from '@tanstack/react-table'
import { Eye, MapPlus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
	DeleteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
	ZoomActionIcon,
} from '@/components/entity-action-icons'
import { GlyphTile, ListRow, RowActionButton, RowBadge } from '@/components/entity-list'
import { GeoSocialActions } from '@/features/social/comments/GeoSocialActions'
import { UserProfile } from '@/components/user-profile'
import {
	type TemporalSighting,
	classifyObservationState,
	formatExpiryCountdown,
	formatRelativeDate,
} from '@/lib/nostr/temporal-sighting'

export interface SightingRowData {
	sighting: TemporalSighting
	hasLocalDraft: boolean
	/** True when the signed-in user authored this Sighting — gates Edit/Delete. */
	isOwner: boolean
	/** True when this Sighting is the active map/detail selection — highlights + scrolls. */
	isSelected: boolean
	isDeleting: boolean
	now: number
}

export interface SightingColumnsContext {
	onOpen: (sighting: TemporalSighting) => void
	onZoomTo?: (sighting: TemporalSighting) => void
	onAddToMapStack?: (sighting: TemporalSighting) => void
	onEdit: (sighting: TemporalSighting) => void
	onDelete: (sighting: TemporalSighting) => void
}

/** The observation-state cue chip (LIVE / Upcoming / relative date). */
function sightingCue(sighting: TemporalSighting, now: number) {
	const content = sighting.sighting
	const state = classifyObservationState(content.start, content.end, now)
	if (state === 'live') return { label: 'LIVE', className: 'bg-primary text-primary-foreground' }
	if (state === 'upcoming')
		return { label: 'Upcoming', className: 'bg-secondary text-secondary-foreground' }
	return {
		label: formatRelativeDate(content.end ?? content.start),
		className: 'bg-muted text-muted-foreground',
	}
}

function SightingListRow({
	row,
	context,
}: {
	row: SightingRowData
	context: SightingColumnsContext
}) {
	const { sighting, hasLocalDraft, isOwner, isSelected, isDeleting, now } = row
	const content = sighting.sighting
	const title = content.title?.trim() || 'Untitled'
	const cue = sightingCue(sighting, now)
	const expiryCountdown = formatExpiryCountdown(sighting.expiresAt, now)
	const rowRef = useRef<HTMLDivElement | null>(null)

	// When a map-marker click selects this Sighting, bring its row into view.
	useEffect(() => {
		if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' })
	}, [isSelected])

	return (
		<ListRow
			rowRef={rowRef}
			leading={<GlyphTile icon={Eye} className="bg-primary/15 text-primary" />}
			title={title}
			selected={isSelected}
			onTitleClick={() => context.onOpen(sighting)}
			titleAriaLabel={`Open sighting ${title}`}
			titleTitle="Open sighting"
			badges={
				<>
					<RowBadge label={cue.label} className={cue.className} />
					{hasLocalDraft ? (
						<RowBadge label="Draft" className="border border-border text-muted-foreground" />
					) : null}
				</>
			}
			meta={
				<>
					<UserProfile pubkey={sighting.pubkey} mode="name-only" size="sm" showNip05Badge={false} />
					<span>·</span>
					<span>{formatRelativeDate(sighting.created_at)}</span>
					{expiryCountdown ? (
						<>
							<span>·</span>
							<span>{expiryCountdown}</span>
						</>
					) : null}
				</>
			}
			engage={
				<GeoSocialActions
					target={sighting}
					onReplyClick={() => context.onOpen(sighting)}
					showCommentButton
					showAnnotateButton={false}
					loadCounts={false}
					compact
					className="-ml-2 shrink-0 gap-0"
				/>
			}
			actions={
				<>
					{context.onZoomTo ? (
						<RowActionButton
							icon={ZoomActionIcon}
							label="Zoom to on map"
							onClick={() => context.onZoomTo?.(sighting)}
						/>
					) : null}
					{context.onAddToMapStack ? (
						<RowActionButton
							icon={MapPlus}
							label="Add to map stack"
							hover="hover:text-ok"
							onClick={() => context.onAddToMapStack?.(sighting)}
						/>
					) : null}
					<RowActionButton
						icon={InspectActionIcon}
						label="Open sighting"
						hover="hover:text-ok"
						onClick={() => context.onOpen(sighting)}
					/>
					{isOwner ? (
						<>
							<RowActionButton
								icon={LoadEditorActionIcon}
								label="Edit sighting"
								disabled={isDeleting}
								onClick={() => context.onEdit(sighting)}
							/>
							<RowActionButton
								icon={DeleteActionIcon}
								label="Delete sighting"
								hover="hover:text-destructive"
								disabled={isDeleting}
								onClick={() => context.onDelete(sighting)}
							/>
						</>
					) : null}
				</>
			}
		/>
	)
}

export const createSightingColumns = (
	context: SightingColumnsContext,
): ColumnDef<SightingRowData>[] => [
	{
		accessorKey: 'sighting',
		cell: ({ row }) => <SightingListRow row={row.original} context={context} />,
	},
]
