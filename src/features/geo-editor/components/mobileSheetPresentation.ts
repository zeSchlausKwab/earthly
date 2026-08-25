import { cn } from '@/lib/utils'

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
	return 'flex min-h-11 w-20 min-w-11 items-center justify-center px-0.5 text-[11px] font-medium'
}

export function mobileWorkspaceTabVisualClassName(active: boolean, translucent: boolean): string {
	return cn(
		'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 transition-colors',
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
