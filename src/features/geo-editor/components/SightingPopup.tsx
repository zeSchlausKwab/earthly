import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { UserProfile } from '@/components/user-profile'
import {
	type TemporalSighting,
	classifyObservationState,
	formatExpiryCountdown,
	formatRelativeDate,
} from '@/lib/nostr/temporal-sighting'
import { resolveMapPopupPosition, type MapPopupPlacement } from './map-popup-positioning'

export interface SightingPopupData {
	/** The hovered Temporal Sighting. */
	sighting: TemporalSighting
	/** Screen position where the user hovered the marker. */
	clickPosition: { x: number; y: number }
}

interface SightingPopupProps {
	data: SightingPopupData | null
	/** Container ref for positioning calculations. */
	containerRef: React.RefObject<HTMLDivElement | null>
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	now?: number
}

const POPUP_WIDTH = 280
const POPUP_HEIGHT_ESTIMATE = 160

/**
 * Hover preview for a Temporal Sighting marker — the Sighting analog of
 * `FeaturePopup`. Answers "what is this dot?" on hover: title, observation-state
 * cue, description, expiry countdown, and author. Non-interactive (pointer-events
 * off) — clicking the marker opens the full detail panel. Title/description render
 * as auto-escaped React text (no HTML injection sink).
 */
export function SightingPopup({
	data,
	containerRef,
	placementMode = 'geometry',
	toolbarOffset = 72,
	now,
}: SightingPopupProps) {
	const popupRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 240 })

	const updatePosition = useCallback(() => {
		if (!data || !containerRef.current || !popupRef.current) return
		const containerRect = containerRef.current.getBoundingClientRect()
		const popupWidth = popupRef.current.offsetWidth || POPUP_WIDTH
		const popupHeight = popupRef.current.offsetHeight || POPUP_HEIGHT_ESTIMATE
		setPosition(
			resolveMapPopupPosition({
				containerWidth: containerRect.width,
				containerHeight: containerRect.height,
				popupWidth,
				popupHeight,
				anchorPoint: data.clickPosition,
				placement: placementMode,
				toolbarOffset,
				offset: 12,
			}),
		)
	}, [containerRef, data, placementMode, toolbarOffset])

	useLayoutEffect(() => {
		if (!data) return
		updatePosition()

		const popupEl = popupRef.current
		const containerEl = containerRef.current
		if (!popupEl || !containerEl) return

		const handleResize = () => updatePosition()
		window.addEventListener('resize', handleResize)

		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(() => updatePosition())
			observer.observe(popupEl)
			observer.observe(containerEl)
			return () => {
				window.removeEventListener('resize', handleResize)
				observer.disconnect()
			}
		}

		return () => {
			window.removeEventListener('resize', handleResize)
		}
	}, [containerRef, data, updatePosition])

	if (!data) return null

	const { sighting } = data
	const content = sighting.sighting
	const title = content.title?.trim() || 'Untitled'
	const description = content.description?.trim()
	const clock = now ?? Math.floor(Date.now() / 1000)
	const obsState = classifyObservationState(content.start, content.end, clock)
	const expiryCountdown = formatExpiryCountdown(sighting.expiresAt, clock)

	const cueLabel =
		obsState === 'live' ? 'LIVE' : obsState === 'upcoming' ? 'Upcoming' : 'Past observation'
	const cueClass =
		obsState === 'live'
			? 'bg-primary text-primary-foreground'
			: obsState === 'upcoming'
				? 'bg-secondary text-secondary-foreground'
				: 'bg-muted text-muted-foreground'

	return (
		<div
			ref={popupRef}
			role="dialog"
			aria-label={`${title} sighting`}
			className="pointer-events-none absolute z-50 flex flex-col overflow-hidden rounded-xl bg-card/95 shadow-2xl ring-1 ring-black/5 backdrop-blur"
			style={{
				width: `min(${POPUP_WIDTH}px, calc(100% - 24px))`,
				left: position.left,
				top: position.top,
				maxHeight: position.maxHeight,
			}}
		>
			<div className="border-b border-border bg-muted/80 px-3 py-2">
				<div className="flex items-center gap-2">
					<span
						className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cueClass}`}
					>
						{cueLabel}
					</span>
					<span className="truncate font-semibold text-sm text-foreground">{title}</span>
				</div>
				<div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<span className="text-muted-foreground">By</span>
					<UserProfile
						pubkey={sighting.pubkey}
						mode="avatar-name"
						size="xs"
						showNip05Badge={false}
						interactive={false}
					/>
				</div>
			</div>

			<div className="space-y-1.5 overflow-y-auto px-3 py-2">
				{description ? <p className="text-xs text-foreground">{description}</p> : null}
				<div className="text-[11px] text-muted-foreground">
					<span className="text-muted-foreground">Observed:</span>{' '}
					{formatRelativeDate(content.end ?? content.start) || 'Unknown'}
				</div>
				{expiryCountdown ? (
					<div className="text-[11px] text-muted-foreground">
						<span className="text-muted-foreground">Expiry:</span> {expiryCountdown}
					</div>
				) : null}
			</div>
		</div>
	)
}
