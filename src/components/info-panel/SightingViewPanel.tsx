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
import { Pencil } from 'lucide-react'
import { CommentsPanel } from '@/features/social/comments'
import { isExpired } from '@/lib/nostr/expiry'
import { classifyObservationState } from '@/lib/nostr/temporal-sighting'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
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
	/** The d-tag key of a Sighting whose delete is in flight. */
	deletingKey?: string | null
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	focusCommentId?: string
}

function formatRelativeDate(createdAt?: number): string {
	if (!createdAt) return ''
	const date = new Date(createdAt * 1000)
	const diffMs = Date.now() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMs / 3600000)
	const diffDays = Math.floor(diffMs / 86400000)
	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 7) return `${diffDays}d ago`
	return date.toLocaleDateString()
}

function formatTimestamp(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	return date.toLocaleString()
}

/**
 * The observation-time range rows for the view ("Observed …" / "Until …"). A
 * Sighting with no observation time at all yields two nulls (the form may omit
 * the row entirely). Pure + total — never throws on undefined input.
 */
export function formatObservationRange(
	start: number | undefined,
	end: number | undefined,
): { observed: string | null; until: string | null } {
	return {
		observed: start !== undefined ? formatTimestamp(start) : null,
		until: end !== undefined ? formatTimestamp(end) : null,
	}
}

/**
 * The expiry countdown copy ("Fades in 6 days" / "Fades soon" if < 24h), or null
 * when the Sighting never expires or is already past expiry. Mirrors the
 * SightingsPanel browse-row countdown so the read view stays consistent.
 */
export function formatExpiryCountdown(expiresAt: number | undefined, now: number): string | null {
	if (expiresAt === undefined) return null
	const remaining = expiresAt - now
	if (remaining <= 0) return null
	if (remaining < 86_400) return 'Fades soon'
	const days = Math.round(remaining / 86_400)
	return `Fades in ${days} day${days === 1 ? '' : 's'}`
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
	deletingKey,
	availableFeatures = [],
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
							isOwner ? (
								<div className="flex items-center gap-2">
									{onEditSighting && (
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
									{onDeleteSighting && (
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
