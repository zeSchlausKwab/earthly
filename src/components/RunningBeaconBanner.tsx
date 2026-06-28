/**
 * RunningBeaconBanner — the persistent "you are live" chrome pinned over the map
 * while a beacon session is active (Phase 12, BEACON-02, UI-SPEC § Net-New 3).
 * There is NO Sighting/Story twin — this is the one genuinely net-new always-on
 * surface, and it is MOBILE-CRITICAL: a live position beacon is used in motion,
 * phone in hand, so the Stop affordance must be one unmistakable tap at all times.
 *
 * Layout: a `.glass-panel` banner — mobile bottom-anchored full-width inside the
 * safe-area inset (thumb zone); desktop a centered corner pill. It shows the LIVE
 * status word (`--primary`) + the time-box countdown + an unmistakable ≥44px
 * destructive-toned "Stop sharing" button.
 *
 * Honest staleness (T-12-05-FROZEN / P-3): when the publisher reports a
 * `searching` sub-state (POSITION_UNAVAILABLE / no fix yet), the banner shows a
 * "searching…" sub-line rather than disappearing — the user must never silently
 * lose the "I am live" signal, and the banner never claims a live fix it doesn't
 * have. The live dot is static under `prefers-reduced-motion`.
 *
 * Presentational: driven entirely by the publisher status passed as props; the
 * controller owns the session lifecycle.
 */

import type { BeaconSubState } from '@/features/geo-editor/hooks/useBeaconPublisher'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RunningBeaconBannerProps {
	/** The publisher geolocation sub-state — drives the searching sub-line. */
	subState: BeaconSubState
	/** The time-box countdown string ("ends in 38 min"), or null when none. */
	countdown?: string | null
	/** True while the Stop publish is in flight (button → "Stopping…"). */
	isStopping?: boolean
	onStop: () => void
}

export function RunningBeaconBanner({
	subState,
	countdown,
	isStopping = false,
	onStop,
}: RunningBeaconBannerProps) {
	const searching = subState === 'searching' || subState === 'permission-denied'

	return (
		<div
			className={cn(
				'glass-panel pointer-events-auto fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 px-4 py-3',
				'[padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]',
				'sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-auto sm:-translate-x-1/2 sm:rounded-none sm:px-4',
			)}
			role="status"
			aria-live="polite"
		>
			<span
				className="size-2.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 text-xs">
					<span className="font-semibold text-primary">LIVE</span>
					<span className="text-muted-foreground">· sharing your location</span>
					{countdown ? <span className="text-muted-foreground">· {countdown}</span> : null}
				</div>
				{searching ? (
					<div className="text-[11px] text-muted-foreground">
						searching… your beacon will pick back up when your signal returns
					</div>
				) : null}
			</div>
			<Button
				type="button"
				variant="destructive"
				onClick={onStop}
				disabled={isStopping}
				className="h-11 min-h-11 shrink-0 rounded-none px-4"
			>
				{isStopping ? 'Stopping…' : 'Stop sharing'}
			</Button>
		</div>
	)
}
