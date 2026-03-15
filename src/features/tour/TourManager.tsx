import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useEffect, useRef } from 'react'
import { useTourStore } from './store'
import { tourSteps } from './steps'
import './tour.css'

export function TourManager() {
	const { isActive, hasSeenTour, startTour, endTour, markAsSeen } = useTourStore()
	const driverRef = useRef<ReturnType<typeof driver> | null>(null)

	// Auto-start on first visit (small delay so the map has time to render)
	useEffect(() => {
		if (!hasSeenTour) {
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
			steps: tourSteps,
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
	}, [isActive, endTour, markAsSeen])

	return null
}
