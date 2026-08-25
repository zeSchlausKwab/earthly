import { describe, expect, test } from 'bun:test'
import {
	MOBILE_WORKSPACE_RAIL_CONTROL_PX,
	MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX,
	mobileSheetCloseLabel,
	mobileSheetChromeClassName,
	mobileSheetInnerSurfaceClassName,
	mobileSheetSurfaceClassName,
	mobileWorkspaceHeaderActionRowClassName,
	mobileWorkspaceRailClassName,
	mobileWorkspaceRailGridTemplateColumns,
	mobileWorkspaceTabHitAreaClassName,
	mobileWorkspaceTabListClassName,
	mobileWorkspaceTabVisualClassName,
	resolveMobileWorkspaceRailLayout,
} from './mobileSheetPresentation'

describe('mobile sheet presentation', () => {
	test('uses a strongly translucent surface without weakening the opaque state', () => {
		const translucent = mobileSheetSurfaceClassName(true)
		const opaque = mobileSheetSurfaceClassName(false)

		expect(translucent).toContain('bg-card/20')
		expect(translucent).toContain('backdrop-blur-md')
		expect(translucent.split(' ')).not.toContain('bg-card')
		expect(opaque.split(' ')).toContain('bg-card')
		expect(opaque).not.toContain('bg-card/')
	})

	test('keeps every sheet chrome surface glass instead of painting an opaque header', () => {
		expect(mobileSheetChromeClassName(true)).toContain('bg-card/10')
		expect(mobileSheetInnerSurfaceClassName(true)).toContain('bg-card/10')
		expect(mobileSheetChromeClassName(false).split(' ')).toContain('bg-card')
		expect(mobileSheetInnerSurfaceClassName(false).split(' ')).toContain('bg-card')
	})

	test('keeps the workspace close label stable without erasing specific sheet names', () => {
		expect(mobileSheetCloseLabel(true, 'Edit')).toBe('Close map workspace')
		expect(mobileSheetCloseLabel(false, 'Datasets')).toBe('Close Datasets')
	})

	test('draws flexible compact tabs inside 44px touch targets', () => {
		const hitArea = mobileWorkspaceTabHitAreaClassName()
		const activeGlass = mobileWorkspaceTabVisualClassName(true, true)

		expect(hitArea).toContain('min-h-11')
		expect(hitArea).toContain('min-w-11')
		expect(hitArea).toContain('flex-1')
		expect(hitArea).not.toContain('w-20')
		expect(activeGlass).toContain('h-8')
		expect(activeGlass).toContain('bg-background/35')
		expect(activeGlass).not.toContain('min-h-11')
	})

	test('fits resize, tabs, transparency, and close in one 48px rail at 320px', () => {
		const layout = resolveMobileWorkspaceRailLayout(320)

		expect(mobileWorkspaceRailClassName(false)).toContain('h-12')
		expect(mobileWorkspaceRailClassName(false)).toContain('grid')
		expect(mobileWorkspaceRailClassName(false)).toContain('justify-between')
		expect(mobileWorkspaceRailClassName(false)).not.toContain('justify-center')
		expect(mobileWorkspaceRailGridTemplateColumns()).toBe('44px minmax(132px, 180px) 44px 44px')
		expect(layout).toEqual({
			handlePx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
			tabListPx: MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX,
			tabPx: MOBILE_WORKSPACE_RAIL_TABLIST_MAX_PX / 3,
			transparencyPx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
			closePx: MOBILE_WORKSPACE_RAIL_CONTROL_PX,
			interTrackGapPx: 8 / 3,
			handleStartPx: 0,
			closeEndPx: 320,
			outerGutterPx: 0,
		})
		expect(layout.tabPx).toBeGreaterThanOrEqual(44)
	})

	test('puts spare width between tracks while retaining edge-aligned outer controls', () => {
		const layout = resolveMobileWorkspaceRailLayout(390)

		expect(layout.tabListPx).toBe(180)
		expect(layout.interTrackGapPx).toBe(26)
		expect(layout.handleStartPx).toBe(0)
		expect(layout.closeEndPx).toBe(390)
		expect(layout.outerGutterPx).toBe(0)
		expect(mobileWorkspaceTabListClassName(false)).toContain('w-full')
		expect(mobileWorkspaceTabListClassName(true)).toContain('bg-card/10')
	})

	test('keeps editor actions in a collision-free row that vanishes when empty', () => {
		const actionRow = mobileWorkspaceHeaderActionRowClassName(true)

		expect(actionRow).toContain('empty:hidden')
		expect(actionRow).toContain('min-h-11')
		expect(actionRow).toContain('justify-end')
		expect(actionRow).toContain('[&_button]:min-h-11')
		expect(actionRow).toContain('bg-card/10')
	})
})
