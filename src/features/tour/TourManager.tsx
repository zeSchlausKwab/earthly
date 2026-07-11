import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useEffect, useRef } from 'react'
import { isDeepLinkLanding } from '@/features/geo-editor/hooks/useRouting'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useTourStore } from './store'
import { desktopTourSteps, mobileTourSteps } from './steps'
import './tour.css'

/**
 * Viewport guard (UI/UX audit P1 #1): a step must never describe a control the
 * user cannot see. Steps without an `element` (welcome/finale) always pass;
 * element steps are dropped when their target is not currently in the DOM —
 * driver.js would otherwise silently fall back to a centered popover pointing
 * at nothing.
 */
function resolvableSteps(steps: DriveStep[]): DriveStep[] {
	return steps.filter((step) => {
		if (!step.element) return true
		if (typeof step.element !== 'string') return true
		const found = document.querySelector(step.element) != null
		if (!found && process.env.NODE_ENV !== 'production') {
			console.warn(`Tour step target not found, step skipped: ${step.element}`)
		}
		return found
	})
}

export function TourManager() {
	const { isActive, hasSeenTour, startTour, endTour, markAsSeen } = useTourStore()
	// Same 768px breakpoint as the rest of the app — the tour must describe the
	// chrome this viewport actually renders (bottom dock vs sidebar rail).
	const isMobile = useIsMobile()
	const driverRef = useRef<ReturnType<typeof driver> | null>(null)
	// Capture the deep-link signal ONCE at mount (a shared/deep-linked initial
	// URL). Reading it in a ref initializer freezes it to the landing URL, so a
	// later in-app navigation to an entity cannot retroactively suppress a
	// legitimately-earned tour. We only SKIP the auto-start — we never call
	// markAsSeen, so a suppressed recipient still gets the tour on a later plain load.
	const isDeepLinkLandingRef = useRef(isDeepLinkLanding())

	// Auto-start on first visit (small delay so the map has time to render),
	// UNLESS the initial URL is a shared/deep-linked route.
	useEffect(() => {
		if (!hasSeenTour && !isDeepLinkLandingRef.current) {
			const t = setTimeout(startTour, 800)
			return () => clearTimeout(t)
		}
	}, [hasSeenTour, startTour])

	useEffect(() => {
		if (!isActive) {
			driverRef.current?.destroy()
			driverRef.current = null
			return
		}

		const driverObj = driver({
			showProgress: true,
			showButtons: ['next', 'previous', 'close'],
			nextBtnText: 'Next →',
			prevBtnText: '← Back',
			doneBtnText: 'Done',
			progressText: '{{current}} of {{total}}',
			animate: true,
			overlayOpacity: 0.65,
			stagePadding: 8,
			stageRadius: 8,
			allowClose: true,
			disableActiveInteraction: false,
			popoverClass: 'earthly-tour-popover',
			// Resolved at drive time, not module load: the viewport picks the step
			// list, and any step whose target is missing right now is dropped.
			steps: resolvableSteps(isMobile ? mobileTourSteps : desktopTourSteps),
			onDestroyStarted: () => {
				markAsSeen()
				endTour()
				driverObj.destroy()
			},
		})

		driverRef.current = driverObj
		driverObj.drive()

		return () => {
			driverObj.destroy()
		}
	}, [isActive, isMobile, endTour, markAsSeen])

	return null
}
