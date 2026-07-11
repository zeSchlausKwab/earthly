import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Priority-ordered menu identifiers used by the toolbar. Order matters —
 * earlier menus are expanded first when there's room.
 *
 * The View menu was dropped (its sole remaining item, Location lookup, is
 * now a standalone Crosshair button next to the search box).
 */
export const TOOLBAR_MENU_PRIORITY = ['draw', 'edit'] as const
export type ResponsiveToolbarMenu = (typeof TOOLBAR_MENU_PRIORITY)[number]

/**
 * Approximate pixel widths of each menu when expanded inline. Slightly
 * UNDER-estimated so we expand readily — the parent has `overflow-x-auto`
 * as a safety net for the rare case we miscount.
 */
const EXPANDED_WIDTH: Record<ResponsiveToolbarMenu, number> = {
	// Draw inline = 2 select buttons + 4 draw mode buttons (OSM moved out).
	draw: 210,
	edit: 270,
}

/**
 * Width of the collapsed `<MenubarMenu>` dropdown trigger (icon + label).
 * Used to compute the "cost difference" between collapsed and expanded.
 */
const COLLAPSED_TRIGGER_WIDTH = 80

/**
 * Width budget reserved for non-priority toolbar elements (sidebar trigger,
 * search box, map state cluster, chat toggle, settings, share, create-map,
 * measure, file menu, etc.). Treated as fixed overhead — the hook subtracts
 * this from the available width before deciding what to expand.
 */
const NON_PRIORITY_RESERVED_WIDTH = 556

/**
 * Hook: measures a container's available width and decides which priority
 * menus should render in their expanded inline form.
 *
 * Returns a `Set` so callers can check membership in O(1):
 *
 *   const { containerRef, expanded } = useResponsiveToolbar()
 *   expanded.has('draw')  // → true if there's room to inline Draw's tools
 */
export function useResponsiveToolbar(): {
	containerRef: React.RefObject<HTMLDivElement | null>
	expanded: Set<ResponsiveToolbarMenu>
} {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const [width, setWidth] = useState(0)

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		// Seed with the initial measurement.
		setWidth(el.clientWidth)
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) setWidth(entry.contentRect.width)
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	const expanded = useMemo(() => {
		const result = new Set<ResponsiveToolbarMenu>()
		if (width <= 0) return result
		// Start from a fully-collapsed cost: NON_PRIORITY + (every menu collapsed).
		const baselineCost =
			NON_PRIORITY_RESERVED_WIDTH + TOOLBAR_MENU_PRIORITY.length * COLLAPSED_TRIGGER_WIDTH
		let used = baselineCost
		for (const key of TOOLBAR_MENU_PRIORITY) {
			// Expanding a menu replaces its trigger with the wider inline form.
			const expandCost = EXPANDED_WIDTH[key] - COLLAPSED_TRIGGER_WIDTH
			if (used + expandCost <= width) {
				result.add(key)
				used += expandCost
			} else {
				break
			}
		}
		return result
	}, [width])

	return { containerRef, expanded }
}
