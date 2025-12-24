import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint: number = 768): boolean {
	const [isMobile, setIsMobile] = useState(false)

	useEffect(() => {
		if (typeof window === 'undefined') return
		const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)

		const update = (event: MediaQueryList | MediaQueryListEvent) => {
			setIsMobile(event.matches)
		}

		update(mediaQuery)

		const listener = (event: MediaQueryListEvent) => update(event)

		if (typeof mediaQuery.addEventListener === 'function') {
			mediaQuery.addEventListener('change', listener)
			return () => mediaQuery.removeEventListener('change', listener)
		}

		mediaQuery.addListener(listener)
		return () => mediaQuery.removeListener(listener)
	}, [breakpoint])

	return isMobile
}
