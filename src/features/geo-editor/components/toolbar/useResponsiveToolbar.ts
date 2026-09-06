import { useLayoutEffect, useRef, useState } from 'react'

export type ResponsiveToolbarMenu = 'draw' | 'edit'

/**
 * Canvas-space priorities, not viewport breakpoints. Secondary utilities live
 * in More tools, leaving predictable room for File, publication and Thread.
 * Below 560px utility/publication triggers become compact; File/Draw/Edit
 * keep their labels. Leave headroom for counters and browser font metrics.
 */
export function resolveToolbarLayout(width: number) {
	const expanded = new Set<ResponsiveToolbarMenu>()
	if (width >= 900) expanded.add('draw')
	if (width >= 1200) expanded.add('edit')
	return {
		expanded,
		compactSearch: width < 820,
		compactLabels: width < 560,
		inlineCallout: width >= 820,
	}
}

export function useResponsiveToolbar() {
	const containerRef = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)
	useLayoutEffect(() => {
		const element = containerRef.current
		if (!element) return
		setWidth(element.clientWidth)
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(entry.contentRect.width)
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])
	return { containerRef, ...resolveToolbarLayout(width) }
}
