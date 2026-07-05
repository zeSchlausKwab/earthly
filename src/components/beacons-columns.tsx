import type { ColumnDef } from '@tanstack/react-table'
import { MapPlus, Power, Radio } from 'lucide-react'
import { useEffect, useRef } from 'react'
import {
	InspectActionIcon,
	LoadEditorActionIcon,
	ZoomActionIcon,
} from '@/components/entity-action-icons'
import { ListRow, RowActionButton, RowBadge } from '@/components/entity-list'
import { UserProfile } from '@/components/user-profile'
import { type BeaconState, beaconState } from '@/lib/hooks/useBeacons'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { formatExpiryCountdown, formatRelativeDate } from '@/lib/nostr/temporal-sighting'
import { cn } from '@/lib/utils'

export interface BeaconRowData {
	beacon: LiveBeacon
	/** True when the signed-in user owns this beacon — surfaces Stop/Adjust. */
	isOwner: boolean
	/** True when this beacon is the active map/detail selection — highlights. */
	isSelected: boolean
	now: number
}

export interface BeaconColumnsContext {
	onOpen: (beacon: LiveBeacon) => void
	onWatch?: (beacon: LiveBeacon) => void
	onAddToMapStack?: (beacon: LiveBeacon) => void
	onStop?: (beacon: LiveBeacon) => void
	onAdjust?: (beacon: LiveBeacon) => void
}

/** The live/stale/ended status chip label + styling per UI-SPEC § Color. */
function statusChip(state: BeaconState): { label: string; className: string } {
	if (state === 'live') return { label: 'LIVE', className: 'bg-ok text-white' }
	if (state === 'ended') return { label: 'ENDED', className: 'bg-muted text-muted-foreground' }
	return { label: 'STALE', className: 'bg-muted text-muted-foreground' }
}

function BeaconListRow({ row, context }: { row: BeaconRowData; context: BeaconColumnsContext }) {
	const { beacon, isOwner, isSelected, now } = row
	const label = beacon.beacon.label?.trim() || 'Untitled'
	const state = beaconState(beacon, now)
	const chip = statusChip(state)
	const isLive = state === 'live'
	const lastSeen = formatRelativeDate(beacon.created_at)
	const countdown = formatExpiryCountdown(beacon.expiresAt, now)
	const rowRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (isSelected) rowRef.current?.scrollIntoView({ block: 'nearest' })
	}, [isSelected])

	return (
		<ListRow
			rowRef={rowRef}
			leading={
				<div
					className={cn(
						'relative flex h-[34px] w-[34px] items-center justify-center rounded-full',
						isLive ? 'bg-ok/20 text-ok' : 'bg-muted text-muted-foreground',
					)}
				>
					<Radio className="h-4 w-4" />
					{isLive ? (
						<span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-card" />
					) : null}
				</div>
			}
			title={label}
			// Design §11a: the live beacon carries a green accent; map-selection keeps
			// the shared amber wash for consistency with the other rails.
			selected={isSelected || (isOwner && isLive)}
			selectedClassName={isLive ? 'border-l-ok bg-ok/[0.08]' : undefined}
			onTitleClick={() => context.onOpen(beacon)}
			titleAriaLabel={`Open beacon ${label}`}
			titleTitle="Open beacon"
			badges={<RowBadge label={chip.label} className={chip.className} />}
			meta={
				<>
					<UserProfile pubkey={beacon.pubkey} mode="name-only" size="sm" showNip05Badge={false} />
					<span>·</span>
					<span>{state === 'ended' ? `ended ${lastSeen}` : `last seen ${lastSeen}`}</span>
					{countdown ? (
						<>
							<span>·</span>
							<span>{countdown}</span>
						</>
					) : null}
				</>
			}
			actions={
				<>
					{context.onWatch ? (
						<RowActionButton
							icon={ZoomActionIcon}
							label="Watch on map"
							onClick={() => context.onWatch?.(beacon)}
						/>
					) : null}
					{context.onAddToMapStack ? (
						<RowActionButton
							icon={MapPlus}
							label="Add to map stack"
							hover="hover:text-ok"
							onClick={() => context.onAddToMapStack?.(beacon)}
						/>
					) : null}
					<RowActionButton
						icon={InspectActionIcon}
						label="Open beacon"
						hover="hover:text-ok"
						onClick={() => context.onOpen(beacon)}
					/>
					{isOwner && context.onAdjust ? (
						<RowActionButton
							icon={LoadEditorActionIcon}
							label="Adjust beacon"
							onClick={() => context.onAdjust?.(beacon)}
						/>
					) : null}
					{isOwner && context.onStop ? (
						<RowActionButton
							icon={Power}
							label="Stop sharing"
							hover="hover:text-destructive"
							onClick={() => context.onStop?.(beacon)}
						/>
					) : null}
				</>
			}
		/>
	)
}

export const createBeaconColumns = (context: BeaconColumnsContext): ColumnDef<BeaconRowData>[] => [
	{
		accessorKey: 'beacon',
		cell: ({ row }) => <BeaconListRow row={row.original} context={context} />,
	},
]
