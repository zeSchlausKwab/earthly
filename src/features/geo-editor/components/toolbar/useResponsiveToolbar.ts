import { useLayoutEffect, useRef, useState } from 'react'

// Release common drawing and history commands first, without moving the
// remaining commands out of their familiar Draw / Edit menus.
export const TOOLBAR_SHORTCUT_PRIORITY = [
	'select',
	'draw_point',
	'draw_linestring',
	'draw_polygon',
	'undo',
	'redo',
	'edit',
	'geometry_ops',
	'draw_annotation',
	'box_select',
	'snapping',
	'delete',
	'duplicate',
	'draw_arrow',
	'draw_shape',
	'edit-isolation',
] as const

export function resolveToolbarLayout({
	budget,
	buttonWidth,
	menuGap,
	rowGap,
	searchExtra,
	authoring,
}: {
	budget: number
	buttonWidth: number
	menuGap: number
	rowGap: number
	searchExtra: number
	authoring: boolean
}) {
	// Leave one pixel for fractional layout rounding.
	let remaining = Math.max(0, budget - 1)
	const cost = buttonWidth + menuGap
	const releasedCount =
		authoring && cost > 0
			? Math.min(TOOLBAR_SHORTCUT_PRIORITY.length, Math.floor(remaining / cost))
			: 0
	remaining -= releasedCount * cost
	const inlineCallout =
		authoring &&
		releasedCount === TOOLBAR_SHORTCUT_PRIORITY.length &&
		remaining >= buttonWidth + rowGap
	if (inlineCallout) remaining -= buttonWidth + rowGap
	const compactSearch =
		(authoring && releasedCount < TOOLBAR_SHORTCUT_PRIORITY.length) || remaining < searchExtra
	return { releasedCount, inlineCallout, compactSearch }
}

export function useResponsiveToolbar(authoring: boolean) {
	const containerRef = useRef<HTMLDivElement>(null)
	const menubarRef = useRef<HTMLDivElement>(null)
	const spacerRef = useRef<HTMLDivElement>(null)
	const measureRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLDivElement>(null)
	const [layout, setLayout] = useState({
		releasedCount: 0,
		inlineCallout: false,
		compactSearch: true,
		compactLabels: true,
	})

	// Measure the rendered pinned controls, including publication text, font
	// metrics and counters. Adding back released shortcuts gives the same budget
	// in either layout, so expansion cannot create a resize feedback loop.
	useLayoutEffect(() => {
		const row = containerRef.current
		const menu = menubarRef.current
		const spacer = spacerRef.current
		const probes = measureRef.current
		if (!row || !menu || !spacer || !probes) return
		const measure = () => {
			const bounds = row.getBoundingClientRect()
			if (!bounds.width) return
			const buttonWidth = probes.children[0]!.getBoundingClientRect().width
			const searchExtra = probes.children[1]!.getBoundingClientRect().width - buttonWidth
			const menuGap = Number.parseFloat(getComputedStyle(menu).columnGap) || 0
			const rowGap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
			let budget = spacer.getBoundingClientRect().width
			for (const shortcut of Array.from(
				row.querySelectorAll<HTMLElement>('[data-toolbar-shortcut]'),
			)) {
				budget +=
					shortcut.getBoundingClientRect().width +
					(shortcut.parentElement === menu ? menuGap : rowGap)
			}
			budget += Math.max(
				0,
				(searchRef.current?.getBoundingClientRect().width ?? buttonWidth) - buttonWidth,
			)
			const lastControl = row.lastElementChild!.getBoundingClientRect()
			budget -= Math.max(0, lastControl.right - bounds.right)
			const next = {
				...resolveToolbarLayout({ budget, buttonWidth, menuGap, rowGap, searchExtra, authoring }),
				compactLabels: bounds.width < 560,
			}
			setLayout((previous) =>
				previous.releasedCount === next.releasedCount &&
				previous.inlineCallout === next.inlineCallout &&
				previous.compactSearch === next.compactSearch &&
				previous.compactLabels === next.compactLabels
					? previous
					: next,
			)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(row)
		// Also react to labels/fonts changing without a canvas resize.
		for (const child of Array.from(row.children)) observer.observe(child)
		observer.observe(probes)
		return () => observer.disconnect()
	})
	return {
		containerRef,
		menubarRef,
		spacerRef,
		measureRef,
		searchRef,
		...layout,
		inlineShortcuts: new Set<string>(TOOLBAR_SHORTCUT_PRIORITY.slice(0, layout.releasedCount)),
	}
}
