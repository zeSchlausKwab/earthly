/**
 * BeaconViewPanel — the reader-facing view surface for a kind-37521 Live Beacon
 * (Phase 12, BEACON-03/04, D-11). The structural twin of `SightingViewPanel`,
 * cloned with `LiveBeacon` substituted and the Sighting-only machinery STRIPPED:
 *   - no observation-time range row (a beacon has live/stale/ended staleness, not
 *     an observation window),
 *   - NO `CommentsPanel`/`GeoSocialActions` mount — comment/react on beacons is
 *     DEFERRED to Phase 13 / XCUT-01 per research Open Q1.
 *
 * It shows the label (20px), the live/stale/ended status chip (from
 * `beaconState`), the last-seen age (primary, from `created_at`), the time-box
 * countdown (secondary, from `expiration`), and a "Copy share link" affordance.
 * The share naddr carries the THROWAWAY pubkey (the beacon is not under the user's
 * profile, D-05): `naddrEncode({ kind: LIVE_BEACON_KIND, pubkey: beacon.pubkey,
 * identifier: beacon.dTag })`.
 *
 * Owner viewing their own live beacon also sees inline Stop sharing (an
 * alert-dialog, destructive-toned, with the no-delete recap) + Adjust. There is NO
 * Delete action — the substrate is no-delete and Stop is the only teardown
 * (D-04/D-06, T-12-05-NODELETE).
 *
 * SIGHT-03 / T-12-05-FROZEN (the detail read path, P-1): if the viewed beacon is
 * expired (`isExpired`) the panel shows the "This beacon has ended." terminal copy
 * instead of the content. All strings render as escaped React text nodes — NO
 * `dangerouslySetInnerHTML` (T-12-05-XSS).
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { LocateFixed, Pencil } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { isExpired } from '@/lib/nostr/expiry'
import { beaconState, LIVE_BEACON_KIND, type BeaconState, type LiveBeacon } from '@/lib/nostr/live-beacon'
import { formatExpiryCountdown, formatRelativeDate } from '@/lib/nostr/temporal-sighting'
import { cn } from '@/lib/utils'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'

interface BeaconViewPanelProps {
	/** The beacon being viewed (cast). Absent ⇒ empty fallback. */
	beacon?: LiveBeacon | null
	currentUserPubkey?: string
	/** Stop the user's own active beacon (owner-only). */
	onStopBeacon?: (beacon: LiveBeacon) => void
	/** Adjust the user's own active beacon — opens the control panel pre-filled. */
	onAdjustBeacon?: (beacon: LiveBeacon) => void
	/** Fly the map to this beacon and focus it ("Watch on map"). */
	onZoomTo?: () => void
}

function EndedOrEmpty({ heading, body }: { heading: string; body: string }) {
	return (
		<EntityPanelShell title={heading}>
			<EntityPanelSurface tone="neutral">
				<p className="text-sm text-muted-foreground">{body}</p>
			</EntityPanelSurface>
		</EntityPanelShell>
	)
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
	return {
		label: 'STALE',
		className: 'rounded-none bg-muted text-muted-foreground text-[11px]',
	}
}

export function BeaconViewPanel({
	beacon,
	currentUserPubkey,
	onStopBeacon,
	onAdjustBeacon,
	onZoomTo,
}: BeaconViewPanelProps) {
	if (!beacon) {
		return (
			<EndedOrEmpty
				heading="No beacon selected"
				body="No beacon selected. Pick a beacon from the Beacons panel, or share your own live location."
			/>
		)
	}

	const now = unixNow()

	// T-12-05-FROZEN (detail read path, P-1): never render an expired beacon's
	// content — show the terminal copy instead. Gated independently of the
	// subscription drop.
	if (isExpired(beacon.event, now)) {
		return <EndedOrEmpty heading="Beacon ended" body="This beacon has ended." />
	}

	const label = beacon.beacon.label?.trim() || beacon.dTag || 'Live location'
	const isOwner = !!currentUserPubkey && currentUserPubkey === beacon.pubkey
	const state = beaconState(beacon, now)
	const chip = statusChip(state)
	// Honest last-seen age (created_at), surfaced as a friendly relative label.
	const lastSeen = formatRelativeDate(beacon.created_at)
	// Time-box countdown from the NIP-40 expiration (secondary clock).
	const countdown = formatExpiryCountdown(beacon.expiresAt, now)
	const isLive = state === 'live'

	const handleCopyShareLink = () => {
		const dTag = beacon.dTag
		if (!dTag) {
			toast.error("This beacon can't be shared — it has no address.")
			return
		}
		try {
			// The share naddr carries the THROWAWAY pubkey (D-05) — the beacon is not
			// under the user's profile, so the OG fetch resolves it by {kind,pubkey,#d}.
			const naddr = nip19.naddrEncode({
				kind: LIVE_BEACON_KIND,
				pubkey: beacon.pubkey,
				identifier: dTag,
			})
			const url = `${window.location.origin}/#/beacons/beacon/${naddr}`
			void navigator.clipboard?.writeText(url)
			toast.success('Link copied — anyone with it can watch')
		} catch {
			toast.error("Couldn't copy the share link. Try again.")
		}
	}

	return (
		<EntityPanelShell title={label}>
			<div className="space-y-3 text-[13px]">
				<EntityPanelSurface tone="context" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Beacon"
						title={label}
						action={
							onZoomTo || (isOwner && (onAdjustBeacon || onStopBeacon)) ? (
								<div className="flex items-center gap-2">
									{onZoomTo && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={onZoomTo}
											className="gap-1 rounded-none px-2 text-[11px]"
											title="Watch on map"
										>
											<LocateFixed className="h-3 w-3" />
											Watch
										</Button>
									)}
									{isOwner && onAdjustBeacon && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onAdjustBeacon(beacon)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<Pencil className="h-3 w-3" />
											Adjust
										</Button>
									)}
									{/* Stop is the ONLY teardown — destructive-toned alert-dialog with the
									    no-delete recap. There is NO Delete action (D-04/D-06). */}
									{isOwner && onStopBeacon && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													type="button"
													variant="destructive"
													size="sm"
													className="rounded-none px-2 text-[11px]"
												>
													Stop sharing
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Stop sharing your location?</AlertDialogTitle>
													<AlertDialogDescription>
														Your last point stays visible until your time box runs out, then it's
														gone. You can't remove it sooner.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Keep sharing</AlertDialogCancel>
													<AlertDialogAction onClick={() => onStopBeacon(beacon)}>
														Stop sharing
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									)}
								</div>
							) : undefined
						}
					/>

					{/* Status chip + last-seen (primary) + countdown (secondary). */}
					<div className="flex flex-wrap items-center gap-2">
						{isLive ? (
							<Badge className={chip.className}>{chip.label}</Badge>
						) : (
							<span className={cn(chip.className, 'px-1.5 py-0.5')}>{chip.label}</span>
						)}
						<span className="text-[12px] text-muted-foreground">
							{state === 'ended' ? `ended ${lastSeen}` : `last seen ${lastSeen}`}
						</span>
						{countdown ? (
							<span className="text-[11px] text-muted-foreground">{countdown}</span>
						) : null}
					</div>

					{/* Copy share link — carries the throwaway pubkey (D-11). */}
					<Button
						type="button"
						variant="outline"
						onClick={handleCopyShareLink}
						className="w-full rounded-none"
					>
						Copy share link
					</Button>
				</EntityPanelSurface>

				{/* comment/react deferred to Phase 13 / XCUT-01 (research Open Q1) — no
				    CommentsPanel/GeoSocialActions mount here. */}
			</div>
		</EntityPanelShell>
	)
}
