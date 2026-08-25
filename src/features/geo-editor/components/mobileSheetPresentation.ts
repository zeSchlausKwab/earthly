import { cn } from '@/lib/utils'

export const MOBILE_WORKSPACE_RAIL_CONTROL_PX = 44
export const MOBILE_WORKSPACE_RAIL_TAB_COUNT = 3
export const MOBILE_WORKSPACE_RAIL_TABLIST_MIN_PX =
	MOBILE_WORKSPACE_RAIL_CONTROL_PX * MOBILE_WORKSPACE_RAIL_TAB_COUNT
export const MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX = 180

/**
 * The map workspace has one literal control sequence:
 * resize handle → Stack/Edit/Chat → transparency → close.
 *
 * A 44px control and three 44px tabs fit as far down as 264px. At our
 * supported 320px floor, the tab list grows to 180px; that leaves a 4px focus
 * and edge-gesture gutter on both sides. Wider phones center the same compact
 * 312px rail instead of stretching its controls apart.
 */
export function mobileWorkspaceRailGridTemplateColumns(): string {
	return `${MOBILE_WORKSPACE_RAIL_CONTROL_PX}px minmax(${MOBILE_WORKSPACE_RAIL_TABLIST_MIN_PX}px, ${MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX}px) ${MOBILE_WORKSPACE_RAIL_CONTROL_PX}px ${MOBILE_WORKSPACE_RAIL_CONTROL_PX}px`
}

export function resolveMobileWorkspaceRailLayout(viewportWidthPx: number): {
	handlePx: number
	tabListPx: number
	tabPx: number
	transparencyPx: number
	closePx: number
	outerGutterPx: number
} {
	const fixedControlsPx = MOBILE_WORKSPACE_RAIL_CONTROL_PX * 3
	const tabListPx = Math.min(
		MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX,
		Math.max(MOBILE_WORKSPACE_RAIL_TABLIST_MIN_PX, viewportWidthPx - fixedControlsPx),
	)
	const contentPx = fixedControlsPx + tabListPx

	return {
		handlePx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
		tabListPx,
		tabPx: tabListPx / MOBILE_WORKSPACE_RAIL_TAB_COUNT,
		transparencyPx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
		closePx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
		outerGutterPx: Math.max(0, (viewportWidthPx - contentPx) / 2),
	}
}

/**
 * The transparent state is deliberately a strong "map-first" glass treatment.
 * Controls and text remain fully opaque; only the sheet surfaces let the map
 * through. The opaque state keeps a solid card all the way to the sheet edge.
 */
export function mobileSheetSurfaceClassName(translucent: boolean): string {
	return cn(translucent ? 'bg-card/20 backdrop-blur-md' : 'bg-card')
}

/** Sheet-level chrome (grab handle, transparency, and close controls). */
export function mobileSheetChromeClassName(translucent: boolean): string {
	return cn(translucent ? 'bg-card/10 backdrop-blur-sm' : 'bg-card')
}

/** One 48px rail for every map-workspace control. */
export function mobileWorkspaceRailClassName(translucent: boolean): string {
	return cn(
		'grid h-12 w-full shrink-0 items-center justify-center border-b border-border',
		mobileSheetChromeClassName(translucent),
	)
}

export function mobileWorkspaceTabListClassName(translucent: boolean): string {
	return cn(
		'flex h-11 w-full min-w-0 items-center justify-center rounded-md border border-border p-0',
		translucent ? 'bg-card/10' : 'bg-muted/45',
	)
}

/** Header and target-picker surfaces should not re-opaque a glass sheet. */
export function mobileSheetInnerSurfaceClassName(translucent: boolean): string {
	return cn(translucent ? 'bg-card/10' : 'bg-card')
}

/** Preserve a stable global label for the triad while naming every other sheet. */
export function mobileSheetCloseLabel(mapWorkspaceVisible: boolean, activeLabel: string): string {
	return mapWorkspaceVisible ? 'Close map workspace' : `Close ${activeLabel}`
}

/**
 * Keep a 44px hit area while drawing a quieter, 32px-high tab pill inside it.
 */
export function mobileWorkspaceTabHitAreaClassName(): string {
	return 'flex min-h-11 min-w-11 flex-1 items-center justify-center px-0.5 text-[11px] font-medium'
}

export function mobileWorkspaceTabVisualClassName(active: boolean, translucent: boolean): string {
	return cn(
		'relative flex h-8 min-w-0 flex-1 items-center justify-center gap-0.5 rounded px-0.5 transition-colors',
		active
			? cn(translucent ? 'bg-background/35' : 'bg-background', 'text-foreground shadow-sm')
			: 'text-muted-foreground hover:bg-muted/40',
	)
}

/**
 * Editor actions get their own row below the centered workspace tabs. The row
 * disappears when the active surface contributes no actions, so Stack and Chat
 * keep the compact single-row header while narrow Edit sheets cannot collide
 * with Cancel/Publish controls.
 */
export function mobileWorkspaceHeaderActionRowClassName(translucent: boolean): string {
	return cn(
		'empty:hidden flex min-h-11 shrink-0 items-center justify-end border-b border-border px-2',
		mobileSheetInnerSurfaceClassName(translucent),
		'[&>div]:max-w-full [&_button]:min-h-11',
	)
}
