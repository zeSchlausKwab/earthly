export interface MobileViewportInput {
	layoutHeight: number
	visualHeight: number
	visualOffsetTop: number
	baselineHeight: number
	editableFocused: boolean
	/** Height of the persistent dock that remains visible after layout-viewport resize. */
	persistentDockHeightPx?: number
}

export interface MobileViewportLayout {
	keyboardOpen: boolean
	fixedBottomInsetPx: number
	dockClearancePx: number
	usableHeightPx: number
}

const KEYBOARD_THRESHOLD_PX = 80
const VIEWPORT_EDGE_GAP_PX = 8

/**
 * Resolve a keyboard-safe fixed-sheet layout across the two common browser
 * strategies: iOS visually occludes the layout viewport, while many Android
 * browsers resize the layout viewport itself.
 */
export function resolveMobileViewportLayout({
	layoutHeight,
	visualHeight,
	visualOffsetTop,
	baselineHeight,
	editableFocused,
	persistentDockHeightPx = 0,
}: MobileViewportInput): MobileViewportLayout {
	const safeLayoutHeight = Math.max(0, layoutHeight)
	const safeVisualHeight = Math.max(0, visualHeight)
	const safeOffsetTop = Math.max(0, visualOffsetTop)
	const fixedBottomInsetPx = Math.max(0, safeLayoutHeight - (safeOffsetTop + safeVisualHeight))
	const resizedViewportDrop = Math.max(0, baselineHeight - safeVisualHeight)
	const keyboardOpen =
		editableFocused &&
		(fixedBottomInsetPx > KEYBOARD_THRESHOLD_PX || resizedViewportDrop > KEYBOARD_THRESHOLD_PX)
	// An occluding visual viewport (the usual iOS strategy) already hides the dock
	// below its bottom edge. A resized layout viewport (the common Android
	// strategy) keeps the fixed dock visible, so the sheet must stop above it.
	const dockClearancePx =
		keyboardOpen && fixedBottomInsetPx <= KEYBOARD_THRESHOLD_PX
			? Math.max(0, persistentDockHeightPx)
			: 0

	return {
		keyboardOpen,
		fixedBottomInsetPx: keyboardOpen ? fixedBottomInsetPx : 0,
		dockClearancePx,
		usableHeightPx: Math.max(0, safeVisualHeight - VIEWPORT_EDGE_GAP_PX - dockClearancePx),
	}
}
