/**
 * SightingViewPanel — the reader-facing view surface for a kind-37522 Temporal
 * Sighting (NIP-52 time-bound observation with a NIP-40 expiry; Phase 11, Plan 04
 * / SIGHT-03 read path + SIGHT-04 comment/react mount).
 *
 * The structural twin of `StoryViewPanel`, cloned with `TemporalSighting`
 * substituted for `Article` and the Story-only machinery STRIPPED:
 *   - no Markdown `RichContentRenderer` body (a Sighting has only a short title +
 *     description rendered as ESCAPED React text nodes — T-11-04-02, no
 *     `dangerouslySetInnerHTML`),
 *   - no `StoryProposalsPanel`/`StoryProposeEditDialog` (a Sighting has no
 *     propose-edit; out of scope per REQUIREMENTS).
 *
 * Net-new view content (no Story twin): an observation-time range row
 * ("Observed …" / "Until …") + an observation-state cue (live/upcoming/past via
 * `classifyObservationState`, D-06) + an expiry countdown ("Fades in 6 days" /
 * "Fades soon" / none if never, D-05).
 *
 * SIGHT-03 (defensive, the detail read path): if the viewed Sighting is expired
 * (`isExpired(event, unixNow())`) the panel renders the not-found/expired state
 * instead of the content — even though `useSightings` already drops expired at the
 * subscription, the view is gated independently per the per-read-path discipline
 * (Pitfall P-1).
 *
 * SIGHT-04: a `CommentsPanel` mounts against the Sighting's 37522 coordinate for
 * comment + react, exactly as Phase 9/10 mounted it on Groups/Stories — the mount
 * is cloned unchanged; the only code change for SIGHT-04 is widening the comment /
 * react target unions to include `TemporalSighting` (full NIP-22 K/k read-side
 * widening across all four kinds stays Phase 13 / XCUT-01; runtime rooting is
 * already kind-generic).
 */

import { unixNow } from 'applesauce-core/helpers/time'
import { Images, LocateFixed, MapPlus, Pencil } from 'lucide-react'
import { ImageGalleryDialog } from '@/components/media/ImageGalleryDialog'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { CommentsPanel } from '@/features/social/comments'
import { isExpired } from '@/lib/nostr/expiry'
import {
	classifyObservationState,
	formatExpiryCountdown,
	formatObservationRange,
	formatRelativeDate,
} from '@/lib/nostr/temporal-sighting'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'

// IN-03: re-export the shared formatters so the Plan-01 test contract
// (SightingViewPanel.test.ts imports them from this module path) stays intact
// after the helpers moved to the shared temporal-sighting/format module.
export { formatExpiryCountdown, formatObservationRange }
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'

interface SightingViewPanelProps {
	/** The Sighting being viewed (cast). Absent ⇒ empty fallback. */
	sighting?: TemporalSighting | null
	currentUserPubkey?: string
	onDeleteSighting?: (sighting: TemporalSighting) => void
	onEditSighting?: (sighting: TemporalSighting) => void
	/**
	 * Phase 13 (SPEC §3.4): add this Sighting to the Map Stack as a normal,
	 * non-isolated visible entry (mirrors the dataset onAddDatasetToMap affordance).
	 * Absent ⇒ the affordance is hidden.
	 */
	onAddToMapStack?: (sighting: TemporalSighting) => void
	/** Fly the map to this Sighting and focus it (the inspect-panel "Zoom to" button). */
	onZoomTo?: () => void
	/** The d-tag key of a Sighting whose delete is in flight. */
	deletingKey?: string | null
	availableFeatures?: GeoFeatureItem[]
	/** Show/hide a comment's attached geojson annotation on the map. */
	onCommentGeometryVisibility?: (comment: GeoComment, visible: boolean) => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	focusCommentId?: string
}

function ExpiredOrEmpty({ heading, body }: { heading: string; body: string }) {
	return (
		<EntityPanelShell title={heading}>
			<EntityPanelSurface tone="neutral">
				<p className="text-sm text-muted-foreground">{body}</p>
			</EntityPanelSurface>
		</EntityPanelShell>
	)
}

export function SightingViewPanel({
	sighting,
	currentUserPubkey,
	onDeleteSighting,
	onEditSighting,
	onAddToMapStack,
	onZoomTo,
	deletingKey,
	availableFeatures = [],
	onCommentGeometryVisibility,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	onZoomToBounds,
	focusCommentId,
}: SightingViewPanelProps) {
	if (!sighting) {
		return (
			<ExpiredOrEmpty
				heading="No sighting selected"
				body="No sighting selected. Pick a sighting from the Sightings panel, or drop a new one on the map."
			/>
		)
	}

	const now = unixNow()

	// SIGHT-03 (detail read path, Pitfall P-1): never render an expired Sighting's
	// content — show the not-found/expired copy instead. Gated independently of the
	// subscription drop.
	if (isExpired(sighting.event, now)) {
		return (
			<ExpiredOrEmpty
				heading="Sighting unavailable"
				body="This sighting isn't available — it may have expired or been removed."
			/>
		)
	}

	const content = sighting.sighting
	const title = content.title?.trim() || sighting.dTag || 'Untitled Sighting'
	const description = content.description?.trim()
	const isOwner = !!currentUserPubkey && currentUserPubkey === sighting.pubkey
	const sightingKey = sighting.dTag ?? sighting.id ?? null
	const isDeleting = sightingKey ? deletingKey === `sighting:${sightingKey}` : false
	const images = sighting.images
	const primaryImage = sighting.primaryImage

	const obsState = classifyObservationState(content.start, content.end, now)
	const range = formatObservationRange(content.start, content.end)
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
						label: formatRelativeDate(content.end ?? content.start) || 'Past',
						className: 'rounded-none text-[11px] text-muted-foreground',
					}

	return (
		<EntityPanelShell title={title}>
			<div className="space-y-3 text-[13px]">
				<EntityPanelSurface tone="context" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Sighting"
						title={title}
						description={formatRelativeDate(sighting.created_at)}
						action={
							onZoomTo || isOwner ? (
								<div className="flex items-center gap-2">
									{onZoomTo && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={onZoomTo}
											className="gap-1 rounded-none px-2 text-[11px]"
											title="Zoom to on map"
										>
											<LocateFixed className="h-3 w-3" />
											Zoom
										</Button>
									)}
									{isOwner && onEditSighting && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onEditSighting(sighting)}
											className="gap-1 rounded-none px-2 text-[11px]"
										>
											<Pencil className="h-3 w-3" />
											Edit
										</Button>
									)}
									{isOwner && onDeleteSighting && (
										<ConfirmDeleteAction
											label="sighting"
											isDeleting={isDeleting}
											onConfirm={() => onDeleteSighting(sighting)}
										/>
									)}
								</div>
							) : undefined
						}
					/>

					{/* Observation-state cue (D-06) + expiry countdown (D-05). */}
					<div className="flex flex-wrap items-center gap-2">
						{obsState === 'past' ? (
							<span className={cue.className}>{cue.label}</span>
						) : (
							<Badge className={cue.className}>{cue.label}</Badge>
						)}
						{expiryCountdown ? (
							<span className="text-[11px] text-muted-foreground">{expiryCountdown}</span>
						) : null}
					</div>

					{primaryImage?.url ? (
						<ImageGalleryDialog
							images={images}
							title={title}
							trigger={
								<button
									type="button"
									className="group relative block w-full overflow-hidden rounded-[2px] border border-border bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
									aria-label={`View ${images.length === 1 ? 'photo' : `${images.length} photos`} for ${title}`}
								>
									<img
										src={primaryImage.url}
										alt={primaryImage.alt ?? `${title} primary photo`}
										className="aspect-video w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
									/>
									<span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-[2px] bg-black/65 px-2 py-1 text-[11px] font-medium text-white">
										<Images className="h-3.5 w-3.5" />
										{images.length === 1 ? 'View photo' : `View ${images.length} photos`}
									</span>
								</button>
							}
						/>
					) : null}

					{/* Description — escaped React text node only (T-11-04-02). */}
					{description ? (
						<p className="whitespace-pre-wrap text-sm text-foreground">{description}</p>
					) : (
						<p className="text-sm text-muted-foreground">No details added.</p>
					)}

					{/* Observation-time range (D-03). The three timestamps stay legible:
					    `created_at` is the meta line above; this row is the observation
					    window only. */}
					{range.observed || range.until ? (
						<div className="space-y-1 text-[12px] text-muted-foreground">
							{range.observed ? (
								<div>
									<span className="font-semibold text-foreground">Observed</span> {range.observed}
								</div>
							) : null}
							{range.until ? (
								<div>
									<span className="font-semibold text-foreground">Until</span> {range.until}
								</div>
							) : null}
						</div>
					) : null}

					{/* Add to map stack (SPEC §3.4) — a normal, non-isolated visible entry so
					    the sighting shows on the map without going solo. Only when wired. */}
					{onAddToMapStack ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => onAddToMapStack(sighting)}
							className="w-full gap-1 rounded-none"
						>
							<MapPlus className="h-4 w-4" />
							Add to map stack
						</Button>
					) : null}
				</EntityPanelSurface>

				{/* Comment + react on the Sighting coordinate (SIGHT-04). The TemporalSighting
				    cast is a kind-37522 event, so CommentsPanel/GeoSocialActions root the
				    comment at `target.kind === TEMPORAL_SIGHTING_KIND` directly — runtime
				    rooting is kind-generic; only the type union widens (full NIP-22 K/k
				    widening stays Phase 13 / XCUT-01). */}
				<EntityPanelSurface tone="discussion" className="space-y-4">
					<EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
					<CommentsPanel
						key={sighting.id ?? sighting.dTag ?? 'no-sighting'}
						target={sighting}
						onCommentGeojsonVisibilityChange={(comment, visible) =>
							onCommentGeometryVisibility?.(comment, visible)
						}
						onZoomToCommentGeojson={(comment) => {
							if (comment.boundingBox && onZoomToBounds) onZoomToBounds(comment.boundingBox)
						}}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
						focusCommentId={focusCommentId}
					/>
				</EntityPanelSurface>
			</div>
		</EntityPanelShell>
	)
}
